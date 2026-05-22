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

  // Good-news streaks: 3+ consecutive red holes ending on the fresh
  // event. The "N of last M in red" partial-streak variant was cut
  // because it reads as stats noise (requires mental math) — we keep
  // only the cleaner "5 birdies in a row" narrative.
  if (inputs.freshResult && isRed(inputs.freshResult)) {
    let trailingReds = 0;
    for (let i = seq.length - 1; i >= 0; i--) {
      if (isRed(seq[i].result)) trailingReds++;
      else break;
    }
    if (trailingReds >= 3) {
      return `${trailingReds} birdies in a row`;
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const RESULT_NOUN: Record<ScoreResult, string> = {
  albatross: "albatross",
  eagle: "eagle",
  birdie: "birdie",
  par: "par",
  bogey: "bogey",
  double: "double",
  "triple-plus": "blow-up",
};

// Minimum running count of the SAME RESULT in the round before we
// surface a "Xth of the round" tag. Routine outcomes need more to
// be tag-worthy; rare ones surface from the 2nd onward.
const MIN_COUNT_TO_SURFACE: Partial<Record<ScoreResult, number>> = {
  eagle: 2,
  birdie: 3,
  bogey: 3,
  double: 2,
  "triple-plus": 1,
};

/**
 * Within-round running stat. Emits "4th birdie of the round" /
 * "2nd double in 6 holes" — the kind of context that turns a routine
 * line into a moment. Each result type has a threshold under which
 * we stay silent (a 1st birdie is just "Player birdies the 5th";
 * the 3rd is where it starts being a story).
 */
export function withinRoundTag(args: {
  playedInOrder: { result: ScoreResult; holeNumber: number }[];
  freshResult: ScoreResult | null;
}): string | null {
  if (!args.freshResult) return null;
  const result = args.freshResult;
  const min = MIN_COUNT_TO_SURFACE[result];
  if (!min) return null;
  // Count how many of the same result type are in this round so far.
  // playedInOrder already includes the fresh hole at the end.
  const sameCount = args.playedInOrder.filter(
    (h) => h.result === result,
  ).length;
  if (sameCount < min) return null;
  return `${ordinal(sameCount)} ${RESULT_NOUN[result]} of the round`;
}

/**
 * Field-relative ranking for the player's running count of this result
 * type in the current round. Reads "most in field today" / "tied for
 * most" / "2nd-most" / "top 5 in field" and surfaces only when the
 * player is genuinely standing out (top 5 in their result category).
 *
 * Caller is responsible for computing rank/tied — engine has the
 * per-player snapshot data to do this in a single pass per poll.
 */
export function fieldRankTag(args: {
  /** Player's count of this result type this round. */
  count: number;
  /** Number of *other* players with strictly more of this result. */
  strictlyMore: number;
  /** Number of *other* players tied at this count. */
  tiedWith: number;
  /** Friendly noun — "birdies", "eagles", "bogeys", "blow-ups". */
  noun: string;
}): string | null {
  if (args.count < 2) return null;
  if (args.strictlyMore === 0) {
    if (args.tiedWith === 0) return `most ${args.noun} in field today`;
    if (args.tiedWith <= 2) return `tied for most ${args.noun} in field`;
    // 4+ players tied at the top — too vague to claim "leading", and
    // "among most" reads as filler. Stay silent.
    return null;
  }
  if (args.strictlyMore === 1) return `2nd-most ${args.noun} in field`;
  if (args.strictlyMore === 2) return `3rd-most ${args.noun} in field`;
  // Ranks 4-5 ("top 5 in field today") cut as too vague — the named
  // 1st/2nd/3rd-most variants carry a story; this one doesn't.
  return null;
}

const RESULT_NOUN_PLURAL: Record<ScoreResult, string> = {
  albatross: "albatrosses",
  eagle: "eagles",
  birdie: "birdies",
  par: "pars",
  bogey: "bogeys",
  double: "doubles",
  "triple-plus": "blow-ups",
};

/**
 * Convenience: build the full tag list for an event given the
 * player's pre- and post-state. Returns a deduplicated array of 0-3
 * tags (more than three starts to feel cluttered).
 */
export function buildContextTags(args: {
  prevPosition: string | undefined;
  freshPosition: string | undefined;
  streak: StreakInputs | null;
  /** Field-relative rank inputs for this event's result. Optional —
   *  when omitted no field-rank chip is emitted. */
  fieldRank?: {
    count: number;
    strictlyMore: number;
    tiedWith: number;
  } | null;
}): string[] {
  const tags: string[] = [];
  const pos = positionTag(args.prevPosition, args.freshPosition);
  if (pos) tags.push(pos);
  if (args.streak) {
    // Prefer the running-count tag over the streak tag when both
    // would surface — "4th birdie of the round" is more informative
    // than "5 of last 7 in red" most of the time.
    const wr = withinRoundTag({
      playedInOrder: args.streak.playedInOrder,
      freshResult: args.streak.freshResult,
    });
    if (wr && !tags.includes(wr)) tags.push(wr);
    if (tags.length < 2) {
      const st = streakTag(args.streak);
      if (st && !tags.includes(st)) tags.push(st);
    }
  }
  // Field rank goes last — it's a contextual layer on top of the
  // ordinal/streak tags above.
  if (args.fieldRank && args.streak?.freshResult) {
    const noun = RESULT_NOUN_PLURAL[args.streak.freshResult] ?? "of those";
    const fr = fieldRankTag({ ...args.fieldRank, noun });
    if (fr && !tags.includes(fr)) tags.push(fr);
  }
  return tags.slice(0, 3);
}

/** Re-export the leaderboard row shape used by callers — same as the orchestrator's. */
export type { PGALeaderboardRow };
