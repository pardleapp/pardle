/**
 * Expected-strokes-to-hole-out from a position + player skill.
 *
 * Port of the Python model's `expected_putts()` and `strokes_to_hole()`
 * from `golf-model/src/features/shotlink.py`. Same numbers, same
 * semantics — just in TypeScript so the client can compute them
 * per-shot as IMG events land.
 */

import {
  APPROACHES_PER_ROUND,
  ARG_SHOTS_PER_ROUND,
  FAIRWAY_BASELINE,
  FAIRWAY_BASELINE_DEFAULT,
  LIE_PENALTY,
  PUTT_DEFAULT,
  PUTT_SKILL_DEFAULT,
  PUTT_SKILL_TABLE,
  PUTT_SKILL_UNKNOWN,
  PUTT_TABLE,
  PUTT_UNKNOWN,
} from "./sg-tables";

/**
 * Expected putts from a distance in feet, adjusted for the player's
 * putting skill.
 *
 * @param distFt distance to hole in feet, or null when unknown
 * @param playerSgPutt DG sg_putt per round (positive = better putter)
 */
export function expectedPutts(
  distFt: number | null,
  playerSgPutt: number = 0,
): number {
  let base = PUTT_DEFAULT;
  if (distFt == null) {
    base = PUTT_UNKNOWN;
  } else {
    for (const [threshold, putts] of PUTT_TABLE) {
      if (distFt < threshold) {
        base = putts;
        break;
      }
    }
  }

  let adjPerSg = distFt == null ? PUTT_SKILL_UNKNOWN : PUTT_SKILL_DEFAULT;
  if (distFt != null) {
    for (const [threshold, adj] of PUTT_SKILL_TABLE) {
      if (distFt < threshold) {
        adjPerSg = adj;
        break;
      }
    }
  }
  const skillAdj = playerSgPutt * adjPerSg;
  const result = base - skillAdj;
  return Math.max(1.0, result);
}

/**
 * Expected strokes-to-hole-out from an off-green position, adjusted
 * for the player's approach + around-the-green skill. Splits
 * approach vs around-the-green at 50 yards.
 *
 * @param yards distance from ball to pin
 * @param lie surface name (fairway / rough / bunker / native / …)
 * @param playerSgApp DG sg_approach per round
 * @param playerSgArg DG sg_around-the-green per round
 */
export function strokesToHole(
  yards: number,
  lie: string,
  playerSgApp: number = 0,
  playerSgArg: number = 0,
): number {
  let base = FAIRWAY_BASELINE_DEFAULT;
  for (const [threshold, val] of FAIRWAY_BASELINE) {
    if (yards <= threshold) {
      base = val;
      break;
    }
  }
  const liePenalty = LIE_PENALTY[lie] ?? LIE_PENALTY.unknown;

  // Skill divisor: > 50 yds is approach territory, ≤ 50 is
  // around-the-green (chips, pitches, greenside recovery).
  const skillAdj =
    yards > 50
      ? playerSgApp / APPROACHES_PER_ROUND
      : playerSgArg / ARG_SHOTS_PER_ROUND;

  return Math.max(0.5, base + liePenalty - skillAdj);
}
