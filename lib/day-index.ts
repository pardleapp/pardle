/**
 * Game launch dates and helpers for computing the "Day N" index used
 * across the games + stats backend. Centralised so the /today stats
 * page can read the same dayNumber that each game writes.
 */

import type { StatsGameId } from "./stats-backend";

const LAUNCH: Record<StatsGameId, number> = {
  pros: Date.UTC(2026, 4, 9),
  holes: Date.UTC(2026, 4, 10),
  clubs: Date.UTC(2026, 4, 11),
  connections: Date.UTC(2026, 4, 11),
  trivia: Date.UTC(2026, 4, 11),
  faces: Date.UTC(2026, 4, 11),
};

function todayUtc(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
}

/** Day number (1-indexed) for a given game today. */
export function todayDayNumber(game: StatsGameId): number {
  return Math.floor((todayUtc() - LAUNCH[game]) / (1000 * 60 * 60 * 24)) + 1;
}
