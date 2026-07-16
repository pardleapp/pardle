/**
 * Course-trend signal for the hole-by-hole scoring average chart.
 *
 * Computed server-side because the client's 80-event window spans
 * only ~1-2 min of activity — far too tight for a meaningful trend.
 * The Redis buffer holds up to 1000 events (~10-30 min at active-
 * round shot rates), which is where a real "wind picked up" or
 * "pin positions got nasty" shift shows up.
 *
 * Method: split completed-hole score events for the target round
 * into a newer half vs older half, compare mean (strokes − par).
 * Positive delta → course is playing HARDER in the recent window
 * vs earlier. Negative → EASIER. Below a small deadband → null
 * (no signal).
 */

import type { FeedEvent } from "./types";

export interface CourseTrend {
  /** Mean(strokes-par) of the newer half minus older half. Positive
   *  = harder recently. */
  delta: number;
  /** Count in the recent half (for client-side gating / display). */
  recentCount: number;
  /** Count in the older half. */
  olderCount: number;
  /** True when |delta| clears the noise floor and both halves have
   *  enough events for the signal to mean something. */
  hasSignal: boolean;
}

const TREND_MIN_HALF_COUNT = 15;
const TREND_MIN_DELTA = 0.15;

export function computeCourseTrend(
  events: FeedEvent[],
  targetRound: number | null,
): CourseTrend {
  const scoreEvents: Array<{ ts: number; diff: number }> = [];
  for (const ev of events) {
    if (ev.type !== "score") continue;
    if (typeof ev.strokes !== "number") continue;
    if (typeof ev.par !== "number") continue;
    if (targetRound != null && ev.round !== targetRound) continue;
    scoreEvents.push({ ts: ev.ts, diff: ev.strokes - ev.par });
  }
  if (scoreEvents.length === 0) {
    return { delta: 0, recentCount: 0, olderCount: 0, hasSignal: false };
  }
  scoreEvents.sort((a, b) => b.ts - a.ts);
  const midpoint = Math.floor(scoreEvents.length / 2);
  const recent = scoreEvents.slice(0, midpoint);
  const older = scoreEvents.slice(midpoint);
  if (
    recent.length < TREND_MIN_HALF_COUNT ||
    older.length < TREND_MIN_HALF_COUNT
  ) {
    return {
      delta: 0,
      recentCount: recent.length,
      olderCount: older.length,
      hasSignal: false,
    };
  }
  const recentMean =
    recent.reduce((a, s) => a + s.diff, 0) / recent.length;
  const olderMean = older.reduce((a, s) => a + s.diff, 0) / older.length;
  const delta = recentMean - olderMean;
  return {
    delta,
    recentCount: recent.length,
    olderCount: older.length,
    hasSignal: Math.abs(delta) >= TREND_MIN_DELTA,
  };
}
