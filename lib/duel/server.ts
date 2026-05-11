/**
 * Server-side state machine for Trivia Duel rooms.
 *
 * Storage layout — one JSON blob per room in Upstash Redis:
 *   duel:{roomId} → DuelRoom (with 1-hour TTL)
 *
 * All state transitions go through Lua-style atomic mutations: read the
 * room, mutate, write back. There's a small race window where two
 * concurrent answer-submissions could overwrite each other; for v1 we
 * mitigate by checking that the player hasn't already answered the
 * current question before committing the new state. If both players
 * click within the same millisecond the second-write wins; the
 * resolution logic still produces a valid winner because each player's
 * answer slot is independent.
 */

import { Redis } from "@upstash/redis";
import {
  TRIVIA_QUESTIONS,
  type TriviaDifficulty,
  type TriviaQuestion,
} from "@/lib/data/trivia";
import {
  type DuelRoom,
  type DuelQuestionState,
  type PlayerSlot,
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
    p1Answer: null,
    p2Answer: null,
    p1Correct: null,
    p2Correct: null,
    p1ClickedAt: null,
    p2ClickedAt: null,
    resolved: false,
    winner: null,
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

/**
 * Create a fresh room and seat the host (p1) immediately.
 * Returns the freshly-created room.
 */
export async function createRoom(args: {
  difficulty: TriviaDifficulty;
  hostToken: string;
  hostName: string;
}): Promise<DuelRoom> {
  // Try a few times in the (very unlikely) case of a collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = newRoomId();
    const existing = await redis.get(key(roomId));
    if (existing) continue;

    const room: DuelRoom = {
      roomId,
      difficulty: args.difficulty,
      seed: Math.floor(Math.random() * 0x7fffffff),
      p1: { token: args.hostToken, name: args.hostName, score: 0 },
      p2: null,
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
 * Join an existing room as p2 (or reconnect as p1/p2 if the player's
 * token matches an existing slot — used when a player refreshes mid-game).
 *
 * Returns the room (with the joiner seated). If the room is full and
 * the joiner isn't already p1 or p2, returns null.
 */
export async function joinRoom(args: {
  roomId: string;
  playerToken: string;
  playerName: string;
}): Promise<DuelRoom | null> {
  const room = await loadRoom(args.roomId);
  if (!room) return null;

  // Reconnect — same token comes back, no change needed.
  if (room.p1 && room.p1.token === args.playerToken) return room;
  if (room.p2 && room.p2.token === args.playerToken) return room;

  // Fresh joiner — must be p2 since p1 is set at room-create time.
  if (room.p2) return null;

  room.p2 = {
    token: args.playerToken,
    name: args.playerName,
    score: 0,
  };
  room.status = "active";
  room.startedAt = Date.now();
  await saveRoom(room);
  return room;
}

/**
 * Resolve a question once enough info has been gathered, mutating the
 * passed state in place.
 *
 * Rules (per Tom's spec):
 *   - First correct answer wins immediately, regardless of whether the
 *     other player has answered.
 *   - A wrong answer eliminates that player from the question; the
 *     other player may still try.
 *   - If both players have answered and neither correct → draw.
 */
function maybeResolveQuestion(q: DuelQuestionState): boolean {
  if (q.resolved) return false;

  // Find earliest correct answer.
  const p1OK = q.p1Correct === true;
  const p2OK = q.p2Correct === true;

  if (p1OK && p2OK) {
    // Both correct — earliest timestamp wins.
    const winner =
      (q.p1ClickedAt ?? Infinity) <= (q.p2ClickedAt ?? Infinity) ? "p1" : "p2";
    q.resolved = true;
    q.winner = winner;
    q.resolvedAt = Date.now();
    return true;
  }
  if (p1OK) {
    q.resolved = true;
    q.winner = "p1";
    q.resolvedAt = Date.now();
    return true;
  }
  if (p2OK) {
    q.resolved = true;
    q.winner = "p2";
    q.resolvedAt = Date.now();
    return true;
  }
  // Neither correct. If both have answered, it's a draw.
  if (q.p1Answer !== null && q.p2Answer !== null) {
    q.resolved = true;
    q.winner = "none";
    q.resolvedAt = Date.now();
    return true;
  }
  return false;
}

/**
 * Pick the 10 trivia questions for a duel — seeded from the room's
 * `seed` field so both players (and the server) all agree.
 *
 * Returned in PUZZLE ORDER. The full TriviaQuestion (correct + fact)
 * is server-only — clients receive a redacted version that hides the
 * `correct` index until the question is resolved.
 */
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
  // Mulberry32 seeded from `seed`
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

/**
 * Record a player's answer for the current question. Atomic-ish:
 * reads the room, validates the player hasn't already answered the
 * current question, mutates, writes back.
 *
 * Returns the updated room, or null if the room doesn't exist /
 * player isn't a member.
 */
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

  let slot: PlayerSlot | null = null;
  if (room.p1 && room.p1.token === args.playerToken) slot = "p1";
  else if (room.p2 && room.p2.token === args.playerToken) slot = "p2";
  if (!slot) return null;

  const q = room.questions[args.questionIndex];
  if (slot === "p1" && q.p1Answer !== null) return room; // already answered
  if (slot === "p2" && q.p2Answer !== null) return room;

  const questions = pickDuelQuestions(room.difficulty, room.seed);
  const correct =
    args.answerIndex === questions[args.questionIndex].correct;
  const ts = Date.now();

  if (slot === "p1") {
    q.p1Answer = args.answerIndex;
    q.p1Correct = correct;
    q.p1ClickedAt = ts;
  } else {
    q.p2Answer = args.answerIndex;
    q.p2Correct = correct;
    q.p2ClickedAt = ts;
  }

  if (maybeResolveQuestion(q)) {
    if (q.winner === "p1" && room.p1) room.p1.score += 1;
    if (q.winner === "p2" && room.p2) room.p2.score += 1;
  }

  await saveRoom(room);
  return room;
}

/**
 * Advance the room to the next question if the current is resolved
 * AND enough time has passed for clients to render the reveal.
 *
 * Called from the polling endpoint so the advance happens server-side
 * without depending on a specific client to drive it.
 */
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
 * Build the client-safe view of a room. Hides the per-question
 * `correct` index for unresolved questions so a poke at the response
 * body doesn't leak the answer.
 */
export function publicRoomView(room: DuelRoom) {
  const questions = pickDuelQuestions(room.difficulty, room.seed);
  return {
    roomId: room.roomId,
    difficulty: room.difficulty,
    p1: room.p1
      ? { name: room.p1.name, score: room.p1.score }
      : null,
    p2: room.p2
      ? { name: room.p2.name, score: room.p2.score }
      : null,
    status: room.status,
    currentQuestionIndex: room.currentQuestionIndex,
    questions: questions.map((q, i) => {
      const qs = room.questions[i];
      // Only reveal `correct` once the question is resolved.
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
