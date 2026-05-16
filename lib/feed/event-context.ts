/**
 * Compute the small "context chips" (tags) that ride alongside a feed
 * event — the data-first editorial layer that turns a routine line
 * into a moment: "Takes the lead", "5 of last 7 in red",
 * "9 holes bogey-free".
 *
 * Lives next to the diff engine because it consumes the same snapshot
 * data + leaderboard view. Stateless: each call computes from the
 * inputs, no Redis side-effects.
 */

import type { PGALeaderboardRow } from "@/lib/golf-api/pgatour";
import { resultFor, type ScoreResult } from "./types";

/** Parse "1" / "T2" / "CUT" / "—" / "" into a numeric rank, or null. */
function parsePosition(pos: string | undefined): number | null {
  if (!pos) return null;
  const m = /^T?(\d+)$/.exec(pos.trim());
  if (!m) return null;
  return Number(m[1]);
}

function isTied(pos: string | undefined): boolean {
  return !!pos && pos.startsWith("T");
}

/**
 * Compare a player's previous leaderboard position to their fresh one.
 * Returns at most ONE tag — the most reaction-worthy of any changes.
 */
export function positionTag(
  prev: string | undefined,
  fresh: string | undefined,
): string | null {
  if (!fresh || prev === fresh) return null;
  const prevN = parsePosition(prev);
  const freshN = parsePosition(fresh);
  if (freshN === null) return null;

  // Solo lead (1 with no T) — most dramatic moment in pro golf.
  if (freshN === 1 && !isTied(fresh)) {
    // Was solo before? No change (handled by prev === fresh above
    // since the strings would match), but cover the edge.
    if (prevN === 1 && !isTied(prev)) return null;
    return "Now solo leader";
  }
  // Shared lead.
  if (freshN === 1 && isTied(fresh)) {
    if (prevN === 1) return null; // was already at the top in some form
    return "Joins the lead";
  }
  // Big leap into top-5.
  if (freshN >= 2 && freshN <= 5 && (prevN === null || prevN > 5)) {
    return `Climbs to ${fresh}`;
  }
  return null;
}

/**
 * Per-player streak analysis on the player's run of just-played holes.
 * Returns at most one tag — picks the most evocative of any concurrent
 * streaks (a 5-of-last-7 wins over a 1-bogey-in-last-3 etc).
 */
export interface StreakInputs {
  /**
   * Played holes for this round in play-order (oldest first, just-played
   * last). Each item is { result, holeNumber }.
   */
  playedInOrder: { result: ScoreResult; holeNumber: number }[];
  /** The fresh event's result — biases tag selection (good-news vs bad-news streak). */
  freshResult: ScoreResult | null;
}

function isRed(r: ScoreResult): boolean {
  return r === "birdie" || r === "eagle" || r === "albatross";
}
function isDropped(r: ScoreResult): boolean {
  return r === "bogey" || r === "double" || r === "triple-plus";
}

export function streakTag(inputs: StreakInputs): string | null {
  const seq = inputs.playedInOrder;
  if (seq.length < 3) return null;
  const last = seq.slice(-Math.min(8, seq.length));

  // Good-news streaks: at least 3 reds in the most-recent N holes.
  // Try larger windows first so "5 of last 7" beats "3 of last 5".
  for (const win of [8, 7, 6, 5, 4, 3]) {
    if (last.length < win) continue;
    const slice = last.slice(-win);
    const reds = slice.filter((h) => isRed(h.result)).length;
    if (reds >= 3 && reds * 2 >= win) {
      // Only emit on a fresh red — feels wrong to flag a hot streak
      // when the fresh event was a bogey or par.
      if (!inputs.freshResult || !isRed(inputs.freshResult)) break;
      if (reds === win) return `${win} birdies in a row`;
      return `${reds} of last ${win} in red`;
    }
  }

  // Bad-news streaks: 3+ consecutive dropped shots.
  let trailingDrops = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (isDropped(seq[i].result)) trailingDrops++;
    else break;
  }
  if (trailingDrops >= 3 && isDropped(inputs.freshResult ?? "par")) {
    return `${trailingDrops} bogeys in a row`;
  }

  // Bogey-free streak — emit on a fresh red OR par, only when it's a
  // genuine grind (8+ holes without dropping a shot).
  if (!inputs.freshResult || isDropped(inputs.freshResult)) return null;
  let bogeyFree = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (isDropped(seq[i].result)) break;
    bogeyFree++;
  }
  if (bogeyFree >= 8) {
    return `${bogeyFree} holes bogey-free`;
  }

  return null;
}

const FRONT_TO_BACK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const BACK_TO_FRONT = [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Reconstruct a player's just-played holes for one round in play
 * order. Uses the leaderboard `thru` value to disambiguate two-tee
 * starts (a back-9 starter's most-recent hole is on the front nine).
 */
export function playedInOrderForRound(
  holesScored: Record<number, string>,
  pars: Record<number, number>,
  thru: string | undefined,
): { result: ScoreResult; holeNumber: number }[] {
  const playedHoles = new Set<number>();
  for (const [h, s] of Object.entries(holesScored)) {
    if (s !== "" && s !== "-" && Number.isFinite(Number(s)) && Number(s) > 0) {
      playedHoles.add(Number(h));
    }
  }
  const backNineStart = thru?.includes("*") ||
    (playedHoles.has(18) && !playedHoles.has(9)) ||
    (playedHoles.has(10) && !playedHoles.has(1));
  const order = backNineStart ? BACK_TO_FRONT : FRONT_TO_BACK;
  const result: { result: ScoreResult; holeNumber: number }[] = [];
  for (const h of order) {
    if (!playedHoles.has(h)) continue;
    const strokes = Number(holesScored[h]);
    const par = pars[h];
    if (!par) continue;
    result.push({ result: resultFor(strokes, par), holeNumber: h });
  }
  return result;
}

/**
 * Convenience: build the full tag list for an event given the
 * player's pre- and post-state. Returns a deduplicated array of 0-2
 * tags (more than two starts to feel cluttered).
 */
export function buildContextTags(args: {
  prevPosition: string | undefined;
  freshPosition: string | undefined;
  streak: StreakInputs | null;
}): string[] {
  const tags: string[] = [];
  const pos = positionTag(args.prevPosition, args.freshPosition);
  if (pos) tags.push(pos);
  if (args.streak) {
    const st = streakTag(args.streak);
    if (st && !tags.includes(st)) tags.push(st);
  }
  return tags.slice(0, 2);
}

/** Re-export the leaderboard row shape used by callers — same as the orchestrator's. */
export type { PGALeaderboardRow };
