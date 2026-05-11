/**
 * Shared types for the Faces Duel mode (up to 4 players).
 *
 * A Faces Duel is a real-time race: 2–4 players share a room and play
 * the same 6 blended-pair puzzles in the same order. For each round,
 * any player can type a name; if it matches one of the two pros, that
 * player claims that pro for 1 point. The OTHER pro is still claimable
 * by any other player. Round resolves when both pros are claimed, or
 * when the 60-second per-round timer expires.
 *
 * Rooms live in Upstash Redis with a 1-hour TTL.
 */

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS_TO_START = 2;
export const ROUNDS_PER_DUEL = 6;
/** Each round auto-resolves after this many ms since it became active. */
export const ROUND_DURATION_MS = 60_000;
/** Delay between a round resolving and the next round becoming active. */
export const ADVANCE_AFTER_MS = 3_000;

export interface FacesDuelPlayer {
  /** Stable per-device token, used to authenticate /claim calls. */
  token: string;
  name: string;
  score: number;
}

export interface FaceClaim {
  /** Which of the round's two pros this is — "left" or "right". */
  side: "left" | "right";
  /** Verbatim text the player typed (preserved for display). */
  text: string;
  /** Slot of the player who claimed. */
  slot: number;
  /** Server timestamp when the claim was recorded. */
  claimedAt: number;
}

export interface FacesRoundState {
  leftClaim: FaceClaim | null;
  rightClaim: FaceClaim | null;
  /** Wrong-guess count per player slot, indexed by slot. */
  wrongCounts: number[];
  /** Server timestamp when this round became active (null until then). */
  startedAt: number | null;
  resolved: boolean;
  resolvedAt: number | null;
}

export type FacesDuelStatus = "waiting" | "active" | "finished";

export interface FacesDuelRoom {
  roomId: string;
  /** Mulberry32 seed for picking the 6 face puzzles for this room. */
  seed: number;
  players: (FacesDuelPlayer | null)[];
  status: FacesDuelStatus;
  /** 0..ROUNDS_PER_DUEL — when it hits ROUNDS_PER_DUEL the duel is over. */
  currentRoundIndex: number;
  rounds: FacesRoundState[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}
