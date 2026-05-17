/**
 * Server-side cache for the Monte Carlo top-finish model output.
 *
 *   - Hot cache: latest computed top-X probs per player, TTL 60s.
 *     /api/feed reads this first; on miss we run the MC inline.
 *   - History buffer: snapshots of the per-player top-X probs over
 *     time, used to draw the bet detail chart's trajectory. Newest
 *     first, capped at 720 entries (~12h at 1/min cadence).
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import type { TopFinishProbs } from "./top-finish-model";

const redis = Redis.fromEnv();

const HOT_TTL_S = 60;
const HISTORY_MAX = 720;
const HISTORY_MIN_GAP_MS = 55_000;

export interface TopFinishSnapshot {
  ts: number;
  byPlayer: Record<string, TopFinishProbs>;
}

function hotKey(t: string): string {
  return `feed:topfin:hot:${t}`;
}
function histKey(t: string): string {
  return `feed:topfin:hist:${t}`;
}

export async function getHotTopFinish(
  tournamentId: string,
): Promise<TopFinishSnapshot | null> {
  return (
    (await redis.get<TopFinishSnapshot>(hotKey(tournamentId))) ?? null
  );
}

export async function setHotTopFinish(
  tournamentId: string,
  snapshot: TopFinishSnapshot,
): Promise<void> {
  await redis.set(hotKey(tournamentId), snapshot, { ex: HOT_TTL_S });
}

export async function pushTopFinishSnapshot(
  tournamentId: string,
  snapshot: TopFinishSnapshot,
): Promise<void> {
  await redis.lpush(histKey(tournamentId), JSON.stringify(snapshot));
  await redis.ltrim(histKey(tournamentId), 0, HISTORY_MAX - 1);
}

export async function getTopFinishHistory(
  tournamentId: string,
): Promise<TopFinishSnapshot[]> {
  const raw = await redis.lrange<unknown>(
    histKey(tournamentId),
    0,
    HISTORY_MAX - 1,
  );
  const out: TopFinishSnapshot[] = [];
  for (const r of raw) {
    try {
      const parsed =
        typeof r === "string"
          ? (JSON.parse(r) as TopFinishSnapshot)
          : (r as TopFinishSnapshot);
      if (
        parsed &&
        typeof parsed.ts === "number" &&
        parsed.byPlayer &&
        typeof parsed.byPlayer === "object"
      ) {
        out.push(parsed);
      }
    } catch {}
  }
  return out;
}

export { HISTORY_MIN_GAP_MS };
