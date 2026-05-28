/**
 * Discover the Polymarket "Winner" event for the active PGA tournament
 * and build a mapping from child-market id → orchestrator playerId.
 *
 * Polymarket event titles look like "2026 PGA Championship Winner";
 * child market questions look like "Will Scottie Scheffler win the
 * 2026 PGA Championship?". Each market is a yes/no on one player.
 *
 * Cache the discovered (eventId, marketId → playerId) map in Redis
 * for 24 hours so we don't list-and-fuzzy-match on every poll.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import {
  getEvent,
  listGolfEvents,
  type PolymarketChildMarket,
} from "./client";
import type { CachedLeaderboardRow } from "@/lib/feed/store";

const redis = Redis.fromEnv();

const CACHE_PREFIX = "polymarket:winner-event:";
const CACHE_TTL_S = 24 * 60 * 60;
// Negative cache for "no event found" — lots of smaller PGA events
// (Schwab Challenge, Sanderson Farms, etc.) have no Polymarket market
// at all. Without this, every viewer hit re-lists golf events from
// the gamma-api at ~500 ms each. 10 min is short enough that a market
// appearing mid-tournament gets picked up within minutes.
const MISS_CACHE_PREFIX = "polymarket:winner-event-miss:";
const MISS_CACHE_TTL_S = 10 * 60;
function missKey(tournamentId: string): string {
  return `${MISS_CACHE_PREFIX}${tournamentId}`;
}

export interface WinnerEventInfo {
  eventId: number;
  eventTitle: string;
  /** child market id → orchestrator playerId */
  marketToPlayer: Record<string, string>;
}

function cacheKey(tournamentId: string): string {
  return `${CACHE_PREFIX}${tournamentId}`;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the player name from a Polymarket child-market question.
 * Pattern: "Will <Player Name> win the <Tournament>?". Returns the
 * normalised "first last" string, or null if the pattern doesn't fit.
 */
function playerNameFromQuestion(question: string): string | null {
  const m = /^will\s+(.+?)\s+win\s+the\b/i.exec(question.trim());
  if (!m) return null;
  return norm(m[1]);
}

/**
 * Join Polymarket child markets onto the orchestrator leaderboard by
 * normalised player name.
 */
export function buildMarketToPlayer(
  markets: PolymarketChildMarket[],
  leaderboard: CachedLeaderboardRow[],
): Record<string, string> {
  const byName = new Map<string, string>();
  for (const r of leaderboard) byName.set(norm(r.displayName), r.playerId);
  const result: Record<string, string> = {};
  for (const m of markets) {
    const key = playerNameFromQuestion(m.question);
    if (!key) continue;
    const pid = byName.get(key);
    if (!pid) continue;
    result[m.id] = pid;
  }
  return result;
}

/**
 * Discover the active tournament's winner event on Polymarket. Match
 * on tournament name in the event title (e.g. "PGA Championship"
 * inside "2026 PGA Championship Winner").
 */
export async function discoverWinnerEvent(
  tournamentId: string,
  tournamentName: string,
  leaderboard: CachedLeaderboardRow[],
): Promise<WinnerEventInfo | null> {
  // Negative cache short-circuit — when we already failed to find a
  // market in the last MISS_CACHE_TTL_S window, skip the gamma-api
  // list call.
  const recentMiss = await redis.get<number>(missKey(tournamentId));
  if (recentMiss) return null;

  const events = await listGolfEvents();
  const needle = norm(tournamentName);
  // Prefer events that contain BOTH the tournament name and the word
  // "winner" (vs side-markets like "Top 5", "Top 10").
  const winnerEvents = events.filter((e) => {
    const t = norm(e.title);
    return t.includes(needle) && t.includes("winner");
  });
  if (winnerEvents.length === 0) {
    await redis.set(missKey(tournamentId), Date.now(), {
      ex: MISS_CACHE_TTL_S,
    });
    return null;
  }
  // Most-liquid event wins ties.
  winnerEvents.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const event = winnerEvents[0];

  const full = await getEvent(event.id);
  const marketToPlayer = buildMarketToPlayer(full.markets, leaderboard);
  const info: WinnerEventInfo = {
    eventId: event.id,
    eventTitle: event.title,
    marketToPlayer,
  };
  await redis.set(cacheKey(tournamentId), info, { ex: CACHE_TTL_S });
  return info;
}

export async function getCachedWinnerEvent(
  tournamentId: string,
): Promise<WinnerEventInfo | null> {
  return (
    (await redis.get<WinnerEventInfo>(cacheKey(tournamentId))) ?? null
  );
}
