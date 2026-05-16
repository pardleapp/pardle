/**
 * Rolling buffer of Betfair winner-market mid-prices per player. Used
 * to attach an "odds shifted" badge to feed events: we compare the
 * latest snapshot with one ~90 seconds before the event landed, and
 * if the move is big enough we display it.
 *
 * Storage model: one Redis hash per tournament,
 * `feed:odds:{tournamentId}` → { playerId → JSON snapshot list }.
 * Each snapshot is `{ ts: number, p: number }`. We trim each list to
 * the last 30 entries (≈ 30 minutes at 1/min) on write.
 */

import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const HASH_PREFIX = "feed:odds:";
// Each buffer keeps the last N samples per player. At ~1 sample/min
// during a live round, 720 covers ~12 hours — a full tournament day
// for round-score and outright bet history charts, including early
// tee times all the way through to last group's finish.
const MAX_SAMPLES = 720;

export interface OddsSample {
  /** epoch ms */
  ts: number;
  /** Decimal odds (e.g. 5.0 = 4/1). */
  p: number;
}

function key(t: string): string {
  return `${HASH_PREFIX}${t}`;
}

/**
 * Append the current price reading for each player. `latest` is keyed
 * by orchestrator playerId. Existing samples per player are kept
 * unless `force` is passed; identical readings (price within 0.5%) at
 * the head of the buffer are coalesced to keep the buffer signal-rich.
 */
export async function pushOddsSamples(
  tournamentId: string,
  latest: Record<string, number>,
  ts: number,
): Promise<{ updated: number; players: number }> {
  const pids = Object.keys(latest);
  if (pids.length === 0) return { updated: 0, players: 0 };

  // Fetch current buffers for the players we have new readings for.
  const existing = await redis.hmget<Record<string, OddsSample[]>>(
    key(tournamentId),
    ...pids,
  );
  const writes: Record<string, OddsSample[]> = {};
  let updated = 0;

  for (const pid of pids) {
    const buf: OddsSample[] = existing?.[pid] ?? [];
    const newPrice = latest[pid];
    if (!Number.isFinite(newPrice) || newPrice <= 1) continue;
    const head = buf[buf.length - 1];
    if (head) {
      const rel = Math.abs(newPrice - head.p) / head.p;
      // Skip writing a duplicate; refresh timestamp on the existing
      // head so the buffer's "last seen" is current.
      if (rel < 0.005) {
        head.ts = ts;
        writes[pid] = buf.slice(-MAX_SAMPLES);
        continue;
      }
    }
    buf.push({ ts, p: newPrice });
    writes[pid] = buf.slice(-MAX_SAMPLES);
    updated++;
  }

  if (Object.keys(writes).length === 0) return { updated, players: pids.length };
  await redis.hset(key(tournamentId), writes);
  return { updated, players: pids.length };
}

export async function getOddsBuffer(
  tournamentId: string,
  playerId: string,
): Promise<OddsSample[]> {
  const v = await redis.hget<OddsSample[]>(key(tournamentId), playerId);
  return v ?? [];
}

/**
 * Fetch buffers for a batch of players in one round-trip. Players not
 * yet in the hash come back with value `null` from Upstash's hmget,
 * so the return type reflects that — callers MUST guard before
 * reading from each entry.
 */
export async function getOddsBuffers(
  tournamentId: string,
  playerIds: string[],
): Promise<Record<string, OddsSample[] | null>> {
  if (playerIds.length === 0) return {};
  const v = await redis.hmget<Record<string, OddsSample[] | null>>(
    key(tournamentId),
    ...playerIds,
  );
  return v ?? {};
}

/**
 * Look up the snapshot price as close as possible to `targetTs` and
 * the most recent price after it. Returns nulls when the buffer is
 * too thin to find both sides.
 *
 * `windowBeforeMs` is how far back from `targetTs` we'll accept a
 * "before" sample (typically 90s — the orchestrator's typical
 * publish lag). `windowAfterMs` is how far forward we'll accept an
 * "after" sample (the next 1-2 poll cycles).
 */
export function findOddsShift(
  buf: OddsSample[],
  targetTs: number,
  windowBeforeMs = 120_000,
  windowAfterMs = 180_000,
): { before: number; after: number } | null {
  if (buf.length < 2) return null;
  const before = [...buf]
    .reverse()
    .find((s) => s.ts <= targetTs && targetTs - s.ts <= windowBeforeMs);
  const after = buf.find(
    (s) => s.ts >= targetTs && s.ts - targetTs <= windowAfterMs,
  );
  if (!before || !after) return null;
  if (before.ts === after.ts) return null;
  return { before: before.p, after: after.p };
}
