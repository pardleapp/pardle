/**
 * Per-player projection: estimate a player's expected remaining
 * strokes-to-par given their tee time, current thru, and today's
 * setup. Uses the fitted scoring model per hole and — when an HRRR
 * hourly forecast is available — reads the wind at each hole's
 * expected time-of-play so morning players and afternoon players
 * get different projections when the wind builds through the day.
 *
 * Pure function — takes all inputs in, no I/O. Callers assemble the
 * fitted coefficients, hourly wind, and today's pins/yardages via
 * the server-side loaders and pass them here.
 */

import type { HourlyWind } from "./hrrr-hourly";
import { windAtHour } from "./hrrr-hourly";
import { projectHoleAvgToPar } from "./project";
import type {
  HoleFit,
  LiveSample,
  ScoringModelCoefficients,
  TodayConditions,
} from "./types";

/** Rough seconds per hole for a PGA tour group. Used to estimate
 *  when a player will be standing on each remaining hole. */
export const MINUTES_PER_HOLE = 15;

/** Today's per-hole setup. */
export interface TodaySetup {
  /** Per-hole yardage today (as posted on the tee sheet). */
  yardsByHole: Record<number, number>;
  /** Per-hole pin coord today, if known. Falls back to no pin
   *  adjustment when a hole is missing. */
  pinByHole?: Record<number, { x: number; y: number }>;
  /** Per-hole bearings for the venue. */
  bearingsByHole: Record<number, number>;
}

/** Live-round observations aggregated by hole. */
export type LiveSampleByHole = Record<number, LiveSample | null>;

/** Inputs for a single player's remaining-holes projection. */
export interface PerPlayerInputs {
  /** The player's expected time-of-tee, in local hours (fractional
   *  OK — e.g. 13.5 = 1:30 PM). */
  teeHourLocal: number;
  /** Which hole they started on (1 or 10 typically). */
  startHole: number;
  /** How many holes they've completed at snapshot time. */
  thruHoles: number;
  /** Player's SG-total (strokes per round vs field). Applied as a
   *  per-hole delta of (−sgTotal / 18) on the remaining holes. */
  sgTotal: number;
  /** Fitted scoring-model coefficients for the tournament. */
  coefficients: ScoringModelCoefficients;
  /** Today's setup — yards + pins + bearings. */
  setup: TodaySetup;
  /** Hourly wind forecast (HRRR). If empty, falls back to a single
   *  "current" wind reading used for every remaining hole. */
  hourlyWind: HourlyWind[];
  /** Fallback single-wind reading when hourly is empty (e.g. current
   *  average). */
  fallbackWind?: { windMph: number; windDirDeg: number };
  /** Per-hole live-round observations, blended in per hole. */
  liveByHole?: LiveSampleByHole;
  /** Round number (1-4) for round-specific baseline selection. */
  roundNum?: 1 | 2 | 3 | 4;
  /** Optional per-hole additive stroke shift capturing "this week is
   *  playing softer than the model expects" (from R1/R2 residuals). */
  levelShift?: number;
}

/** Which holes does a player have left, given their starting hole and
 *  thru count? Wraps 18→1 for back-nine starters. */
export function remainingHoles(startHole: number, thruHoles: number): number[] {
  const start = Math.max(1, Math.min(18, Math.floor(startHole)));
  const thru = Math.max(0, Math.min(18, Math.floor(thruHoles)));
  const out: number[] = [];
  const total = 18 - thru;
  for (let i = 0; i < total; i++) {
    const offset = thru + i;
    const h = ((start - 1 + offset) % 18) + 1;
    out.push(h);
  }
  return out;
}

/** Per-hole detail from the projection — useful for debugging and
 *  for the tooltip on the bet chart. */
export interface RemainingHoleDetail {
  hole: number;
  /** Expected clock hour (local) when the player plays this hole. */
  expectedHourLocal: number;
  /** Wind at that hour. */
  wind: { windMph: number; windDirDeg: number };
  /** Model projection for the hole (blended with any live sample). */
  avgVsPar: number;
  /** Cluster letter matched from the pin coord (if any). */
  matchedCluster: string | null;
  /** Live-sample weight used in the blend (0-1). */
  liveWeight: number;
}

export interface PerPlayerProjection {
  /** Sum of expected strokes-vs-par across all remaining holes
   *  BEFORE applying the player's skill delta. This is the
   *  "field-anchored" expected tail. */
  fieldExpectedRemainingToPar: number;
  /** Sum after applying the per-hole skill delta of (−sg/18). */
  playerExpectedRemainingToPar: number;
  /** Per-hole breakdown — same order as the returned hole numbers. */
  details: RemainingHoleDetail[];
}

/** Compute the full remaining-holes projection for one player. */
export function projectRemainingForPlayer(
  input: PerPlayerInputs,
): PerPlayerProjection {
  const remaining = remainingHoles(input.startHole, input.thruHoles);
  const details: RemainingHoleDetail[] = [];
  let fieldSum = 0;
  const perHoleSkillDelta = -input.sgTotal / 18;

  for (let i = 0; i < remaining.length; i++) {
    const hole = remaining[i];
    const fit: HoleFit | null = input.coefficients.holes[hole] ?? null;
    const bearing = input.setup.bearingsByHole[hole];
    const yards = input.setup.yardsByHole[hole];

    // Expected time-of-play — 15 min per hole from tee-off.
    const expectedHour =
      input.teeHourLocal + ((input.thruHoles + i) * MINUTES_PER_HOLE) / 60;

    // Read wind at that hour from the HRRR series, else fall back.
    const windAt = windAtHour(input.hourlyWind, expectedHour);
    const wind =
      windAt ??
      input.fallbackWind ??
      { windMph: 0, windDirDeg: 0 };

    // Live sample for this hole (if any).
    const live = input.liveByHole?.[hole] ?? null;

    let avgVsPar = 0;
    let matchedCluster: string | null = null;
    let liveWeight = 0;

    if (fit && typeof bearing === "number" && typeof yards === "number") {
      const pin = input.setup.pinByHole?.[hole];
      const conditions: TodayConditions = {
        yards,
        windSpeed: wind.windMph,
        windDir: wind.windDirDeg,
        pinX: pin?.x,
        pinY: pin?.y,
      };
      const proj = projectHoleAvgToPar({
        fit,
        bearing,
        conditions,
        liveSample: live,
        roundNum: input.roundNum,
        levelShift: input.levelShift ?? 0,
      });
      avgVsPar = proj.avgVsPar;
      matchedCluster = proj.matchedCluster;
      liveWeight = proj.liveWeight;
    } else if (live) {
      // Model unavailable — fall back to live observation if any.
      avgVsPar = live.avgVsPar;
      liveWeight = 1;
    }

    fieldSum += avgVsPar;
    details.push({
      hole,
      expectedHourLocal: expectedHour,
      wind,
      avgVsPar,
      matchedCluster,
      liveWeight,
    });
  }

  return {
    fieldExpectedRemainingToPar: fieldSum,
    playerExpectedRemainingToPar:
      fieldSum + remaining.length * perHoleSkillDelta,
    details,
  };
}
