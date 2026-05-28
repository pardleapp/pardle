/**
 * Prediction polls — slower-resolving siblings of the live putt
 * polls. Where a putt poll resolves in 30-90 seconds, prediction
 * polls span hours: head-to-heads (which of two top players shoots
 * lower today?) resolve at round-end; hold-the-lead polls resolve
 * at tournament-end.
 *
 * Engine pieces:
 *   - openPredictionPoll() — called by pollAndDiff once the
 *     trigger conditions are met. Stamps a poll into Redis and
 *     adds its id to the open-set for the tournament.
 *   - getOpenPredictionPolls() — read every active poll for a
 *     tournament, used by /api/feed to inject them into the
 *     response.
 *   - settlePredictionPoll() — resolves outcome + flushes votes
 *     into Sharp Score, idempotent via a flag key.
 *
 * Storage:
 *   pred:poll:{pollId}                     hash<json>
 *   pred:counts:{pollId}                   hash<optionKey, count>
 *   pred:voted:{pollId}:{authorKey}        optionKey (24h TTL)
 *   pred:open:{tournamentId}               set<pollId> of polls
 *                                          currently visible
 *   pred:opened-flag:{tournamentId}:{key}  "1" — dedupe so the
 *                                          same trigger doesn't
 *                                          fire twice per round
 *   pred:settled-flag:{pollId}             "1" — settle once only
 *
 * Server-only.
 */
import "server-only";
import { Redis } from "@upstash/redis";
import { recordCall, type SharpCategory } from "./sharp-score";

const redis = Redis.fromEnv();

const VOTED_TTL = 7 * 24 * 60 * 60;
const POLL_TTL = 14 * 24 * 60 * 60;

export type PredictionPollType = "head-to-head" | "hold-the-lead";

/** Per-type Sharp Score category. Each prediction poll credits a
 *  distinct slice of the user's record so we can later display
 *  "your accuracy on head-to-heads" / "your accuracy on lead
 *  calls" if useful. For now we collapse them into putt-poll for
 *  the chip — these are predictions just like putts, only slower. */
const SHARP_CATEGORY_FOR_TYPE: Record<PredictionPollType, SharpCategory> = {
  "head-to-head": "putt-poll",
  "hold-the-lead": "putt-poll",
};

export interface PredictionPollOption {
  key: string;
  label: string;
  /** Optional playerId for option — head-to-head options reference
   *  the two competing players; hold-the-lead has yes/no with no
   *  player id. */
  playerId?: string;
}

export interface PredictionPoll {
  id: string;
  type: PredictionPollType;
  tournamentId: string;
  /** Plain-language question rendered on the card. */
  question: string;
  options: PredictionPollOption[];
  openedAt: number;
  /** When the poll closes for voting. Resolution may follow later
   *  (closesAt = round-end; settle happens when settle conditions
   *  are met by the cron). */
  closesAt: number;
  /** Set at settle time. */
  outcome?: string | null;
  settledAt?: number | null;
  /** Type-specific resolution metadata read by the settler. */
  settle: {
    /** Round the poll resolves at the end of — used by head-to-head. */
    round?: number;
    /** Two competing players for head-to-head. */
    playerA?: { id: string; name: string };
    playerB?: { id: string; name: string };
    /** Subject player for hold-the-lead. */
    leader?: { id: string; name: string };
  };
}

export interface PredictionPollCounts {
  [optionKey: string]: number;
}

function pollKey(id: string) {
  return `pred:poll:${id}`;
}
function countsKey(id: string) {
  return `pred:counts:${id}`;
}
function votedKey(id: string, who: string) {
  return `pred:voted:${id}:${who}`;
}
function openSetKey(tournamentId: string) {
  return `pred:open:${tournamentId}`;
}
function openedFlagKey(tournamentId: string, dedupKey: string) {
  return `pred:opened-flag:${tournamentId}:${dedupKey}`;
}
function settledFlagKey(id: string) {
  return `pred:settled-flag:${id}`;
}

function newPollId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pred_${ts}_${rand}`;
}

/**
 * Open a prediction poll. `dedupKey` is the trigger fingerprint
 * (e.g. "h2h:r3" or "hold-the-lead") — if a poll with this key
 * already opened for this tournament, this call is a no-op. That
 * way pollAndDiff can call openPredictionPoll on every tick
 * without worrying about duplicates.
 */
export async function openPredictionPoll(
  args: {
    type: PredictionPollType;
    tournamentId: string;
    dedupKey: string;
    question: string;
    options: PredictionPollOption[];
    closesAt: number;
    settle: PredictionPoll["settle"];
  },
): Promise<PredictionPoll | null> {
  const flag = openedFlagKey(args.tournamentId, args.dedupKey);
  const claimed = await redis.set(flag, "1", { nx: true, ex: POLL_TTL });
  if (claimed !== "OK") return null;

  const id = newPollId();
  const poll: PredictionPoll = {
    id,
    type: args.type,
    tournamentId: args.tournamentId,
    question: args.question,
    options: args.options,
    openedAt: Date.now(),
    closesAt: args.closesAt,
    settle: args.settle,
  };
  await redis.set(pollKey(id), JSON.stringify(poll), { ex: POLL_TTL });
  // Seed every option's count at zero so the UI can render a clean
  // 0/0/0 row from the first read instead of partial keys.
  const seed: Record<string, string> = {};
  for (const o of args.options) seed[o.key] = "0";
  await redis.hset(countsKey(id), seed);
  await redis.sadd(openSetKey(args.tournamentId), id);
  await redis.expire(openSetKey(args.tournamentId), POLL_TTL);
  return poll;
}

/** Read a single poll by id. */
export async function getPredictionPoll(
  id: string,
): Promise<PredictionPoll | null> {
  const raw = await redis.get(pollKey(id));
  if (!raw) return null;
  try {
    return typeof raw === "string"
      ? (JSON.parse(raw) as PredictionPoll)
      : (raw as PredictionPoll);
  } catch {
    return null;
  }
}

/** Open polls + their current vote counts for a tournament. Used
 *  by /api/feed to inject these into the response. */
export async function getOpenPredictionPolls(
  tournamentId: string,
): Promise<
  Array<{
    poll: PredictionPoll;
    counts: PredictionPollCounts;
  }>
> {
  const ids = (await redis.smembers(openSetKey(tournamentId))) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.get(pollKey(id));
    pipe.hgetall(countsKey(id));
  }
  const results = (await pipe.exec()) as unknown[];
  const out: Array<{ poll: PredictionPoll; counts: PredictionPollCounts }> = [];
  for (let i = 0; i < ids.length; i++) {
    const rawPoll = results[i * 2];
    const rawCounts = results[i * 2 + 1] as Record<string, string> | null;
    if (!rawPoll) continue;
    let poll: PredictionPoll;
    try {
      poll =
        typeof rawPoll === "string"
          ? (JSON.parse(rawPoll) as PredictionPoll)
          : (rawPoll as PredictionPoll);
    } catch {
      continue;
    }
    const counts: PredictionPollCounts = {};
    if (rawCounts) {
      for (const [k, v] of Object.entries(rawCounts)) {
        counts[k] = Number(v) || 0;
      }
    }
    out.push({ poll, counts });
  }
  return out;
}

/** Cast or change a vote. Atomic via SET ... GET so concurrent
 *  taps from the same author can't both pass the prev-check and
 *  double-increment a counter. Returns the fresh counts. */
export async function voteOnPredictionPoll(
  pollId: string,
  authorKey: string,
  optionKey: string,
): Promise<PredictionPollCounts | null> {
  const poll = await getPredictionPoll(pollId);
  if (!poll) return null;
  if (poll.settledAt) return null;
  if (!poll.options.some((o) => o.key === optionKey)) return null;
  if (Date.now() > poll.closesAt) return null;

  const marker = votedKey(pollId, authorKey);
  const prev = (await redis.set(marker, optionKey, {
    ex: VOTED_TTL,
    get: true,
  })) as string | null;
  if (prev === optionKey) {
    // No-op; just return current counts.
    return getPredictionPollCounts(pollId);
  }

  const counts = countsKey(pollId);
  if (prev) {
    await redis.hincrby(counts, prev, -1);
  }
  await redis.hincrby(counts, optionKey, 1);
  return getPredictionPollCounts(pollId);
}

/** Read just the counts for a single poll. */
export async function getPredictionPollCounts(
  pollId: string,
): Promise<PredictionPollCounts> {
  const raw = (await redis.hgetall<Record<string, string>>(
    countsKey(pollId),
  )) ?? {};
  const out: PredictionPollCounts = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = Number(v) || 0;
  }
  return out;
}

/** Read a caller's own pick across many polls in one round-trip. */
export async function getMyPredictionVotes(
  pollIds: string[],
  authorKey: string,
): Promise<Record<string, string | null>> {
  if (pollIds.length === 0 || !authorKey) return {};
  const pipe = redis.pipeline();
  for (const id of pollIds) {
    pipe.get(votedKey(id, authorKey));
  }
  const results = (await pipe.exec()) as (string | null)[];
  const out: Record<string, string | null> = {};
  pollIds.forEach((id, i) => {
    out[id] = (results[i] ?? null) as string | null;
  });
  return out;
}

/**
 * Settle a poll with a winning option key. Iterates every voter
 * (via the marker keys — Upstash supports scan) and credits Sharp
 * Score per voter. Idempotent via a SET NX flag so multiple cron
 * ticks can't double-credit.
 */
export async function settlePredictionPoll(
  pollId: string,
  winningOptionKey: string | null,
): Promise<{ settled: boolean; voterCount: number }> {
  const flag = settledFlagKey(pollId);
  const claim = await redis.set(flag, "1", {
    nx: true,
    ex: 60 * 60 * 24 * 30,
  });
  if (claim !== "OK") return { settled: false, voterCount: 0 };

  const poll = await getPredictionPoll(pollId);
  if (!poll) return { settled: false, voterCount: 0 };

  const updated: PredictionPoll = {
    ...poll,
    outcome: winningOptionKey ?? null,
    settledAt: Date.now(),
  };
  await redis.set(pollKey(pollId), JSON.stringify(updated), { ex: POLL_TTL });
  await redis.srem(openSetKey(poll.tournamentId), pollId);

  if (!winningOptionKey) return { settled: true, voterCount: 0 };

  // Sweep every voter via SCAN. The voted key pattern is
  // pred:voted:{pollId}:{authorKey}, so we filter by prefix.
  const prefix = `pred:voted:${pollId}:`;
  let cursor: string | number = 0;
  let voterCount = 0;
  const category = SHARP_CATEGORY_FOR_TYPE[poll.type];
  do {
    const [next, keys] = (await redis.scan(cursor, {
      match: `${prefix}*`,
      count: 200,
    })) as [string | number, string[]];
    cursor = next;
    if (!keys || keys.length === 0) continue;
    const vals = (await redis.mget<string[]>(...keys)) ?? [];
    for (let i = 0; i < keys.length; i++) {
      const authorKey = keys[i].slice(prefix.length);
      const chosen = vals[i];
      if (!authorKey || !chosen) continue;
      const correct = chosen === winningOptionKey;
      await recordCall({
        authorKey,
        category,
        correct,
      }).catch((err) => {
        console.error("[prediction-polls] recordCall failed", err);
      });
      voterCount++;
    }
  } while (cursor && cursor !== "0" && cursor !== 0);

  return { settled: true, voterCount };
}
