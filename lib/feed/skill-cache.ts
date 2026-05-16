/**
 * DataGolf skill cache. The round-score bet model uses `sg_total`
 * (strokes gained per round vs the current field) as a per-player
 * skill prior. We fetch DataGolf once per day per tournament and
 * resolve their `dg_id`-keyed list to the PGA Tour `playerId` map we
 * use everywhere else by name matching.
 *
 * Server-only.
 */
import "server-only";
import { getSkillRatings } from "@/lib/golf-api/datagolf";
import {
  cachePlayerSkill,
  getCachedPlayerSkill,
  type CachedLeaderboardRow,
  type PlayerSkillMap,
} from "./store";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Returns the per-PGA-id skill map for this tournament, fetching +
 * caching from DataGolf if the Redis copy is missing. Cache TTL is
 * 24h so the SG estimate refreshes daily during a tournament.
 *
 * Falls back to an empty map on any failure — the model degrades to
 * "no skill adjustment" rather than blowing up the whole feed.
 */
export async function ensurePlayerSkill(
  tournamentId: string,
  leaderboard: CachedLeaderboardRow[],
): Promise<PlayerSkillMap> {
  const cached = await getCachedPlayerSkill(tournamentId);
  if (cached) return cached;
  if (leaderboard.length === 0) return {};

  let ratings: { name: string; sgTotal: number }[];
  try {
    ratings = await getSkillRatings();
  } catch (err) {
    console.error("[skill-cache] DataGolf fetch failed", err);
    return {};
  }

  const ratingByNorm = new Map<string, number>();
  for (const r of ratings) {
    ratingByNorm.set(normalizeName(r.name), r.sgTotal);
  }

  const map: PlayerSkillMap = {};
  for (const row of leaderboard) {
    const norm = normalizeName(row.displayName);
    const sg = ratingByNorm.get(norm);
    if (typeof sg === "number" && Number.isFinite(sg)) {
      map[row.playerId] = sg;
    }
  }

  await cachePlayerSkill(tournamentId, map);
  return map;
}
