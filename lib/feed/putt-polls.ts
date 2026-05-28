/**
 * Putt prediction polls — the interactive social layer on the live feed.
 *
 * When a player's approach lands on the green at a "guessable" distance
 * (10–40 ft), the engine opens a poll: "Will [Player] make this putt?"
 * Bettors get ~30–60s to vote before the putt is struck. When the hole
 * completes we settle the poll by comparing final strokes to the count
 * when the poll opened — if they finished in N+1 strokes, the putt
 * dropped.
 *
 * Storage is Redis (no auth, anonymous voting via cookie authorKey),
 * matching the same pattern as reactions:
 *
 *   feed:puttpoll:{pollId}                         → hash (poll metadata)
 *   feed:puttpoll:counts:{pollId}                  → hash { yes, no }
 *   feed:puttpoll:voted:{pollId}:{authorKey}       → "y"|"n" marker (24h TTL)
 *   feed:puttpoll:lookup:{t}:{pid}:{round}:{hole}  → pollId, for fast
 *                                                    "find the open poll
 *                                                    for this hole" on
 *                                                    settlement.
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import { recordVoter, settlePollStats } from "./putt-iq";

const redis = Redis.fromEnv();

const VOTED_TTL = 24 * 60 * 60;
const POLL_TTL = 48 * 60 * 60;

/** The lower bound that keeps polls meaningful. Putts inside this are
 *  near-automatic on tour (>85% make rate) — no signal. */
export const MIN_PUTT_FT = 10;
/** The upper bound where putts become close to coin-flips on tour
 *  randomness — beyond this the "make/miss" question has no edge. */
export const MAX_PUTT_FT = 40;

function pollKey(id: string) {
  return `feed:puttpoll:${id}`;
}
function countsKey(id: string) {
  return `feed:puttpoll:counts:${id}`;
}
function votedKey(id: string, who: string) {
  return `feed:puttpoll:voted:${id}:${who}`;
}
function lookupKey(t: string, pid: string, round: number, hole: number) {
  return `feed:puttpoll:lookup:${t}:${pid}:${round}:${hole}`;
}

export interface PuttPoll {
  id: string;
  tournamentId: string;
  playerId: string;
  playerName: string;
  round: number;
  hole: number;
  /** Distance to the cup when the poll opened, in feet. */
  distanceFt: number;
  /** Stroke count the player was on when the approach landed — used to
   *  decide settlement: if final strokes === polledAtStroke + 1 the
   *  putt was holed. */
  polledAtStroke: number;
  /** Par of the hole — lets us label "for birdie / par / eagle" on the
   *  open poll. */
  holePar: number | null;
  openedAt: number;
  closedAt?: number | null;
  /** Settlement: true = made, false = missed, undefined = still open. */
  made?: boolean | null;
}

export interface PuttPollCounts {
  yes: number;
  no: number;
}

/** Stable random poll id; same suffix shape as feed events. */
function newPollId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pp_${ts}_${rand}`;
}

export async function openPuttPoll(args: {
  tournamentId: string;
  playerId: string;
  playerName: string;
  round: number;
  hole: number;
  distanceFt: number;
  polledAtStroke: number;
  holePar: number | null;
}): Promise<string | null> {
  // Don't open a duplicate poll for the same (player, round, hole) — if
  // we already have one (eg. orchestrator briefly re-emitted the same
  // playByPlay), bail.
  const lookup = lookupKey(
    args.tournamentId,
    args.playerId,
    args.round,
    args.hole,
  );
  const existing = await redis.get<string>(lookup);
  if (existing) return null;

  const id = newPollId();
  const poll: PuttPoll = {
    id,
    tournamentId: args.tournamentId,
    playerId: args.playerId,
    playerName: args.playerName,
    round: args.round,
    hole: args.hole,
    distanceFt: args.distanceFt,
    polledAtStroke: args.polledAtStroke,
    holePar: args.holePar,
    openedAt: Date.now(),
    closedAt: null,
    made: null,
  };
  const pipe = redis.pipeline();
  pipe.set(pollKey(id), JSON.stringify(poll), { ex: POLL_TTL });
  pipe.hset(countsKey(id), { yes: 0, no: 0 });
  pipe.expire(countsKey(id), POLL_TTL);
  pipe.set(lookup, id, { ex: POLL_TTL });
  await pipe.exec();
  return id;
}

export async function getPuttPoll(id: string): Promise<PuttPoll | null> {
  const raw = await redis.get<PuttPoll | string>(pollKey(id));
  if (!raw) return null;
  // Upstash sometimes returns parsed JSON, sometimes a string.
  return typeof raw === "string" ? (JSON.parse(raw) as PuttPoll) : raw;
}

export async function getPuttPollCounts(id: string): Promise<PuttPollCounts> {
  const h = await redis.hgetall<Record<string, string>>(countsKey(id));
  return { yes: Number(h?.yes ?? 0), no: Number(h?.no ?? 0) };
}

/** Bulk poll + counts fetch for rendering a page of events. */
export async function getPuttPollBulk(
  ids: string[],
): Promise<Record<string, { poll: PuttPoll; counts: PuttPollCounts }>> {
  if (ids.length === 0) return {};
  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.get(pollKey(id));
    pipe.hgetall(countsKey(id));
  }
  const results = (await pipe.exec()) as (string | Record<string, string> | null)[];
  const out: Record<string, { poll: PuttPoll; counts: PuttPollCounts }> = {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const rawPoll = results[i * 2];
    const rawCounts = results[i * 2 + 1] as Record<string, string> | null;
    if (!rawPoll) continue;
    const poll =
      typeof rawPoll === "string"
        ? (JSON.parse(rawPoll) as PuttPoll)
        : (rawPoll as unknown as PuttPoll);
    out[id] = {
      poll,
      counts: {
        yes: Number(rawCounts?.yes ?? 0),
        no: Number(rawCounts?.no ?? 0),
      },
    };
  }
  return out;
}

/**
 * Cast a vote. Anonymous via `authorKey` (hashed cookie id). One vote
 * per author per poll; flipping yes↔no adjusts both counters. Returns
 * the new counts, or null if the poll is already closed or the vote
 * was a no-op.
 */
export async function votePuttPoll(
  pollId: string,
  authorKey: string,
  vote: "yes" | "no",
): Promise<PuttPollCounts | null> {
  const poll = await getPuttPoll(pollId);
  if (!poll) return null;
  if (poll.closedAt != null) return null;

  const marker = votedKey(pollId, authorKey);
  const want = vote === "yes" ? "y" : "n";
  // Atomic SET+GET so two concurrent taps from the same author
  // can't both pass the prev==want check independently and
  // double-increment the counter. Previously prev/set were two
  // separate round-trips with a race window between them.
  const prev = (await redis.set(marker, want, {
    ex: VOTED_TTL,
    get: true,
  })) as string | null;
  if (prev === want) return null;

  const key = countsKey(pollId);
  if (prev === "y" && vote === "no") {
    await redis.hincrby(key, "yes", -1);
    await redis.hincrby(key, "no", 1);
  } else if (prev === "n" && vote === "yes") {
    await redis.hincrby(key, "no", -1);
    await redis.hincrby(key, "yes", 1);
  } else {
    await redis.hincrby(key, vote, 1);
  }
  // Track the voter explicitly so settlement can sweep all voters and
  // update their personal accuracy stats. Stored separately from the
  // dedup marker so a single Redis lookup at settle-time enumerates
  // everyone who voted (rather than scanning per-author keys).
  await recordVoter(pollId, authorKey, vote);
  return getPuttPollCounts(pollId);
}

/** Read the caller's existing vote (or null). */
export async function getMyVote(
  pollId: string,
  authorKey: string,
): Promise<"yes" | "no" | null> {
  const v = await redis.get<string>(votedKey(pollId, authorKey));
  if (v === "y") return "yes";
  if (v === "n") return "no";
  return null;
}

/** Bulk lookup of "my votes" for a list of poll IDs. */
export async function getMyVotesBulk(
  ids: string[],
  authorKey: string,
): Promise<Record<string, "yes" | "no" | null>> {
  if (ids.length === 0) return {};
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(votedKey(id, authorKey));
  const results = (await pipe.exec()) as (string | null)[];
  const out: Record<string, "yes" | "no" | null> = {};
  ids.forEach((id, i) => {
    const v = results[i];
    out[id] = v === "y" ? "yes" : v === "n" ? "no" : null;
  });
  return out;
}

/**
 * Look up the open poll for a (player, round, hole) — called by the
 * engine when a score event lands so it can settle the matching poll.
 */
export async function findOpenPollForHole(
  tournamentId: string,
  playerId: string,
  round: number,
  hole: number,
): Promise<string | null> {
  return await redis.get<string>(
    lookupKey(tournamentId, playerId, round, hole),
  );
}

/**
 * Close a poll and record the outcome. `finalStrokes` is the hole's
 * final score; `made` is true when `finalStrokes === poll.polledAtStroke + 1`.
 *
 * Idempotent: a second call is a no-op if the poll is already closed.
 */
export async function settlePuttPoll(
  pollId: string,
  finalStrokes: number,
): Promise<PuttPoll | null> {
  const poll = await getPuttPoll(pollId);
  if (!poll) return null;
  if (poll.closedAt != null) return poll;
  const made = finalStrokes === poll.polledAtStroke + 1;
  const updated: PuttPoll = {
    ...poll,
    closedAt: Date.now(),
    made,
  };
  await redis.set(pollKey(pollId), JSON.stringify(updated), { ex: POLL_TTL });
  // Lookup key cleared so the next approach to the same hole later in
  // the tournament can open a fresh poll.
  await redis.del(
    lookupKey(poll.tournamentId, poll.playerId, poll.round, poll.hole),
  );
  // Sweep voters → personal stats + tournament leaderboard. Best-effort:
  // a settlement-stats failure must not block the poll close itself
  // (the poll is already marked closed in Redis).
  try {
    await settlePollStats({
      pollId,
      tournamentId: poll.tournamentId,
      made,
    });
  } catch (err) {
    console.error("[feed] settlePollStats failed", err);
  }
  return updated;
}
