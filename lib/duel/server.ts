/**
 * Server-side state machine for Trivia Duel rooms (2–4 players).
 *
 * Storage layout — one JSON blob per room in Upstash Redis:
 *   duel:{roomId} → DuelRoom (1-hour TTL)
 *
 * All state transitions go through 'read room, mutate, write back'.
 * There's a small race window where two concurrent answer-submissions
 * could overwrite each other; we mitigate by checking the player's
 * own slot hasn't already answered the current question before
 * committing. Each player's pick lives in its own slot so cross-player
 * writes don't conflict.
 */

import { Redis } from "@upstash/redis";
import {
  TRIVIA_QUESTIONS,
  type TriviaDifficulty,
  type TriviaQuestion,
} from "@/lib/data/trivia";
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  type DuelPick,
  type DuelQuestionState,
  type DuelRoom,
} from "./types";

const redis = Redis.fromEnv();

const ROOM_TTL_SECONDS = 60 * 60; // 1 hour
const QUESTIONS_PER_DUEL = 10;
const ROOM_ID_ALPHABET =
  "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — readability

function key(roomId: string): string {
  return `duel:${roomId}`;
}

/** Generate a short, human-readable room id (6 chars). */
export function newRoomId(): string {
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
  }
  return id;
}

function newQuestionState(): DuelQuestionState {
  return {
    picks: new Array(MAX_PLAYERS).fill(null),
    resolved: false,
    winnerSlot: null,
    resolvedAt: null,
  };
}

export async function loadRoom(roomId: string): Promise<DuelRoom | null> {
  const raw = (await redis.get(key(roomId))) as DuelRoom | null;
  return raw ?? null;
}

async function saveRoom(room: DuelRoom): Promise<void> {
  await redis.set(key(room.roomId), room, { ex: ROOM_TTL_SECONDS });
}

export async function createRoom(args: {
  difficulty: TriviaDifficulty;
  hostToken: string;
  hostName: string;
}): Promise<DuelRoom> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = newRoomId();
    const existing = await redis.get(key(roomId));
    if (existing) continue;

    const players = new Array(MAX_PLAYERS).fill(null);
    players[0] = { token: args.hostToken, name: args.hostName, score: 0 };

    const room: DuelRoom = {
      roomId,
      difficulty: args.difficulty,
      seed: Math.floor(Math.random() * 0x7fffffff),
      players,
      status: "waiting",
      currentQuestionIndex: 0,
      questions: Array.from({ length: QUESTIONS_PER_DUEL }, newQuestionState),
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    await saveRoom(room);
    return room;
  }
  throw new Error("Failed to allocate a unique duel room id after 5 tries");
}

/**
 * Join an open slot in an existing room (or reconnect if the player's
 * token already owns a slot — used after a refresh).
 *
 * Returns the room and the slot index the joiner ended up in, or null
 * if the room doesn't exist / is full / has already started.
 */
export async function joinRoom(args: {
  roomId: string;
  playerToken: string;
  playerName: string;
}): Promise<{ room: DuelRoom; slot: number } | null> {
  const room = await loadRoom(args.roomId);
  if (!room) return null;

  // Reconnect — same token already seated.
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (room.players[i] && room.players[i]!.token === args.playerToken) {
      return { room, slot: i };
    }
  }

  // Only allow new joins while the room is still waiting.
  if (room.status !== "waiting") return null;

  // Take the next empty slot.
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (room.players[i] === null) {
      room.players[i] = {
        token: args.playerToken,
        name: args.playerName,
        score: 0,
      };
      await saveRoom(room);
      return { room, slot: i };
    }
  }

  // Room full.
  return null;
}

function activeSlotCount(room: DuelRoom): number {
  return room.players.filter((p) => p !== null).length;
}

/** Start the duel — only the host (slot 0) can do this, and only when
 * at least MIN_PLAYERS_TO_START players are seated. */
export async function startRoom(args: {
  roomId: string;
  hostToken: string;
}): Promise<DuelRoom | null> {
  const room = await loadRoom(args.roomId);
  if (!room) return null;
  if (room.status !== "waiting") return room;
  if (!room.players[0] || room.players[0].token !== args.hostToken) return null;
  if (activeSlotCount(room) < MIN_PLAYERS_TO_START) return room;

  room.status = "active";
  room.startedAt = Date.now();
  await saveRoom(room);
  return room;
}

/**
 * Resolve a question if there's enough info to declare it over.
 *
 * Rules (extended for N players):
 *   - First correct answer wins. If multiple players had already
 *     submitted correct answers (unlikely with sub-second resolution
 *     but possible), earliest timestamp wins.
 *   - Wrong answer eliminates you from this question; remaining
 *     players may still try.
 *   - Once every seated player has answered AND nobody was right →
 *     draw, winnerSlot = -1.
 */
function maybeResolveQuestion(
  q: DuelQuestionState,
  activeSlots: number[],
): boolean {
  if (q.resolved) return false;

  // Earliest correct pick across all players.
  let bestSlot = -1;
  let bestTs = Infinity;
  for (const slot of activeSlots) {
    const pick = q.picks[slot];
    if (pick && pick.correct && pick.clickedAt < bestTs) {
      bestSlot = slot;
      bestTs = pick.clickedAt;
    }
  }
  if (bestSlot !== -1) {
    q.resolved = true;
    q.winnerSlot = bestSlot;
    q.resolvedAt = Date.now();
    return true;
  }

  // Nobody correct yet. Check if everyone seated has answered.
  const allAnswered = activeSlots.every((slot) => q.picks[slot] !== null);
  if (allAnswered) {
    q.resolved = true;
    q.winnerSlot = -1; // draw
    q.resolvedAt = Date.now();
    return true;
  }
  return false;
}

export function pickDuelQuestions(
  difficulty: TriviaDifficulty,
  seed: number,
): TriviaQuestion[] {
  const pool = TRIVIA_QUESTIONS.filter((q) => q.difficulty === difficulty);
  if (pool.length < QUESTIONS_PER_DUEL) {
    throw new Error(
      `Trivia pool for ${difficulty} only has ${pool.length} questions`,
    );
  }
  let a = seed >>> 0 || 1;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = pool.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, QUESTIONS_PER_DUEL);
}

export async function submitAnswer(args: {
  roomId: string;
  playerToken: string;
  questionIndex: number;
  answerIndex: number;
}): Promise<DuelRoom | null> {
  const room = await loadRoom(args.roomId);
  if (!room) return null;
  if (room.status !== "active") return room;
  if (args.questionIndex !== room.currentQuestionIndex) return room;

  let slot = -1;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (room.players[i] && room.players[i]!.token === args.playerToken) {
      slot = i;
      break;
    }
  }
  if (slot === -1) return null;

  const q = room.questions[args.questionIndex];
  if (q.picks[slot] !== null) return room; // already answered

  const questions = pickDuelQuestions(room.difficulty, room.seed);
  const correct =
    args.answerIndex === questions[args.questionIndex].correct;
  const pick: DuelPick = {
    answer: args.answerIndex,
    correct,
    clickedAt: Date.now(),
  };
  q.picks[slot] = pick;

  const activeSlots: number[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (room.players[i] !== null) activeSlots.push(i);
  }

  if (maybeResolveQuestion(q, activeSlots)) {
    if (q.winnerSlot !== null && q.winnerSlot !== -1) {
      const winner = room.players[q.winnerSlot];
      if (winner) winner.score += 1;
    }
  }

  await saveRoom(room);
  return room;
}

const ADVANCE_AFTER_MS = 3000;

export async function maybeAdvance(roomId: string): Promise<DuelRoom | null> {
  const room = await loadRoom(roomId);
  if (!room) return null;
  if (room.status !== "active") return room;

  const q = room.questions[room.currentQuestionIndex];
  if (!q.resolved || q.resolvedAt === null) return room;
  if (Date.now() - q.resolvedAt < ADVANCE_AFTER_MS) return room;

  room.currentQuestionIndex += 1;
  if (room.currentQuestionIndex >= QUESTIONS_PER_DUEL) {
    room.status = "finished";
    room.finishedAt = Date.now();
  }
  await saveRoom(room);
  return room;
}

/**
 * Build the client-safe view of a room. Hides `correct` for unresolved
 * questions and strips player tokens (they're private to each player).
 */
export function publicRoomView(room: DuelRoom) {
  const questions = pickDuelQuestions(room.difficulty, room.seed);
  return {
    roomId: room.roomId,
    difficulty: room.difficulty,
    players: room.players.map((p) =>
      p ? { name: p.name, score: p.score } : null,
    ),
    status: room.status,
    currentQuestionIndex: room.currentQuestionIndex,
    questions: questions.map((q, i) => {
      const qs = room.questions[i];
      const revealCorrect = qs.resolved;
      return {
        id: q.id,
        q: q.q,
        options: q.options,
        correct: revealCorrect ? q.correct : null,
        fact: revealCorrect ? q.fact : null,
        state: qs,
      };
    }),
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
  };
}

export type PublicRoom = ReturnType<typeof publicRoomView>;
