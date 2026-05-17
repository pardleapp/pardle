/**
 * Rolling buffer of DraftKings top-X decimal odds per (player,
 * cutoff). Powers the top-finish bet's current value and trajectory
 * chart. One Redis hash per (tournament, cutoff) keyed by playerId,
 * value is a JSON array of `{ ts, p }` samples — same shape as the
 * Polymarket odds buffer so the chart code can read it uniformly.
 *
 * Server-only.
 */
import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const HASH_PREFIX = "feed:dk-top:";
const MAX_SAMPLES = 720; // ~12h at 1/min

export interface DKOddsSample {
  ts: number;
  /** Decimal odds. */
  p: number;
}

export type TopCutoff = 5 | 10 | 20;

function key(tournamentId: string, cutoff: TopCutoff): string {
  return `${HASH_PREFIX}${tournamentId}:${cutoff}`;
}

export async function pushDKTopOdds(
  tournamentId: string,
  cutoff: TopCutoff,
  latest: Record<string, number>,
  ts: number,
): Promise<{ updated: number; players: number }> {
  const pids = Object.keys(latest);
  if (pids.length === 0) return { updated: 0, players: 0 };

  const existing = await redis.hmget<Record<string, DKOddsSample[]>>(
    key(tournamentId, cutoff),
    ...pids,
  );
  const writes: Record<string, DKOddsSample[]> = {};
  let updated = 0;
  const FORCE_PUSH_MS = 5 * 60 * 1000;
  for (const pid of pids) {
    const buf: DKOddsSample[] = existing?.[pid] ?? [];
    const newPrice = latest[pid];
    if (!Number.isFinite(newPrice) || newPrice <= 1) continue;
    const head = buf[buf.length - 1];
    if (head) {
      const rel = Math.abs(newPrice - head.p) / head.p;
      const ageMs = ts - head.ts;
      if (rel < 0.005 && ageMs < FORCE_PUSH_MS) {
        head.ts = ts;
        writes[pid] = buf.slice(-MAX_SAMPLES);
        continue;
      }
    }
    buf.push({ ts, p: newPrice });
    writes[pid] = buf.slice(-MAX_SAMPLES);
    updated++;
  }

  if (Object.keys(writes).length === 0) {
    return { updated, players: pids.length };
  }
  await redis.hset(key(tournamentId, cutoff), writes);
  return { updated, players: pids.length };
}

export async function getDKTopBuffers(
  tournamentId: string,
  cutoff: TopCutoff,
): Promise<Record<string, DKOddsSample[] | null>> {
  const v = await redis.hgetall<Record<string, DKOddsSample[] | null>>(
    key(tournamentId, cutoff),
  );
  return v ?? {};
}
