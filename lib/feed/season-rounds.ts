/**
 * Per-player round-level season data — last ~8 PGA Tour starts with
 * score, eagles, birdies, doubles per round. Powers the rich
 * editorial chips that finish-only recent-form data can't support:
 *
 *   "4th sub-67 round in last 6 starts"
 *   "First eagle since The Players"
 *   "Bouncing back from 3 doubles last week"
 *
 * Data is hand-built by scripts/build-season-rounds.mjs (run weekly
 * after the previous event settles). When the file is empty (the
 * default at deploy time before the script's been run) every lookup
 * returns null and the existing finish-based chips remain the
 * surface — graceful fallback.
 *
 * Server-only — the JSON can run a couple of MB at full population.
 */

import "server-only";
import seasonRoundsRaw from "@/lib/data/season-rounds.json";

export interface SeasonRound {
  season: number;
  tournament: string;
  date: string;
  eventId: number;
  round: number;
  coursePar: number;
  score: number;
  /** strokes - coursePar — positive over par, negative under. */
  vsPar: number;
  eagles: number;
  birdies: number;
  doubles: number;
  sgTotal: number | null;
  sgOtt: number | null;
  sgApp: number | null;
  sgArg: number | null;
  sgPutt: number | null;
}

/** Per-event roll-up — used by the player-page Recent form list +
 *  Season-at-a-glance aggregates. SG fields are SUMS across all
 *  rounds played that event (matching the per-tournament drill-down
 *  page); divide by roundsPlayed for per-round averages. finText is
 *  the DataGolf finish string ("1", "T4", "CUT", "WD", "MC", …). */
export interface SeasonEvent {
  season: number;
  tournament: string;
  date: string;
  eventId: number;
  finText: string | null;
  roundsPlayed: number;
  totalScore: number;
  totalToPar: number;
  sgTotal: number | null;
  sgOtt: number | null;
  sgApp: number | null;
  sgArg: number | null;
  sgPutt: number | null;
}

export interface SeasonRoundsEntry {
  name: string;
  rounds: SeasonRound[];
  events: SeasonEvent[];
}

const DATA = seasonRoundsRaw as Record<string, SeasonRoundsEntry>;

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function getSeasonRoundsByName(
  displayName: string,
): SeasonRoundsEntry | null {
  if (!displayName) return null;
  return DATA[normaliseName(displayName)] ?? null;
}

/** True when the season-rounds dataset has any players loaded. Used
 *  by the chip-picker to fall back to finish-based chips when this
 *  source is empty (deploy day, before the build script runs). */
export function hasSeasonRoundsData(): boolean {
  return Object.keys(DATA).length > 0;
}
