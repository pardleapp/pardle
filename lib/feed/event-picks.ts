/**
 * Pre-event "pick the winner" predictions. Sharp Score's
 * off-week / pre-tournament engagement loop: users predict the
 * outright winner before the event tees off, the pick locks at
 * tee-off time, and the result feeds the user's Sharp Score under
 * a dedicated `event-winner-pick` category.
 *
 * Differs from bet-tracking in that no real money is involved —
 * pure credibility signal. Settles when the tournament finishes
 * via the notify-poll cron's existing settlement detection.
 *
 * Redis schema:
 *   picks:event:{tournamentId}                 hash authorKey → JSON
 *     value: { playerId, playerName, ts, displayName?, settledAt?,
 *              won? }
 *   picks:event:settled:{tournamentId}         "1" once settlement
 *     has run, so notify-poll skips re-settling on every tick.
 *
 * Server-only.
 */
import "server-only";
import { Redis } from "@upstash/redis";
import { recordCall } from "./sharp-score";

const redis = Redis.fromEnv();

export interface EventPick {
  playerId: string;
  playerName: string;
  ts: number;
  displayName?: string;
  settledAt?: number;
  won?: boolean;
}

function picksKey(tournamentId: string): string {
  return `picks:event:${tournamentId}`;
}

function settledFlagKey(tournamentId: string): string {
  return `picks:event:settled:${tournamentId}`;
}

/** Read a single visitor's pick for an event. Null when no pick
 *  exists. */
export async function getEventPick(
  tournamentId: string,
  authorKey: string,
): Promise<EventPick | null> {
  if (!authorKey) return null;
  const raw = await redis.hget(picksKey(tournamentId), authorKey);
  if (!raw) return null;
  try {
    return typeof raw === "string"
      ? (JSON.parse(raw) as EventPick)
      : (raw as EventPick);
  } catch {
    return null;
  }
}

/** Save / overwrite a pick. Returns the persisted record. Locking
 *  (e.g. once tee-off has happened) is the caller's responsibility
 *  — the API route checks tournament startDate vs now before
 *  calling this. */
export async function setEventPick(
  tournamentId: string,
  authorKey: string,
  pick: {
    playerId: string;
    playerName: string;
    displayName?: string;
  },
): Promise<EventPick> {
  const record: EventPick = {
    playerId: pick.playerId,
    playerName: pick.playerName,
    displayName: pick.displayName,
    ts: Date.now(),
  };
  await redis.hset(picksKey(tournamentId), {
    [authorKey]: JSON.stringify(record),
  });
  return record;
}

/** Total picks placed for an event. Powers the "47 bettors have
 *  picked this week" social-proof chip on the pick page. */
export async function getEventPickCount(
  tournamentId: string,
): Promise<number> {
  try {
    const n = await redis.hlen(picksKey(tournamentId));
    return typeof n === "number" ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Settle every pick for a finished tournament. Caller passes the
 * actual winner's playerId(s) — for a tie, every co-winner counts.
 * Credits Sharp Score per pick (recordCall in the
 * 'event-winner-pick' category). Idempotent via a settledFlagKey
 * guard so notify-poll can call this on every tick without
 * re-crediting.
 */
export async function settleEventPicks(
  tournamentId: string,
  winningPlayerIds: string[],
): Promise<{ settled: number }> {
  if (winningPlayerIds.length === 0) return { settled: 0 };
  const flagKey = settledFlagKey(tournamentId);
  // SET NX so concurrent crons don't double-settle.
  const claim = await redis.set(flagKey, "1", { nx: true, ex: 60 * 60 * 24 * 30 });
  if (claim !== "OK") return { settled: 0 };

  const winners = new Set(winningPlayerIds);
  const all = await redis.hgetall<Record<string, string>>(picksKey(tournamentId));
  if (!all) return { settled: 0 };

  const entries = Object.entries(all);
  let settled = 0;
  for (const [authorKey, rawValue] of entries) {
    let pick: EventPick;
    try {
      pick =
        typeof rawValue === "string"
          ? (JSON.parse(rawValue) as EventPick)
          : (rawValue as EventPick);
    } catch {
      continue;
    }
    if (pick.settledAt) continue; // already credited

    const won = winners.has(pick.playerId);
    const updated: EventPick = {
      ...pick,
      settledAt: Date.now(),
      won,
    };
    await redis.hset(picksKey(tournamentId), {
      [authorKey]: JSON.stringify(updated),
    });
    await recordCall({
      authorKey,
      displayName: pick.displayName ?? null,
      category: "event-winner-pick",
      correct: won,
    }).catch((err) => {
      console.error("[event-picks] recordCall failed", err);
    });
    settled++;
  }
  return { settled };
}
