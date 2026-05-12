/**
 * Server-side state machine for Faces Duel rooms (2–4 players).
 *
 * Storage: one JSON blob per room in Upstash Redis at
 *   faces-duel:{roomId} → FacesDuelRoom  (1-hour TTL)
 *
 * Each "round" presents the same blended pair to all seated players.
 * Any player can type a name; if it matches one of the round's two
 * pros, that player claims that pro and earns a point. The other pro
 * is still claimable by any remaining player. Round resolves when both
 * pros are claimed OR when the 60-second per-round timer expires.
 */

import { Redis } from "@upstash/redis";
import { alignmentTransform } from "@/lib/data/face-alignment";
import { PGA_TOUR_IDS } from "@/lib/data/pga-tour-ids";
import { headshotUrl, matchesGolfer, pickPuzzleSet } from "@/lib/game/faces";
import type { FacesPuzzle } from "@/lib/game/faces";
import {
  ADVANCE_AFTER_MS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  ROUNDS_PER_DUEL,
  ROUND_DURATION_MS,
  type FaceClaim,
  type FacesDuelRoom,
  type FacesRoundState,
} from "./types";

const redis = Redis.fromEnv();

const ROOM_TTL_SECONDS = 60 * 60; // 1 hour
const ROOM_ID_ALPHABET =
  "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function key(roomId: string): string {
  return `faces-duel:${roomId}`;
}

function newRoomId(): string {
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
  }
  return id;
}

function newRoundState(): FacesRoundState {
  return {
    leftClaim: null,
    rightClaim: null,
    wrongCounts: new Array(MAX_PLAYERS).fill(0),
    startedAt: null,
    resolved: false,
    resolvedAt: null,
  };
}

export async function loadRoom(
  roomId: string,
): Promise<FacesDuelRoom | null> {
  const raw = (await redis.get(key(roomId))) as FacesDuelRoom | null;
  return raw ?? null;
}

async function saveRoom(room: FacesDuelRoom): Promise<void> {
  await redis.set(key(room.roomId), room, { ex: ROOM_TTL_SECONDS });
}

export async function createRoom(args: {
  hostToken: string;
  hostName: string;
}): Promise<FacesDuelRoom> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = newRoomId();
    const existing = await redis.get(key(roomId));
    if (existing) continue;

    const players = new Array(MAX_PLAYERS).fill(null);
    players[0] = { token: args.hostToken, name: args.hostName, score: 0 };

    const room: FacesDuelRoom = {
      roomId,
      seed: Math.floor(Math.random() * 0x7fffffff),
      players,
      status: "waiting",
      currentRoundIndex: 0,
      rounds: Array.from({ length: ROUNDS_PER_DUEL }, newRoundState),
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    await saveRoom(room);
    return room;
  }
  throw new Error("Failed to allocate a unique faces-duel room id after 5 tries");
}

export async function joinRoom(args: {
  roomId: string;
  playerToken: string;
  playerName: string;
}): Promise<{ room: FacesDuelRoom; slot: number } | null> {
  const room = await loadRoom(args.roomId);
  if (!room) return null;

  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (room.players[i] && room.players[i]!.token === args.playerToken) {
      return { room, slot: i };
    }
  }

  if (room.status !== "waiting") return null;

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

  return null;
}

function activeSlotCount(room: FacesDuelRoom): number {
  return room.players.filter((p) => p !== null).length;
}

export async function startRoom(args: {
  roomId: string;
  hostToken: string;
}): Promise<FacesDuelRoom | null> {
  const room = await loadRoom(args.roomId);
  if (!room) return null;
  if (room.status !== "waiting") return room;
  if (!room.players[0] || room.players[0].token !== args.hostToken) return null;
  if (activeSlotCount(room) < MIN_PLAYERS_TO_START) return room;

  room.status = "active";
  room.startedAt = Date.now();
  room.rounds[0].startedAt = Date.now();
  await saveRoom(room);
  return room;
}

function puzzlesForRoom(room: FacesDuelRoom): FacesPuzzle[] {
  return pickPuzzleSet({ seed: room.seed, count: ROUNDS_PER_DUEL });
}

function maybeResolveRound(round: FacesRoundState): boolean {
  if (round.resolved) return false;
  if (round.leftClaim && round.rightClaim) {
    round.resolved = true;
    round.resolvedAt = Date.now();
    return true;
  }
  if (
    round.startedAt !== null &&
    Date.now() - round.startedAt >= ROUND_DURATION_MS
  ) {
    round.resolved = true;
    round.resolvedAt = Date.now();
    return true;
  }
  return false;
}

export async function submitClaim(args: {
  roomId: string;
  playerToken: string;
  roundIndex: number;
  text: string;
}): Promise<FacesDuelRoom | null> {
  const room = await loadRoom(args.roomId);
  if (!room) return null;
  if (room.status !== "active") return room;
  if (args.roundIndex !== room.currentRoundIndex) return room;

  let slot = -1;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (room.players[i] && room.players[i]!.token === args.playerToken) {
      slot = i;
      break;
    }
  }
  if (slot === -1) return null;

  const round = room.rounds[args.roundIndex];
  if (round.resolved) return room;

  const puzzles = puzzlesForRoom(room);
  const puz = puzzles[args.roundIndex];

  // Is the typed text a match for either pro that hasn't been claimed yet?
  let claimedSide: "left" | "right" | null = null;
  if (!round.leftClaim && matchesGolfer(args.text, puz.left)) {
    claimedSide = "left";
  } else if (!round.rightClaim && matchesGolfer(args.text, puz.right)) {
    claimedSide = "right";
  }

  if (claimedSide) {
    const claim: FaceClaim = {
      side: claimedSide,
      text: args.text.trim().slice(0, 60),
      slot,
      claimedAt: Date.now(),
    };
    if (claimedSide === "left") round.leftClaim = claim;
    else round.rightClaim = claim;
    const player = room.players[slot];
    if (player) player.score += 1;
    maybeResolveRound(round);
  } else {
    round.wrongCounts[slot] = (round.wrongCounts[slot] ?? 0) + 1;
  }

  await saveRoom(room);
  return room;
}

/**
 * Called on every poll. Auto-resolves the current round if its timer
 * has expired, and auto-advances to the next round after the standard
 * delay since the last resolution. Cheaper than running a cron.
 */
export async function maybeAdvance(
  roomId: string,
): Promise<FacesDuelRoom | null> {
  const room = await loadRoom(roomId);
  if (!room) return null;
  if (room.status !== "active") return room;

  const round = room.rounds[room.currentRoundIndex];
  let changed = false;

  if (!round.resolved && maybeResolveRound(round)) {
    changed = true;
  }

  if (round.resolved && round.resolvedAt !== null) {
    if (Date.now() - round.resolvedAt >= ADVANCE_AFTER_MS) {
      room.currentRoundIndex += 1;
      if (room.currentRoundIndex >= ROUNDS_PER_DUEL) {
        room.status = "finished";
        room.finishedAt = Date.now();
      } else {
        room.rounds[room.currentRoundIndex].startedAt = Date.now();
      }
      changed = true;
    }
  }

  if (changed) await saveRoom(room);
  return room;
}

/**
 * Client-safe room view. Strips player tokens (private) and only
 * reveals the round's two pros once the round has resolved (so a late
 * joiner mid-round can't peek at the answer from the JSON payload).
 *
 * NOTE: for an ACTIVE round we still need to send the blended images,
 * which the client needs to display. We send the imageUrls but NOT the
 * names/ids until the round resolves. (Once resolved, names go out so
 * the recap can render.)
 */
export function publicRoomView(room: FacesDuelRoom) {
  const puzzles = puzzlesForRoom(room);
  return {
    roomId: room.roomId,
    players: room.players.map((p) =>
      p ? { name: p.name, score: p.score } : null,
    ),
    status: room.status,
    currentRoundIndex: room.currentRoundIndex,
    rounds: puzzles.map((puz, i) => {
      const r = room.rounds[i];
      const reveal = r.resolved || i < room.currentRoundIndex;
      // Pre-computed alignment transforms — sent as opaque CSS strings
      // so they don't leak which pro is which, but the client can apply
      // them directly to the stacked imgs for an eye-aligned blend.
      const leftAlign = alignmentTransform(PGA_TOUR_IDS[puz.left.id] ?? "");
      const rightAlign = alignmentTransform(
        PGA_TOUR_IDS[puz.right.id] ?? "",
      );
      return {
        leftImage: headshotUrl(puz.left),
        rightImage: headshotUrl(puz.right),
        leftAlign: leftAlign?.transform ?? null,
        rightAlign: rightAlign?.transform ?? null,
        leftName: reveal ? puz.left.name : null,
        rightName: reveal ? puz.right.name : null,
        leftId: reveal ? puz.left.id : null,
        rightId: reveal ? puz.right.id : null,
        state: r,
      };
    }),
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
  };
}

export type PublicFacesRoom = ReturnType<typeof publicRoomView>;
