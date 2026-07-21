/**
 * Persistent store for the driving-analysis surfaces.
 *
 * Backfill script writes per-player tee-shot records (all radar
 * measurements + trajectory polynomials) into Redis; API routes
 * read from here and compute profiles + similarity on demand.
 *
 * Keys:
 *   tee:index                → sorted-set of playerIds by shot count desc
 *   tee:player:{playerId}    → JSON array of TeeShotRecord
 *   tee:name:{playerId}      → display name (denorm for UI convenience)
 *   tee:profile:{playerId}   → cached aggregate profile (mean+std)
 *   tee:sim:{playerId}       → cached top-K similarity ranking
 *
 * TTL: 30 days on player-shot data (season historicals don't
 * change). Profile + similarity caches are also 30-day; invalidate
 * by version-tagging keys when the aggregation logic changes.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import type { TeeShotRecord } from "@/lib/golf-api/pgatour";

const redis = Redis.fromEnv();

const PLAYER_TTL_SECONDS = 30 * 24 * 60 * 60;

export function teePlayerKey(playerId: string): string {
  return `tee:player:${playerId}`;
}
export function teeNameKey(playerId: string): string {
  return `tee:name:${playerId}`;
}
export function teeProfileKey(playerId: string): string {
  return `tee:profile:${playerId}`;
}
export function teeSimilarityKey(playerId: string): string {
  return `tee:sim:${playerId}`;
}
export const TEE_INDEX_KEY = "tee:index";

/** Append `records` to the persisted list for a single player and
 *  bump their entry in the global index sorted-set. Idempotent
 *  within a single tournament, but callers shouldn't feed the same
 *  (tournament, round) twice — dedup by (tournamentId, round, hole)
 *  before invoking if resumption is possible. */
export async function appendTeeShots(
  playerId: string,
  playerName: string,
  records: TeeShotRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  const existing = (await redis.get<TeeShotRecord[]>(teePlayerKey(playerId))) ?? [];
  const merged = [...existing, ...records];
  await redis.set(teePlayerKey(playerId), merged, { ex: PLAYER_TTL_SECONDS });
  await redis.set(teeNameKey(playerId), playerName, { ex: PLAYER_TTL_SECONDS });
  await redis.zadd(TEE_INDEX_KEY, { score: merged.length, member: playerId });
  return merged.length;
}

/** Overwrite one player's stored records — used when re-processing
 *  after a dedup pass. */
export async function putTeeShots(
  playerId: string,
  playerName: string,
  records: TeeShotRecord[],
): Promise<void> {
  if (records.length === 0) {
    await redis.del(teePlayerKey(playerId));
    await redis.del(teeNameKey(playerId));
    await redis.zrem(TEE_INDEX_KEY, playerId);
    return;
  }
  await redis.set(teePlayerKey(playerId), records, { ex: PLAYER_TTL_SECONDS });
  await redis.set(teeNameKey(playerId), playerName, { ex: PLAYER_TTL_SECONDS });
  await redis.zadd(TEE_INDEX_KEY, { score: records.length, member: playerId });
}

export async function getTeeShots(
  playerId: string,
): Promise<TeeShotRecord[] | null> {
  return await redis.get<TeeShotRecord[]>(teePlayerKey(playerId));
}

export async function getPlayerName(
  playerId: string,
): Promise<string | null> {
  return await redis.get<string>(teeNameKey(playerId));
}

/** All playerIds we have data for, ranked by shot count desc.
 *  Powers the /analysis/tee-shots player-picker. */
export async function listRankedPlayers(
  limit = 300,
): Promise<Array<{ playerId: string; shotCount: number }>> {
  const raw = await redis.zrange<Array<string | number>>(
    TEE_INDEX_KEY,
    0,
    limit - 1,
    { rev: true, withScores: true },
  );
  const out: Array<{ playerId: string; shotCount: number }> = [];
  for (let i = 0; i < raw.length; i += 2) {
    const playerId = String(raw[i]);
    const shotCount = Number(raw[i + 1]);
    if (playerId && Number.isFinite(shotCount)) out.push({ playerId, shotCount });
  }
  return out;
}
