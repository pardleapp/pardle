/**
 * DataGolf live-tournament-stats cache. The player page needs the
 * full SG breakdown + driving/GIR/etc for a player, plus per-round
 * variants. DataGolf's endpoint returns the whole field per request,
 * so we cache the field-wide payload in Redis with a short TTL and
 * each render reads from the cache.
 *
 * Server-only.
 */
import "server-only";
import { Redis } from "@upstash/redis";
import {
  getFullLiveStats,
  type FullLiveStats,
} from "@/lib/golf-api/datagolf";

const redis = Redis.fromEnv();

const TTL_S = 5 * 60;

function key(tournamentId: string, round: number | "event_avg"): string {
  // v2: distance/accuracy field rename. Bumping invalidates the
  // stale payloads that had nulls for those two fields.
  return `feed:livestats:v2:${tournamentId}:${round}`;
}

/** Tracks the last time we force-busted this tournament's stats so a
 *  bad-scoring stretch (multiple top players bogeying in the same
 *  minute) doesn't hammer DataGolf. 90 s grace = at most one bust
 *  every 90 s, which is plenty given DataGolf itself lags ~2 min. */
const BUST_GRACE_S = 90;

/**
 * Force-bust this tournament's cached live stats so the next read
 * fetches fresh from DataGolf. Rate-limited per tournament so a bad
 * scoring stretch doesn't hammer the upstream. Returns true when the
 * bust actually happened.
 *
 * Called from the feed engine when a top-skill player drops a stroke
 * — that's the exact moment a user opens their page and finds an
 * "SG #1 in field" headline that no longer reflects the latest
 * holes.
 */
export async function bustLiveStatsCacheIfFresh(
  tournamentId: string,
): Promise<boolean> {
  const graceKey = `feed:livestats:lastbust:${tournamentId}`;
  const recent = await redis.get<number>(graceKey);
  if (recent) return false;
  await redis.set(graceKey, Date.now(), { ex: BUST_GRACE_S });
  // Bust event_avg + all per-round keys. R1..R4 covers everything
  // we'd ever cache; missed keys are harmless no-ops.
  const keys = [
    key(tournamentId, "event_avg"),
    key(tournamentId, 1),
    key(tournamentId, 2),
    key(tournamentId, 3),
    key(tournamentId, 4),
  ];
  await redis.del(...keys);
  return true;
}

/**
 * Read the cached payload, refreshing from DataGolf on miss.
 * Returns an empty array if the upstream fetch fails so a flaky
 * DataGolf call degrades the player page (missing stats section)
 * rather than crashing the route.
 */
export async function getLiveStatsCached(
  tournamentId: string,
  round: number | "event_avg" = "event_avg",
): Promise<FullLiveStats[]> {
  const k = key(tournamentId, round);
  const cached = await redis.get<FullLiveStats[]>(k);
  if (cached) return cached;
  let fresh: FullLiveStats[] = [];
  try {
    fresh = await getFullLiveStats(round);
  } catch (err) {
    console.error("[live-stats-cache] DataGolf fetch failed", err);
    return [];
  }
  await redis.set(k, fresh, { ex: TTL_S });
  return fresh;
}

/**
 * Compute the field rank for a value across the supplied stats list.
 * `lowerIsBetter` flips the ordering for stats where lower is better
 * (proximity, score-to-par).
 */
export function fieldRank(
  stats: FullLiveStats[],
  pick: (s: FullLiveStats) => number | null,
  value: number,
  lowerIsBetter = false,
): { rank: number; outOf: number } | null {
  const vals = stats
    .map(pick)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  const better = vals.filter((v) =>
    lowerIsBetter ? v < value : v > value,
  ).length;
  return { rank: better + 1, outOf: vals.length };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function findStatsByName(
  stats: FullLiveStats[],
  displayName: string,
): FullLiveStats | null {
  const target = normalizeName(displayName);
  return stats.find((s) => normalizeName(s.name) === target) ?? null;
}
