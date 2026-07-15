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

// TTL tightened from 60s → 15s so a shot on a top-N contender lands
// in the client's top-finish figures within ~15s instead of ~60s.
// The MC recompute costs ~5000 sims per player; at 15s cadence that's
// ~4x/min max regardless of how many clients are connected (cache is
// shared). We could push this lower still but 15s is well within the
// window a user would notice between "player made eagle" landing on
// the feed and the top-10 chip catching up.
const HOT_TTL_S = 15;
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

// ──────────────────────────────────────────────────────────────────
// DataGolf in-play top-finish cache — used as a calibration anchor
// that the feed route blends our MC output toward. DG publishes
// top-5 / top-10 only; top-20 stays on our model.
// ──────────────────────────────────────────────────────────────────

const DG_HOT_TTL_S = 300; // DG refreshes their /preds/in-play roughly every few minutes

export interface DgTopFinishMap {
  ts: number;
  /** Keyed by PGA Tour playerId (NOT DG dg_id). */
  byPlayer: Record<string, { top5: number; top10: number }>;
}

function dgTopKey(t: string): string {
  return `feed:topfin:dg:${t}`;
}

export async function getCachedDgTopFinish(
  tournamentId: string,
): Promise<DgTopFinishMap | null> {
  return (
    (await redis.get<DgTopFinishMap>(dgTopKey(tournamentId))) ?? null
  );
}

export async function setCachedDgTopFinish(
  tournamentId: string,
  map: DgTopFinishMap,
): Promise<void> {
  await redis.set(dgTopKey(tournamentId), map, { ex: DG_HOT_TTL_S });
}
