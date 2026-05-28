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

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Polling logic shared between the cron route (`/api/feed/datagolf-poll`)
 * and the inline poller in `/api/feed`. Fetches DataGolf in-play win
 * probs, matches them by display name to the cached leaderboard, and
 * appends to the per-player Redis buffer.
 *
 * Returns a small status object so callers can log; never throws —
 * DataGolf flakes are common and the outright chart degrades gracefully
 * to Polymarket alone (or vice versa).
 */
export async function pollDataGolfInPlay(tournamentId: string): Promise<{
  ok: boolean;
  matched: number;
  reason?: string;
}> {
  const { getInPlayWinProbs } = await import("@/lib/golf-api/datagolf");
  const { getCachedLeaderboard } = await import("./store");

  const leaderboard = await getCachedLeaderboard(tournamentId);
  if (leaderboard.length === 0) {
    return { ok: false, matched: 0, reason: "no-leaderboard" };
  }
  let probs;
  try {
    probs = await getInPlayWinProbs();
  } catch (err) {
    console.error("[dg-poll-inline] fetch failed", err);
    return { ok: false, matched: 0, reason: "fetch-failed" };
  }
  const lbByName = new Map<string, string>();
  for (const r of leaderboard) lbByName.set(normalizeName(r.displayName), r.playerId);
  const latest: Record<string, number> = {};
  for (const p of probs) {
    const pid = lbByName.get(normalizeName(p.name));
    if (!pid) continue;
    latest[pid] = p.winProb;
  }
  const result = await pushDgProbSamples(tournamentId, latest, Date.now());
  return { ok: true, matched: result.updated };
}
