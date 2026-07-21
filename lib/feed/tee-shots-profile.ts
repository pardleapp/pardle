/**
 * Turns a player's raw TeeShotRecord[] into an aggregated driving
 * profile (mean + std of every radar dimension, mean trajectory
 * polynomial) and computes cross-player similarity in that space.
 *
 * Pure functions — no Redis, no fetch. Callers hydrate records
 * from the store and pass them in.
 */

import type { TeeShotRecord } from "@/lib/golf-api/pgatour";

export interface StatSummary {
  mean: number;
  std: number;
  min: number;
  max: number;
}

/** Which dimensions we aggregate + use for similarity. Chosen so
 *  the vector captures "shot shape" not just distance:
 *    ball speed → engine of the drive
 *    carry / total → how far
 *    apex height + vertical launch → trajectory height
 *    horizontal launch angle → aim bias
 *    curve + carry side → fade vs draw magnitude AND direction
 *    launch spin → back-spin proxy
 *    side spin (launchSpin × sin spinAxis) → derived side spin
 */
export const PROFILE_DIMENSIONS = [
  "ballSpeed",
  "carry",
  "apexHeight",
  "verticalLaunchAngle",
  "horizontalLaunchAngle",
  "curve",
  "carrySide",
  "launchSpin",
  "sideSpin",
] as const;
export type ProfileDimension = (typeof PROFILE_DIMENSIONS)[number];

/** Derived side-spin — no dedicated field in the feed. Positive =
 *  spin axis tilts right (encourages fade). */
export function sideSpinOf(rec: TeeShotRecord): number {
  return rec.launchSpin * Math.sin((rec.spinAxis * Math.PI) / 180);
}

function valueOf(rec: TeeShotRecord, dim: ProfileDimension): number {
  if (dim === "sideSpin") return sideSpinOf(rec);
  const v = rec[dim as keyof TeeShotRecord];
  return typeof v === "number" ? v : 0;
}

function summarize(values: number[]): StatSummary {
  if (values.length === 0) return { mean: 0, std: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return {
    mean,
    std: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export interface PlayerDrivingProfile {
  playerId: string;
  playerName: string;
  shotCount: number;
  eventsCovered: number;
  stats: Record<ProfileDimension, StatSummary>;
  /** Element-wise mean of every shot's fit polynomials — the
   *  "average trajectory" the UI draws. */
  averageTrajectory: {
    xFit: number[];
    yFit: number[];
    zFit: number[];
    /** Union of all shots' timeIntervals: use the median max end
     *  so the drawn curve doesn't overshoot into extrapolation. */
    timeInterval: [number, number];
  };
  /** Where individual shots landed relative to the aim line — used
   *  for the shot-cloud scatter. Bounded to keep payload small. */
  cloud: Array<{
    ballSpeed: number;
    carry: number;
    carrySide: number;
    apexHeight: number;
    curve: number;
  }>;
}

/** Element-wise mean of a set of vectors, padded to the longest
 *  length. Vectors of length 0 are skipped. */
function meanVectors(vectors: number[][]): number[] {
  const usable = vectors.filter((v) => v.length > 0);
  if (usable.length === 0) return [];
  const maxLen = Math.max(...usable.map((v) => v.length));
  const sums = new Array(maxLen).fill(0);
  const counts = new Array(maxLen).fill(0);
  for (const v of usable) {
    for (let i = 0; i < v.length; i++) {
      sums[i] += v[i];
      counts[i] += 1;
    }
  }
  return sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildProfile(
  playerId: string,
  playerName: string,
  records: TeeShotRecord[],
  cloudCap = 400,
): PlayerDrivingProfile {
  const stats = {} as Record<ProfileDimension, StatSummary>;
  for (const dim of PROFILE_DIMENSIONS) {
    stats[dim] = summarize(records.map((r) => valueOf(r, dim)));
  }
  const xFit = meanVectors(records.map((r) => r.xFit));
  const yFit = meanVectors(records.map((r) => r.yFit));
  const zFit = meanVectors(records.map((r) => r.zFit));
  const endTimes = records
    .map((r) => r.timeInterval[1])
    .filter((v) => Number.isFinite(v) && v > 0);
  const timeInterval: [number, number] = [0, median(endTimes) || 7];
  const events = new Set(records.map((r) => r.tournamentId));
  // Down-sample the cloud so payloads stay reasonable for players
  // with 2 000+ shots (keep every k'th record).
  let cloud = records.map((r) => ({
    ballSpeed: r.ballSpeed,
    carry: r.carry,
    carrySide: r.carrySide,
    apexHeight: r.apexHeight,
    curve: r.curve,
  }));
  if (cloud.length > cloudCap) {
    const step = Math.ceil(cloud.length / cloudCap);
    cloud = cloud.filter((_, i) => i % step === 0);
  }
  return {
    playerId,
    playerName,
    shotCount: records.length,
    eventsCovered: events.size,
    stats,
    averageTrajectory: { xFit, yFit, zFit, timeInterval },
    cloud,
  };
}

/** Cosine similarity in the normalised-mean space. Normalising by
 *  each dimension's std across all players prevents big-magnitude
 *  dimensions (spin rpm) from swamping small ones (launch angle deg).
 *  Caller supplies the population stats. */
export function similarityScore(
  a: PlayerDrivingProfile,
  b: PlayerDrivingProfile,
  populationStd: Record<ProfileDimension, number>,
): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const dim of PROFILE_DIMENSIONS) {
    const s = populationStd[dim] || 1;
    const va = a.stats[dim].mean / s;
    const vb = b.stats[dim].mean / s;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Compute the population-wide std of every dimension across all
 *  profiles — used as the normaliser in similarityScore. */
export function populationStds(
  profiles: PlayerDrivingProfile[],
): Record<ProfileDimension, number> {
  const out = {} as Record<ProfileDimension, number>;
  for (const dim of PROFILE_DIMENSIONS) {
    out[dim] = summarize(profiles.map((p) => p.stats[dim].mean)).std;
  }
  return out;
}

/** Euclidean distance in normalised dimension space — sometimes
 *  reads better than cosine for "closest golfer" because cosine
 *  ignores magnitude (a player with the same shape but 20 mph less
 *  ball speed is treated as identical). Distance surfaces the
 *  ball-speed gap too. */
export function distanceScore(
  a: PlayerDrivingProfile,
  b: PlayerDrivingProfile,
  populationStd: Record<ProfileDimension, number>,
): number {
  let sum = 0;
  for (const dim of PROFILE_DIMENSIONS) {
    const s = populationStd[dim] || 1;
    const d = (a.stats[dim].mean - b.stats[dim].mean) / s;
    sum += d * d;
  }
  return Math.sqrt(sum);
}
