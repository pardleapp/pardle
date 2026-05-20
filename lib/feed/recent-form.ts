/**
 * Recent-form lookup — last 5-8 PGA Tour starts per player, surfaced as
 * sparklines next to player names on bet cards, the bet picker, the
 * player page, and the leaderboard.
 *
 * Source: hand-built JSON committed at `lib/data/recent-form.json`,
 * pre-processed from the sibling `golf-model/data/tournament_results.csv`
 * dataset. Refreshed weekly via `scripts/build-recent-form.mjs`.
 *
 * Lookup is by normalised player name so the file stays decoupled from
 * which playerId scheme the live feed happens to use (orchestrator,
 * DataGolf, IMG, etc.) — same pattern we already use to join DataGolf
 * stats onto the leaderboard.
 *
 * Server-only — the JSON is ~900 KB and never ships to the browser.
 */

import "server-only";
import recentFormRaw from "@/lib/data/recent-form.json";

export interface RecentEvent {
  season: number;
  tournament: string;
  finishText: string;
  finishPos: number | null;
  madeCut: boolean;
}

export interface RecentForm {
  name: string;
  recent: RecentEvent[];
}

const DATA = recentFormRaw as Record<string, RecentForm>;

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function getRecentFormByName(displayName: string): RecentForm | null {
  if (!displayName) return null;
  const key = normaliseName(displayName);
  return DATA[key] ?? null;
}

/**
 * Bulk fetch — returns a map keyed by the input `playerId` so callers
 * can join straight onto leaderboard rows or bet lists without re-
 * normalising. Sparse: players we can't match by name are simply
 * absent from the result.
 */
export function getRecentFormBulk(
  players: Array<{ playerId: string; displayName: string }>,
): Record<string, RecentForm> {
  const out: Record<string, RecentForm> = {};
  for (const p of players) {
    const f = getRecentFormByName(p.displayName);
    if (f) out[p.playerId] = f;
  }
  return out;
}

/**
 * "Trend" of a player's last 5 finishes — compares the avg position
 * of the last 3 starts to the prior 2. Used for the ↗ / ↘ / —
 * indicator next to the sparkline. CUT/MC count as position 80
 * (rough field midpoint for missed-cut grade) so a streak of MCs
 * registers as drift down.
 */
export function trendFor(recent: RecentEvent[]): "up" | "down" | "flat" {
  if (recent.length < 5) return "flat";
  // recent[0] is newest
  const scoreOf = (e: RecentEvent) =>
    e.finishPos ?? (e.madeCut ? 80 : 90);
  const newer = (scoreOf(recent[0]) + scoreOf(recent[1]) + scoreOf(recent[2])) / 3;
  const older = (scoreOf(recent[3]) + scoreOf(recent[4])) / 2;
  const diff = older - newer; // positive = improving (lower position = better)
  if (diff > 8) return "up";
  if (diff < -8) return "down";
  return "flat";
}
