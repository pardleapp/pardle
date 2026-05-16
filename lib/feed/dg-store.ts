/**
 * Rolling buffer of DataGolf live win probabilities per player.
 * Used as the fallback source for the outright bet chart when
 * Polymarket's per-player buffer is too thin to draw a useful line
 * (illiquid longshot markets, dedup collapse, late-starting market
 * tracking, etc.).
 *
 * Storage: one Redis hash per tournament, `feed:dg:{tournamentId}` →
 * { playerId → JSON snapshot list }. Each snapshot is `{ ts, prob }`.
 * Trimmed to the last MAX_SAMPLES on write.
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const HASH_PREFIX = "feed:dg:";
// Polled every ~3 minutes via cron, so 720 samples gives ~36 hours
// of coverage — plenty for one tournament day's chart window even
// across early tee times.
const MAX_SAMPLES = 720;

export interface DgProbSample {
  ts: number;
  /** Live win probability, 0..1. */
  prob: number;
}

function key(t: string): string {
  return `${HASH_PREFIX}${t}`;
}

/**
 * Append the current win prob reading for each matched player. We
 * don't dedup tightly — DataGolf samples are sparse-ish (one per ~3
 * min) and the chart benefits from regular data points even when
 * probability is roughly flat.
 */
export async function pushDgProbSamples(
  tournamentId: string,
  latest: Record<string, number>,
  ts: number,
): Promise<{ updated: number; players: number }> {
  const pids = Object.keys(latest);
  if (pids.length === 0) return { updated: 0, players: 0 };

  const existing = await redis.hmget<Record<string, DgProbSample[]>>(
    key(tournamentId),
    ...pids,
  );
  const writes: Record<string, DgProbSample[]> = {};
  let updated = 0;
  for (const pid of pids) {
    const buf: DgProbSample[] = existing?.[pid] ?? [];
    const prob = latest[pid];
    if (!Number.isFinite(prob) || prob < 0 || prob > 1) continue;
    buf.push({ ts, prob });
    writes[pid] = buf.slice(-MAX_SAMPLES);
    updated++;
  }

  if (Object.keys(writes).length === 0) {
    return { updated, players: pids.length };
  }
  await redis.hset(key(tournamentId), writes);
  return { updated, players: pids.length };
}

export async function getDgProbBuffers(
  tournamentId: string,
  playerIds: string[],
): Promise<Record<string, DgProbSample[] | null>> {
  if (playerIds.length === 0) return {};
  const v = await redis.hmget<Record<string, DgProbSample[] | null>>(
    key(tournamentId),
    ...playerIds,
  );
  return v ?? {};
}
