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

  // Force a fresh sample at least every 5 minutes even when the
  // price hasn't moved meaningfully, so a market drifting slowly
  // all afternoon still produces chart-friendly density instead of
  // being collapsed to a single dot.
  const FORCE_PUSH_MS = 5 * 60 * 1000;
  for (const pid of pids) {
    const buf: OddsSample[] = existing?.[pid] ?? [];
    const newPrice = latest[pid];
    if (!Number.isFinite(newPrice) || newPrice <= 1) continue;
    const head = buf[buf.length - 1];
    if (head) {
      const rel = Math.abs(newPrice - head.p) / head.p;
      const ageMs = ts - head.ts;
      // Tight dedup only when the price truly hasn't moved AND
      // we already have a recent enough sample. Past the 5-min
      // floor, push a new entry regardless to keep the chart line
      // honest about how long the level has held.
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
 * Look up the win-market price on either side of an event so we can
 * render an odds-moved badge.
 *
 * Tricky bit: `targetTs` is when our poller *detected* the event, not
 * when the shot actually landed on course. The orchestrator typically
 * publishes 60-90s after the real moment, and Betfair often reacts
 * within ~30s of the on-course event. That means by the time
 * `targetTs` arrives, Betfair has already moved — so the "before"
 * price we want is from BEFORE the orchestrator's detection lag, not
 * from just before `targetTs`.
 *
 * Mitigation:
 * - Anchor the "before" cutoff at `targetTs - DETECTION_LAG_MS` and
 *   look further back from there.
 * - Keep the "after" window generous so we still find a settled
 *   post-move sample at our typical 1/min sampling cadence.
 */
const DETECTION_LAG_MS = 60_000;

export function findOddsShift(
  buf: OddsSample[],
  targetTs: number,
  /** How far back from the (lag-adjusted) cutoff to accept a "before". */
  windowBeforeMs = 180_000,
  /** How far forward from targetTs to accept an "after". */
  windowAfterMs = 180_000,
): { before: number; after: number } | null {
  if (buf.length < 2) return null;
  const beforeCutoff = targetTs - DETECTION_LAG_MS;
  const before = [...buf]
    .reverse()
    .find(
      (s) => s.ts <= beforeCutoff && beforeCutoff - s.ts <= windowBeforeMs,
    );
  const after = buf.find(
    (s) => s.ts >= targetTs && s.ts - targetTs <= windowAfterMs,
  );
  if (!before || !after) return null;
  if (before.ts === after.ts) return null;
  return { before: before.p, after: after.p };
}
