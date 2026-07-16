/**
 * Per-hole scoring aggregates for the "hole-by-hole scoring average"
 * chart on /live.
 *
 * Why this exists separately from the feed events: the reactor feed
 * intentionally skips par outcomes ("nobody shouts 'what a par'").
 * That means aggregating from feed events biases every hole's mean
 * heavily — a hole with 15 pars + 5 birdies would compute as -1.00
 * to par when it actually plays -0.25 to par.
 *
 * Instead we walk the full poll snapshot (every player, every hole
 * they've scored) and produce the true aggregates. Includes pars.
 */

import type { PollSnapshot } from "./store";
import type { ScoreResult } from "./types";

/** Round → hole → aggregate. */
export type HoleAggregates = Record<number, Record<number, HoleAggregate>>;

export interface HoleAggregate {
  par: number;
  sumStrokes: number;
  count: number;
  /** Result-type histogram. Ace is orthogonal to the score buckets —
   *  a hole-in-one on a par 3 counts in BOTH `ace` and `eagle`. */
  dist: {
    albatross: number;
    eagle: number;
    birdie: number;
    par: number;
    bogey: number;
    double: number;
    triplePlus: number;
    ace: number;
  };
  lowest: number;
  highest: number;
}

function emptyDist() {
  return {
    albatross: 0,
    eagle: 0,
    birdie: 0,
    par: 0,
    bogey: 0,
    double: 0,
    triplePlus: 0,
    ace: 0,
  };
}

function bucketFor(strokes: number, par: number): keyof HoleAggregate["dist"] {
  const diff = strokes - par;
  if (diff <= -3) return "albatross";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  if (diff === 2) return "double";
  return "triplePlus";
}

/** Public helper — same bucketing as HoleAggregate.dist so client
 *  code that needs a ScoreResult from (strokes, par) stays consistent. */
export function resultFor(strokes: number, par: number): ScoreResult {
  const diff = strokes - par;
  if (diff <= -3) return "albatross";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  if (diff === 2) return "double";
  return "triple-plus";
}

/**
 * Walk the poll snapshot and build the per-round-per-hole aggregate
 * map. Ignores holes with unknown par (defensive — shouldn't happen
 * in practice since the pars table is populated alongside the
 * snapshot itself).
 */
export function computeHoleAggregates(
  snapshot: PollSnapshot | null | undefined,
  pars: Record<number, Record<number, number>> | null | undefined,
): HoleAggregates {
  const out: HoleAggregates = {};
  if (!snapshot || !pars) return out;
  for (const byRound of Object.values(snapshot.holes)) {
    for (const [roundStr, byHole] of Object.entries(byRound)) {
      const round = Number(roundStr);
      const roundPars = pars[round];
      if (!roundPars) continue;
      for (const [holeStr, scoreStr] of Object.entries(byHole)) {
        const hole = Number(holeStr);
        const par = roundPars[hole];
        if (typeof par !== "number") continue;
        const strokes = Number(scoreStr);
        // Skip holes the player hasn't finished (empty string or non-
        // numeric placeholder — orchestrator uses "" for unplayed).
        if (!Number.isFinite(strokes) || strokes <= 0) continue;

        if (!out[round]) out[round] = {};
        let agg = out[round][hole];
        if (!agg) {
          agg = {
            par,
            sumStrokes: 0,
            count: 0,
            dist: emptyDist(),
            lowest: Infinity,
            highest: -Infinity,
          };
          out[round][hole] = agg;
        }
        agg.sumStrokes += strokes;
        agg.count += 1;
        if (strokes < agg.lowest) agg.lowest = strokes;
        if (strokes > agg.highest) agg.highest = strokes;
        agg.dist[bucketFor(strokes, par)] += 1;
        if (strokes === 1) agg.dist.ace += 1;
      }
    }
  }
  return out;
}
