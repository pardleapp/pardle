/**
 * Per-hole projection: apply fitted coefficients + today's conditions
 * to produce an expected strokes-vs-par value. Auto-matches today's
 * pin coordinates to the historical cluster with the nearest centroid,
 * so callers don't need to know cluster letters ahead of time.
 *
 * Blend logic: when a live sample is provided (players who have
 * finished the hole in the current round), blend the model prediction
 * with the observed average. Weight climbs linearly with sample size
 * and saturates once the sample is big enough to trust on its own:
 *
 *   w = min(1, count / TARGET_SAMPLE)
 *   final = w × live_avg + (1 - w) × model_pred
 *
 * With TARGET_SAMPLE = 30, a hole with 15 finishers gives roughly a
 * 50/50 blend — smoother than the abrupt hard-cutover the old
 * fallback chain used.
 *
 * Pure function — no I/O, no caches. All server-side loading happens
 * in loader.ts.
 */

import type {
  HoleFit,
  TodayConditions,
  LiveSample,
  HoleProjection,
} from "./types";

/** Sample size at which the live-round average fully drives the
 *  projection. Fewer players = model gets more weight. */
export const TARGET_LIVE_SAMPLE = 30;

/** Auto-match today's pin coords to the nearest cluster centroid.
 *  Returns { letter, distance } or null if the fit has no clusters. */
export function matchPinToCluster(
  fit: HoleFit,
  pinX: number,
  pinY: number,
): { letter: string; distance: number } | null {
  let bestLetter: string | null = null;
  let bestDist = Infinity;
  for (const [letter, c] of Object.entries(fit.clusterCentroids)) {
    const d = Math.hypot(c.x - pinX, c.y - pinY);
    if (d < bestDist) {
      bestDist = d;
      bestLetter = letter;
    }
  }
  if (bestLetter == null) return null;
  return { letter: bestLetter, distance: bestDist };
}

/** Convert a wind FROM direction + speed + hole bearing to the
 *  headwind component along the hole. Positive = into wind. */
export function computeHeadwind(
  windSpeed: number,
  windDirDeg: number,
  holeBearingDeg: number,
): number {
  const rad = ((windDirDeg - holeBearingDeg) * Math.PI) / 180;
  return windSpeed * Math.cos(rad);
}

/** Project one hole's expected strokes-vs-par given the fit,
 *  today's conditions, this hole's bearing, and (optional) live
 *  round observations. When `roundNum` is supplied AND the fit has
 *  per-round baselines for it, the projection anchors on the
 *  round-specific mean instead of the all-rounds mean — R3 at
 *  3M Open plays a stroke softer than the all-rounds mean, so
 *  round-specific baselines materially improve projections.
 *
 *  `levelShift` (optional) is a per-hole additive stroke shift
 *  applied to the model prediction — used to carry through the
 *  "this week is playing softer than the model expects" signal
 *  we compute from R1/R2 residuals on the current tournament. */
export function projectHoleAvgToPar({
  fit,
  bearing,
  conditions,
  liveSample,
  roundNum,
  levelShift = 0,
  targetLiveSample = TARGET_LIVE_SAMPLE,
}: {
  fit: HoleFit;
  bearing: number;
  conditions: TodayConditions;
  liveSample?: LiveSample | null;
  roundNum?: 1 | 2 | 3 | 4;
  levelShift?: number;
  targetLiveSample?: number;
}): HoleProjection {
  const head = computeHeadwind(
    conditions.windSpeed,
    conditions.windDir,
    bearing,
  );

  // Pin cluster residual (0 if we can't match).
  let clusterRes = 0;
  let matchedCluster: string | null = null;
  let clusterMatchDistance: number | null = null;
  if (
    typeof conditions.pinX === "number" &&
    typeof conditions.pinY === "number"
  ) {
    const match = matchPinToCluster(fit, conditions.pinX, conditions.pinY);
    if (match) {
      matchedCluster = match.letter;
      clusterMatchDistance = match.distance;
      clusterRes = fit.clusterResiduals[match.letter] ?? 0;
    }
  }

  // Baseline: round-specific when available, else all-rounds. The
  // reference means for the delta terms follow the same choice so
  // the delta is measured against the same anchor.
  const roundKey = roundNum as 1 | 2 | 3 | 4 | undefined;
  const baseAvg =
    (roundKey != null
      ? fit.histMeanAvgVsParByRound[roundKey]
      : undefined) ?? fit.histMeanAvgVsPar;
  const baseHead =
    (roundKey != null
      ? fit.histMeanHeadByRound[roundKey]
      : undefined) ?? fit.histMeanHead;
  const baseYards =
    (roundKey != null
      ? fit.histMeanYardsByRound[roundKey]
      : undefined) ?? fit.histMeanYards;

  // Model prediction = round-specific baseline + adjustments for
  // today's yards, wind, and pin cluster, plus the week-level shift.
  const modelAvgVsPar =
    baseAvg +
    clusterRes +
    fit.bHead * (head - baseHead) +
    fit.bYards * (conditions.yards - baseYards) +
    levelShift;

  // Blend with live sample (if any).
  let liveWeight = 0;
  let avgVsPar = modelAvgVsPar;
  if (liveSample && liveSample.count > 0) {
    liveWeight = Math.min(1, liveSample.count / targetLiveSample);
    avgVsPar = liveWeight * liveSample.avgVsPar + (1 - liveWeight) * modelAvgVsPar;
  }

  return {
    avgVsPar,
    modelAvgVsPar,
    liveWeight,
    matchedCluster,
    clusterMatchDistance,
  };
}
