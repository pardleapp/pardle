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
  /** Scalar means of the geometric parameters that let the UI
   *  reconstruct an "average" ball flight — an arc through
   *  launch → apex → landing in real units, not from averaged
   *  polynomials (those cancel because each shot's peak lives at a
   *  different time index). */
  shape: {
    carry: number; // yd, forward distance at landing
    carrySide: number; // yd, side offset at landing (+right / −left)
    apexHeight: number; // ft, peak height
    apexRange: number; // ft, forward distance to apex
    apexSide: number; // ft, side offset at apex (+right / −left)
    curve: number; // yd, apex-to-landing lateral drift
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

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Median of a numeric array — used to anchor per-player relative
 *  filtering below without pulling in a stats lib. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Records may include pre-filter historical data (par 3s, 3-wood
 *  layups). Enforce the same absolute constraints as
 *  getTournamentTeeShots at read time — so profiles stay clean
 *  without re-backfilling — then layer a per-player relative filter
 *  on top:
 *
 *  Layer 1 (absolute, matches ingest):
 *    - par ≥ 4
 *    - launch spin ≤ 3500 rpm  (drivers spin 2200–3000; 3-woods 3500+)
 *    - ball speed ≥ 148 mph    (below this is almost never driver)
 *
 *  Layer 2 (per-player relative):
 *    - ball speed ≥ (this player's median ball speed) − 15 mph
 *    A slow driver (e.g. Steven Fisk, median ~168 mph) can still
 *    show 158 mph layups that pass the absolute floor. Anchoring
 *    on the player's own median catches those without over-
 *    filtering big hitters. 15 mph = roughly 3σ of a tour player's
 *    driver ball-speed distribution.
 *
 *  Layer 2 needs enough data to trust the median. With <20 records
 *  we skip it — noisy median would over-filter. */
function eligibleDrives(records: TeeShotRecord[]): TeeShotRecord[] {
  const layer1 = records.filter(
    (r) =>
      r.par >= 4 &&
      // spin=0 means the shot has no radar spin datum stored — don't
      // penalise it via this layer, other filters still gate it.
      (r.launchSpin === 0 || r.launchSpin <= 3500) &&
      r.ballSpeed >= 148,
  );
  if (layer1.length < 20) return layer1;
  const medianBs = medianOf(layer1.map((r) => r.ballSpeed));
  const floor = Math.max(148, medianBs - 15);
  return layer1.filter((r) => r.ballSpeed >= floor);
}

export function buildProfile(
  playerId: string,
  playerName: string,
  allRecords: TeeShotRecord[],
  cloudCap = 400,
): PlayerDrivingProfile {
  const records = eligibleDrives(allRecords);
  const stats = {} as Record<ProfileDimension, StatSummary>;
  for (const dim of PROFILE_DIMENSIONS) {
    stats[dim] = summarize(records.map((r) => valueOf(r, dim)));
  }
  const events = new Set(records.map((r) => r.tournamentId));
  const shape = {
    carry: mean(records.map((r) => r.carry)),
    carrySide: mean(records.map((r) => r.carrySide)),
    apexHeight: mean(records.map((r) => r.apexHeight)),
    apexRange: mean(records.map((r) => r.apexRange)),
    apexSide: mean(records.map((r) => r.apexSide)),
    curve: mean(records.map((r) => r.curve)),
  };
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
    shape,
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
