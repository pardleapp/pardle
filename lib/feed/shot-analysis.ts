/**
 * Turn a hole's shot-by-shot strokes into a specific "what went wrong"
 * description — a 3-putt, a 4-putt, a penalty, two penalties — so the
 * "Worst of the day" reel can say "X 4-putts from 12 ft" instead of
 * just "X doubles the 8th".
 *
 * Signals (from PGA Tour orchestrator shotDetailsV3):
 *   - Putt   = stroke with fromLocationCode "OGR" (on green).
 *   - Penalty = stroke with strokeType "PENALTY".
 */

import type { PGAStroke } from "@/lib/golf-api/pgatour";

export interface HoleDisaster {
  /** Number of putts taken (includes the holed putt). */
  puttCount: number;
  /** Display distance of the first putt, e.g. "40 ft" — null if no putts. */
  firstPuttDistance: string | null;
  /** Number of penalty strokes on the hole. */
  penaltyCount: number;
  /**
   * The single most reaction-worthy line for this hole, or null when
   * nothing notable happened (a plain bogey with no putt/penalty drama).
   * Caller supplies the player name + hole; this is the descriptive
   * fragment, e.g. "4-putts from 12 ft" or "takes two penalties".
   */
  verdict: string | null;
  /** Emoji to pair with the verdict. */
  emoji: string;
}

function isPutt(s: PGAStroke): boolean {
  return s.fromLocationCode === "OGR";
}

function isPenalty(s: PGAStroke): boolean {
  return s.strokeType === "PENALTY";
}

const NUMBER_WORD = ["zero", "one", "two", "three", "four", "five"];
function word(n: number): string {
  return NUMBER_WORD[n] ?? String(n);
}

export function analyzeHole(strokes: PGAStroke[]): HoleDisaster {
  const putts = strokes.filter(isPutt);
  const penalties = strokes.filter(isPenalty);
  const puttCount = putts.length;
  const penaltyCount = penalties.length;
  const firstPuttDistance = putts[0]?.distance ?? null;

  // Pick the single most dramatic storyline. Penalties usually trump
  // putting woes; a 4-putt trumps a single penalty.
  let verdict: string | null = null;
  let emoji = "💥";

  if (penaltyCount >= 2) {
    verdict = `takes ${word(penaltyCount)} penalties`;
    emoji = "🌊";
  } else if (puttCount >= 4) {
    verdict = firstPuttDistance
      ? `4-putts from ${firstPuttDistance}`
      : "4-putts";
    emoji = "😱";
  } else if (penaltyCount === 1) {
    verdict = "finds a penalty";
    emoji = "🌊";
  } else if (puttCount === 3) {
    verdict = firstPuttDistance
      ? `3-putts from ${firstPuttDistance}`
      : "3-putts";
    emoji = "😬";
  }

  return {
    puttCount,
    firstPuttDistance,
    penaltyCount,
    verdict,
    emoji,
  };
}
