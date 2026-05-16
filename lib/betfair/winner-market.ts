/**
 * Find Betfair's "Winner" market for the active PGA Tour tournament,
 * and build a mapping from Betfair runner ids → orchestrator
 * playerIds. Cached in Redis so we don't repeat catalogue lookups
 * on every odds poll.
 *
 * Runner names: Betfair uses "Surname, First Name" (e.g. "Scheffler,
 * Scottie"); the orchestrator's `displayName` is "First Last"
 * (e.g. "Scottie Scheffler"). We match on a normalised "first last"
 * string after stripping accents.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import {
  listGolfEvents,
  listMarketCatalogue,
  type Auth,
} from "./client";
import { withBetfairAuth } from "./session";
import type { CachedLeaderboardRow } from "@/lib/feed/store";

const redis = Redis.fromEnv();

const MARKET_KEY_PREFIX = "betfair:winner-market:";
const MARKET_TTL_S = 24 * 60 * 60; // 24h — re-discover daily

export interface WinnerMarketInfo {
  betfairEventId: string;
  betfairEventName: string;
  marketId: string;
  /** Betfair selectionId → orchestrator playerId. */
  runnerToPlayer: Record<string, string>;
  /** orchestrator playerId → Betfair selectionId (inverse). */
  playerToRunner: Record<string, number>;
}

function marketKey(tournamentId: string): string {
  return `${MARKET_KEY_PREFIX}${tournamentId}`;
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

/** Convert Betfair "Last, First" → normalised "first last". */
function betfairToFirstLast(runner: string): string {
  const parts = runner.split(",").map((s) => s.trim());
  if (parts.length === 2) return norm(`${parts[1]} ${parts[0]}`);
  return norm(runner);
}

/** Build the runner ↔ player maps by joining on normalised display name. */
export function buildRunnerMaps(
  runners: { selectionId: number; runnerName: string }[],
  leaderboard: CachedLeaderboardRow[],
): {
  runnerToPlayer: Record<string, string>;
  playerToRunner: Record<string, number>;
} {
  const byName = new Map<string, string>();
  for (const r of leaderboard) byName.set(norm(r.displayName), r.playerId);

  const runnerToPlayer: Record<string, string> = {};
  const playerToRunner: Record<string, number> = {};
  for (const r of runners) {
    const key = betfairToFirstLast(r.runnerName);
    const pid = byName.get(key);
    if (!pid) continue;
    runnerToPlayer[String(r.selectionId)] = pid;
    playerToRunner[pid] = r.selectionId;
  }
  return { runnerToPlayer, playerToRunner };
}

/**
 * Discover (or refresh) the Betfair winner-market for an active
 * PGA tournament. Caller passes the orchestrator's tournament name
 * (e.g. "PGA Championship") + the full leaderboard for name-matching.
 */
export async function discoverWinnerMarket(
  tournamentId: string,
  tournamentName: string,
  leaderboard: CachedLeaderboardRow[],
): Promise<WinnerMarketInfo | null> {
  return withBetfairAuth(async (auth) =>
    discoverImpl(auth, tournamentId, tournamentName, leaderboard),
  );
}

async function discoverImpl(
  auth: Auth,
  tournamentId: string,
  tournamentName: string,
  leaderboard: CachedLeaderboardRow[],
): Promise<WinnerMarketInfo | null> {
  const events = await listGolfEvents(auth);
  // Fuzzy match on tournament name — orchestrator might call it
  // "PGA Championship" while Betfair uses "PGA Championship 2026".
  const needle = norm(tournamentName);
  const event = events.find((e) => norm(e.event.name).includes(needle));
  if (!event) return null;

  const markets = await listMarketCatalogue(auth, {
    eventId: event.event.id,
    marketTypeCodes: ["WINNER"],
    maxResults: 5,
  });
  // Take the first WINNER market (rarely more than one outright).
  const winner = markets[0];
  if (!winner) return null;

  const maps = buildRunnerMaps(winner.runners, leaderboard);
  const info: WinnerMarketInfo = {
    betfairEventId: event.event.id,
    betfairEventName: event.event.name,
    marketId: winner.marketId,
    ...maps,
  };
  await redis.set(marketKey(tournamentId), info, { ex: MARKET_TTL_S });
  return info;
}

export async function getCachedWinnerMarket(
  tournamentId: string,
): Promise<WinnerMarketInfo | null> {
  return (
    (await redis.get<WinnerMarketInfo>(marketKey(tournamentId))) ?? null
  );
}
