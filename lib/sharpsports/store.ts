/**
 * Redis-backed store for canonical Pardle bet slips synced from
 * SharpSports.
 *
 * Key layout — all under a single `sharpsports:` prefix so they're
 * easy to drop en-masse if we ever want to reset:
 *
 *   sharpsports:slip:{slipId}                → the PardleBetSlip JSON
 *   sharpsports:slips-by-account:{acctId}    → ZSET of slipId, score = placedAtMs
 *   sharpsports:slips-by-tournament:{pgaId}  → ZSET of slipId, score = placedAtMs
 *   sharpsports:slips-by-player:{dgId}       → ZSET of slipId, score = placedAtMs
 *
 * Every slip write also updates the three secondary indexes. The
 * indexes power the feed lookups ("show me every bet on Scheffler
 * this week" → range-query the by-player ZSET) without a full scan.
 *
 * ZSET scores are `placedAt` in milliseconds so newest-first paging
 * with `zrange rev limit` is one call.
 *
 * TTL: 180 days by default. Bets settle within a week or two; anything
 * older is likely dead history the user doesn't want cluttering their
 * feed. Long enough to survive a bet cashout months after placement
 * (majors futures placed a year out) with headroom.
 */

import { Redis } from "@upstash/redis";
import type { PardleBetLeg, PardleBetSlip } from "./types";

const redis = (() => {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
})();

const TTL_SECONDS = 180 * 24 * 60 * 60;

const KEY = {
  slip: (id: string) => `sharpsports:slip:${id}`,
  byAccount: (id: string) => `sharpsports:slips-by-account:${id}`,
  byTournament: (id: string) => `sharpsports:slips-by-tournament:${id}`,
  byPlayer: (dgId: number) => `sharpsports:slips-by-player:${dgId}`,
  lastRefresh: (accountId: string) =>
    `sharpsports:last-refresh:${accountId}`,
};

function placedAtMs(slip: PardleBetSlip): number {
  const t = Date.parse(slip.placedAt);
  return Number.isFinite(t) ? t : Date.now();
}

/** Collect every distinct tournament id + player dg_id referenced by
 *  a slip's golf legs. Used for secondary-index fan-out. */
function collectRefs(slip: PardleBetSlip): {
  tournamentIds: string[];
  playerDgIds: number[];
} {
  const tournamentIds = new Set<string>();
  const playerDgIds = new Set<number>();
  const collectLeg = (leg: PardleBetLeg) => {
    if (leg.tournament.pgaId) tournamentIds.add(leg.tournament.pgaId);
    if (leg.player?.dgId != null) playerDgIds.add(leg.player.dgId);
    // A matchup opponent also counts as a "player referenced" so a
    // Scheffler-vs-McIlroy bet shows on both feeds.
    if (leg.market.kind === "matchup" && leg.market.opponent?.dgId != null) {
      playerDgIds.add(leg.market.opponent.dgId);
    }
  };
  slip.golfLegs.forEach(collectLeg);
  return {
    tournamentIds: [...tournamentIds],
    playerDgIds: [...playerDgIds],
  };
}

/** Persist a slip + update all three secondary indexes. Idempotent —
 *  re-writing the same slipId overwrites (settled outcome, cash-out,
 *  odds change) which is the desired behaviour: SharpSports resends
 *  updated slips as their state changes. */
export async function saveSlip(slip: PardleBetSlip): Promise<void> {
  if (!redis) return;
  const score = placedAtMs(slip);
  const { tournamentIds, playerDgIds } = collectRefs(slip);

  const pipe = redis.multi();
  pipe.set(KEY.slip(slip.slipId), slip, { ex: TTL_SECONDS });
  pipe.zadd(KEY.byAccount(slip.bettorAccountId), {
    score,
    member: slip.slipId,
  });
  pipe.expire(KEY.byAccount(slip.bettorAccountId), TTL_SECONDS);
  for (const tid of tournamentIds) {
    pipe.zadd(KEY.byTournament(tid), { score, member: slip.slipId });
    pipe.expire(KEY.byTournament(tid), TTL_SECONDS);
  }
  for (const pid of playerDgIds) {
    pipe.zadd(KEY.byPlayer(pid), { score, member: slip.slipId });
    pipe.expire(KEY.byPlayer(pid), TTL_SECONDS);
  }
  await pipe.exec();
}

/** Persist many slips in one pass. Uses the pipelined saveSlip under
 *  the hood — Upstash caps a multi at ~50 commands, so we batch. */
export async function saveSlips(slips: PardleBetSlip[]): Promise<void> {
  const BATCH = 25;
  for (let i = 0; i < slips.length; i += BATCH) {
    await Promise.all(slips.slice(i, i + BATCH).map((s) => saveSlip(s)));
  }
}

export async function getSlip(slipId: string): Promise<PardleBetSlip | null> {
  if (!redis) return null;
  return redis.get<PardleBetSlip>(KEY.slip(slipId));
}

async function _rangeByIndex(
  key: string,
  { limit = 50, cursor }: { limit?: number; cursor?: number } = {},
): Promise<PardleBetSlip[]> {
  if (!redis) return [];
  // byScore range: newest-first pagination — start at cursor (exclusive
  // when supplied) down to -inf. Upstash's typed signature wants
  // `number | "+inf" | "-inf"` for the score bounds.
  const max: number | "+inf" = cursor ?? "+inf";
  const ids = (await redis.zrange<string[]>(key, max, "-inf", {
    byScore: true,
    rev: true,
    offset: 0,
    count: limit,
  })) as unknown as string[];
  if (!ids || ids.length === 0) return [];
  const slipKeys = ids.map((id) => KEY.slip(id));
  const raw = (await redis.mget<PardleBetSlip[]>(...slipKeys)) as (PardleBetSlip | null)[];
  return raw.filter((s): s is PardleBetSlip => s != null);
}

export async function getSlipsByAccount(
  bettorAccountId: string,
  opts?: { limit?: number; cursor?: number },
): Promise<PardleBetSlip[]> {
  return _rangeByIndex(KEY.byAccount(bettorAccountId), opts);
}

export async function getSlipsByTournament(
  pgaTournamentId: string,
  opts?: { limit?: number; cursor?: number },
): Promise<PardleBetSlip[]> {
  return _rangeByIndex(KEY.byTournament(pgaTournamentId), opts);
}

export async function getSlipsByPlayer(
  dgId: number,
  opts?: { limit?: number; cursor?: number },
): Promise<PardleBetSlip[]> {
  return _rangeByIndex(KEY.byPlayer(dgId), opts);
}

/** Record the last time we received a refresh for this bettor account.
 *  Used by the reconciliation cron to check for accounts that have
 *  gone silent (webhook chain broken, needs re-auth). */
export async function markAccountRefreshed(
  bettorAccountId: string,
): Promise<void> {
  if (!redis) return;
  await redis.set(KEY.lastRefresh(bettorAccountId), Date.now(), {
    ex: TTL_SECONDS,
  });
}

export async function getAccountLastRefreshedAt(
  bettorAccountId: string,
): Promise<number | null> {
  if (!redis) return null;
  return await redis.get<number>(KEY.lastRefresh(bettorAccountId));
}
