/**
 * Shot-aware bet projection. For round-score bets, computes the
 * projected round total for a player based on:
 *
 *   • Completed holes → actual strokes (from `type:"score"` events)
 *   • Current hole → shot-projected expected total (from the latest
 *     `type:"shot"` IMG event on that hole via shot-projection.ts)
 *   • Remaining holes → each hole's par + course/field difficulty
 *     baseline (defaults to par when no context available)
 *
 * The resulting projected total is what drives the bet's implied
 * win probability, which in turn drives the value chip / graph. So
 * every shot moves the bet in real time, not just hole completions.
 */

import type { FeedEvent, FeedRow } from "@/lib/feed/types";
import {
  projectShotOnHole,
  type PlayerSkill,
  type ShotHoleProjection,
} from "./shot-projection";

/** Per-hole per-round tour-average variance guess. Same value the
 *  server uses (see bet-shared.ts's PER_HOLE_VAR). */
export const PER_HOLE_VAR = 0.9;

export interface RoundProjection {
  /** Sum of actual strokes on completed holes for this round. */
  completedStrokes: number;
  /** How many holes finished this round. */
  completedHoles: number;
  /** Mid-hole projection for a currently in-progress hole (null if
   *  the player is between holes with nothing publishing right now). */
  currentHole: ShotHoleProjection | null;
  /** Current hole number the projection is anchored to. */
  currentHoleNumber: number | null;
  /** Expected total strokes for the ROUND, factoring completed +
   *  current + remaining. */
  expectedRoundTotal: number;
  /** Variance around the round-total projection (sum of per-hole
   *  variances for the remaining + current holes). */
  variance: number;
  /** Timestamp of the most recent event used in this projection. */
  latestEventTs: number;
}

/**
 * Project a player's round-total strokes using all rows we have for
 * that (player, round) combo.
 *
 * @param rows the feed rows (typically pre-filtered but works either way)
 * @param playerId
 * @param round which round the projection is for
 * @param skill optional DG SG per-round stats
 * @param roundPar total par for the round (usually 70–72)
 * @param holePars per-hole pars (falls back to par 4 for missing entries)
 */
export function projectRoundTotal({
  rows,
  playerId,
  round,
  skill = {},
  roundPar,
  holePars,
}: {
  rows: FeedRow[];
  playerId: string;
  round: number;
  skill?: PlayerSkill;
  roundPar: number;
  holePars?: Record<number, number>;
}): RoundProjection {
  // Filter to events for this player+round only.
  const events = rows
    .map((r) => r.event)
    .filter((ev) => ev.playerId === playerId && ev.round === round);

  // Aggregate completed holes from score events.
  const completedByHole = new Map<number, number>();
  let latestEventTs = 0;
  for (const ev of events) {
    if (ev.type !== "score") continue;
    if (typeof ev.hole !== "number" || typeof ev.strokes !== "number") continue;
    completedByHole.set(ev.hole, ev.strokes);
    if (ev.ts > latestEventTs) latestEventTs = ev.ts;
  }
  const completedStrokes = [...completedByHole.values()].reduce(
    (a, b) => a + b,
    0,
  );
  const completedHoles = completedByHole.size;

  // Find the most-recent shot event on a hole that ISN'T already
  // in the completed set. That's the "current hole" projection.
  const shotEvents = events
    .filter((ev): ev is FeedEvent & { hole: number } =>
      ev.type === "shot" && typeof ev.hole === "number" && !!ev.imgSourced,
    )
    .sort((a, b) => b.ts - a.ts);

  let currentHole: ShotHoleProjection | null = null;
  let currentHoleNumber: number | null = null;
  for (const shot of shotEvents) {
    if (completedByHole.has(shot.hole)) continue;
    const proj = projectShotOnHole(shot, skill);
    if (proj) {
      currentHole = proj;
      currentHoleNumber = shot.hole;
      if (shot.ts > latestEventTs) latestEventTs = shot.ts;
      break;
    }
  }

  // Which holes are still ahead (or par-projected)?
  const holesTouched = new Set<number>(completedByHole.keys());
  if (currentHoleNumber != null) holesTouched.add(currentHoleNumber);

  // "Remaining" strokes budget for holes we haven't seen yet.
  // Best-effort: use holePars if provided, otherwise assume par 4.
  // Field-drift / course difficulty could layer on later.
  let remainingExpected = 0;
  let remainingVariance = 0;
  for (let h = 1; h <= 18; h++) {
    if (holesTouched.has(h)) continue;
    const p = holePars?.[h] ?? 4;
    remainingExpected += p;
    remainingVariance += PER_HOLE_VAR;
  }
  // If we somehow have no holePars and roundPar disagrees with the
  // 18 × 4 = 72 default, rescale the remaining-holes expectation so
  // the total lines up.
  if (!holePars && Object.keys(completedByHole).length + (currentHoleNumber != null ? 1 : 0) < 18) {
    const remainingCount = 18 - holesTouched.size;
    if (remainingCount > 0) {
      const targetSum = roundPar - (holesTouched.size * 4);
      // Scale gently rather than hard-set so the variance still reflects
      // per-hole spread.
      const ratio = targetSum / (remainingCount * 4);
      remainingExpected *= ratio;
    }
  }

  // Add current-hole variance (in-progress hole is uncertain too).
  let currentHoleExpected = 0;
  if (currentHole && currentHoleNumber != null) {
    currentHoleExpected = currentHole.expectedTotal;
    remainingVariance += PER_HOLE_VAR * 0.6; // less variance since we know some shots
  } else if (currentHoleNumber == null && completedHoles < 18) {
    // No shot info + not yet completed → the current hole isn't
    // in-progress from our perspective, treat as par-projected.
  }

  const expectedRoundTotal =
    completedStrokes + currentHoleExpected + remainingExpected;

  return {
    completedStrokes,
    completedHoles,
    currentHole,
    currentHoleNumber,
    expectedRoundTotal,
    variance: remainingVariance,
    latestEventTs,
  };
}

/**
 * Convert a round projection to a win probability for a
 * round-score OVER/UNDER bet using a normal-CDF approximation.
 */
export function roundScoreProb({
  projection,
  line,
  side,
}: {
  projection: RoundProjection;
  line: number;
  side: "under" | "over";
}): number {
  const { expectedRoundTotal, variance } = projection;
  if (variance <= 0) {
    const won =
      side === "under" ? expectedRoundTotal < line : expectedRoundTotal > line;
    return won ? 1 : 0;
  }
  const sd = Math.sqrt(variance);
  const z = (line - expectedRoundTotal) / sd;
  const cdf = normalCdf01(z);
  const p = side === "under" ? cdf : 1 - cdf;
  return clamp01(p);
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(1, p));
}

/** Standard-normal CDF via Abramowitz & Stegun approximation. */
function normalCdf01(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z) / Math.SQRT2;

  const t = 1 / (1 + p * absZ);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);

  return 0.5 * (1 + sign * y);
}
