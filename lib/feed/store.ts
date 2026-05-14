/**
 * Live feed — Upstash Redis storage.
 *
 * Keys:
 *   feed:events:{tournamentId}         → list of FeedEvent JSON (LPUSH newest first, LTRIM cap)
 *   feed:snapshot:{tournamentId}       → JSON: per-player poll snapshot for diffing
 *   feed:reactions:{eventId}           → hash { up, down }
 *   feed:reacted:{eventId}:{authorKey} → "u"|"d" marker, prevents double-react (24h TTL)
 *   feed:comments:{eventId}            → list of FeedComment JSON
 *   feed:meta:{tournamentId}           → JSON: { lastPolledAt, lastEventId } for SSE cursors
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import {
  COMMENTS_PER_EVENT_CAP,
  FEED_MAX_EVENTS,
  type FeedComment,
  type FeedEvent,
  type ReactionCounts,
} from "./types";
import type { ShotTraceSegment } from "./shot-trace";

const redis = Redis.fromEnv();

const REACTED_TTL = 24 * 60 * 60;
// Coalesce window for viewer-triggered polls. Short enough that the
// feed feels live, long enough that 100 concurrent viewers still only
// trigger one real PGA Tour fetch per window.
const POLL_LOCK_SECONDS = 25;

function eventsKey(t: string) {
  return `feed:events:${t}`;
}
function snapshotKey(t: string) {
  return `feed:snapshot:${t}`;
}
function reactionsKey(e: string) {
  return `feed:reactions:${e}`;
}
function reactedKey(e: string, who: string) {
  return `feed:reacted:${e}:${who}`;
}
function commentsKey(e: string) {
  return `feed:comments:${e}`;
}

// ──────────────────────────────────────────────────────────────────
// Poll snapshot (for the diff engine)
// ──────────────────────────────────────────────────────────────────

/**
 * Snapshot shape: per player, the last-seen hole-score map plus the
 * leaderboard position. The diff engine compares the fresh poll to
 * this to emit only NEW events.
 */
export interface PollSnapshot {
  /** playerId → { round → { hole → score string } } */
  holes: Record<string, Record<number, Record<number, string>>>;
  /** playerId → last-seen position string */
  positions: Record<string, string>;
  /**
   * Keys `${playerId}:${round}:${hole}` for which we've already emitted
   * a stuffed-approach "shot" event — stops the same shot re-firing on
   * every poll while the player lines up the putt.
   */
  proximityEmitted?: string[];
}

export async function getSnapshot(
  tournamentId: string,
): Promise<PollSnapshot | null> {
  return (
    (await redis.get<PollSnapshot>(snapshotKey(tournamentId))) ?? null
  );
}

export async function putSnapshot(
  tournamentId: string,
  snap: PollSnapshot,
): Promise<void> {
  // Snapshots live as long as the tournament — 10-day TTL is plenty.
  await redis.set(snapshotKey(tournamentId), snap, {
    ex: 10 * 24 * 60 * 60,
  });
}

// ──────────────────────────────────────────────────────────────────
// Live presence — "X watching now"
// ──────────────────────────────────────────────────────────────────

const PRESENCE_WINDOW_MS = 45_000; // a visitor counts as "watching" for 45s after their last ping

function presenceKey(t: string) {
  return `feed:presence:${t}`;
}

/**
 * Record that `visitorId` is currently watching, and return the count
 * of distinct visitors active within the sliding window. Stale entries
 * are pruned on every call so the set never grows unbounded.
 */
export async function touchPresence(
  tournamentId: string,
  visitorId: string,
): Promise<number> {
  const key = presenceKey(tournamentId);
  const now = Date.now();
  await redis.zadd(key, { score: now, member: visitorId });
  await redis.zremrangebyscore(key, 0, now - PRESENCE_WINDOW_MS);
  await redis.expire(key, 120);
  return await redis.zcard(key);
}

/** Read-only count of current watchers (prunes stale entries first). */
export async function getWatchingCount(
  tournamentId: string,
): Promise<number> {
  const key = presenceKey(tournamentId);
  await redis.zremrangebyscore(key, 0, Date.now() - PRESENCE_WINDOW_MS);
  return await redis.zcard(key);
}

/**
 * Unique visitors who've opened the feed today. A genuine, cumulative
 * number — every distinct device that's looked, not a thin 45-second
 * live snapshot. Keyed by UTC date so it rolls over each day.
 */
export async function markSeenToday(
  tournamentId: string,
  visitorId: string,
): Promise<number> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `feed:seen:${tournamentId}:${date}`;
  await redis.sadd(key, visitorId);
  await redis.expire(key, 3 * 24 * 60 * 60);
  return await redis.scard(key);
}

// ──────────────────────────────────────────────────────────────────
// Poll lock — coalesces concurrent viewer-triggered polls
// ──────────────────────────────────────────────────────────────────

/**
 * Try to acquire the poll lock. Returns true if this caller should run
 * the diff engine; false if another poll ran within POLL_LOCK_SECONDS.
 * The lock is a plain SET NX EX so it self-expires.
 */
export async function acquirePollLock(
  tournamentId: string,
): Promise<boolean> {
  const res = await redis.set(`feed:poll-lock:${tournamentId}`, "1", {
    nx: true,
    ex: POLL_LOCK_SECONDS,
  });
  return res === "OK";
}

// ──────────────────────────────────────────────────────────────────
// Events
// ──────────────────────────────────────────────────────────────────

/** Push new events (newest last in the caller's array → stored newest-first). */
export async function pushEvents(
  tournamentId: string,
  events: FeedEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const key = eventsKey(tournamentId);
  // LPUSH each so the newest ends up at index 0.
  await redis.lpush(key, ...events.map((e) => JSON.stringify(e)));
  await redis.ltrim(key, 0, FEED_MAX_EVENTS - 1);
}

/** Most-recent `limit` events, newest first. */
export async function getEvents(
  tournamentId: string,
  limit: number = 80,
): Promise<FeedEvent[]> {
  const raw = await redis.lrange<string>(
    eventsKey(tournamentId),
    0,
    limit - 1,
  );
  return raw
    .map((r) => {
      try {
        // Upstash may return already-parsed objects depending on encoding.
        return typeof r === "string"
          ? (JSON.parse(r) as FeedEvent)
          : (r as FeedEvent);
      } catch {
        return null;
      }
    })
    .filter((e): e is FeedEvent => e !== null);
}

// ──────────────────────────────────────────────────────────────────
// Reactions
// ──────────────────────────────────────────────────────────────────

export async function getReactions(
  eventId: string,
): Promise<ReactionCounts> {
  const h = await redis.hgetall<Record<string, string>>(
    reactionsKey(eventId),
  );
  return {
    up: Number(h?.up ?? 0),
    down: Number(h?.down ?? 0),
  };
}

/** Bulk reaction fetch for rendering a page of events. */
export async function getReactionsBulk(
  eventIds: string[],
): Promise<Record<string, ReactionCounts>> {
  if (eventIds.length === 0) return {};
  const pipe = redis.pipeline();
  for (const id of eventIds) pipe.hgetall(reactionsKey(id));
  const results = (await pipe.exec()) as (Record<string, string> | null)[];
  const out: Record<string, ReactionCounts> = {};
  eventIds.forEach((id, i) => {
    const h = results[i];
    out[id] = { up: Number(h?.up ?? 0), down: Number(h?.down ?? 0) };
  });
  return out;
}

/**
 * Apply a reaction. `authorKey` is a hashed cookie id — one reaction
 * per author per event; switching from up→down adjusts both counters.
 * Returns the new counts, or null if the reaction was a no-op (same
 * direction already recorded).
 */
export async function react(
  eventId: string,
  authorKey: string,
  dir: "up" | "down",
): Promise<ReactionCounts | null> {
  const marker = reactedKey(eventId, authorKey);
  const prev = await redis.get<string>(marker);
  const want = dir === "up" ? "u" : "d";
  if (prev === want) return null; // already reacted this way

  const key = reactionsKey(eventId);
  if (prev === "u" && dir === "down") {
    await redis.hincrby(key, "up", -1);
    await redis.hincrby(key, "down", 1);
  } else if (prev === "d" && dir === "up") {
    await redis.hincrby(key, "down", -1);
    await redis.hincrby(key, "up", 1);
  } else {
    await redis.hincrby(key, dir, 1);
  }
  await redis.set(marker, want, { ex: REACTED_TTL });
  return getReactions(eventId);
}

// ──────────────────────────────────────────────────────────────────
// Enrichment overlay — shot-level headline rewrites, applied at read time
// ──────────────────────────────────────────────────────────────────

/**
 * A shot-detail enrichment for one event. Stored separately from the
 * event so it can be backfilled onto events that were created before
 * the enrichment ran (or before this feature existed), and so a
 * transient fetch failure just means "try again next poll" rather than
 * a permanently-generic headline.
 *
 * `headline` empty means "processed, nothing notable" — keeps us from
 * re-fetching the same event every poll.
 */
export interface Enrichment {
  headline: string;
  emoji: string;
  /** True when shot detail confirmed a reel-worthy disaster. */
  reelWorthy: boolean;
  /** Normalised shot trace for the hole — drawn as an SVG on reel cards. */
  trace?: ShotTraceSegment[];
}

// Versioned — bump when the enrichment analysis changes so the backlog
// re-processes against the new logic instead of keeping stale verdicts.
function enrichKey(t: string) {
  return `feed:enrich:v5:${t}`;
}

export async function getEnrichments(
  tournamentId: string,
): Promise<Record<string, Enrichment>> {
  const h = await redis.hgetall<Record<string, Enrichment | string>>(
    enrichKey(tournamentId),
  );
  const out: Record<string, Enrichment> = {};
  for (const [id, val] of Object.entries(h ?? {})) {
    try {
      out[id] =
        typeof val === "string" ? (JSON.parse(val) as Enrichment) : val;
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export async function putEnrichments(
  tournamentId: string,
  map: Record<string, Enrichment>,
): Promise<void> {
  const entries = Object.entries(map);
  if (entries.length === 0) return;
  const key = enrichKey(tournamentId);
  const flat: Record<string, string> = {};
  for (const [id, e] of entries) flat[id] = JSON.stringify(e);
  await redis.hset(key, flat);
  await redis.expire(key, 10 * 24 * 60 * 60);
}

// ──────────────────────────────────────────────────────────────────
// Leaderboard cache
// ──────────────────────────────────────────────────────────────────

/**
 * Cached leaderboard rows for /live display. Written by whoever holds
 * the poll lock (every ~25s) so the feed page can render a fresh-ish
 * leaderboard without every viewer hitting the PGA Tour API.
 */
export interface CachedLeaderboardRow {
  playerId: string;
  displayName: string;
  position: string;
  total: string;
  thru: string;
  playerState: string;
}

export async function cacheLeaderboard(
  tournamentId: string,
  rows: CachedLeaderboardRow[],
): Promise<void> {
  await redis.set(`feed:leaderboard:${tournamentId}`, rows, {
    ex: 5 * 60,
  });
}

export async function getCachedLeaderboard(
  tournamentId: string,
): Promise<CachedLeaderboardRow[]> {
  return (
    (await redis.get<CachedLeaderboardRow[]>(
      `feed:leaderboard:${tournamentId}`,
    )) ?? []
  );
}

// ──────────────────────────────────────────────────────────────────
// Burst reactions — ephemeral floating emoji everyone watching sees
// ──────────────────────────────────────────────────────────────────

export interface Burst {
  id: string;
  emoji: string;
  ts: number;
}

const BURST_CAP = 60;
const BURST_TTL = 120;

function burstsKey(t: string) {
  return `feed:bursts:${t}`;
}

export async function pushBurst(
  tournamentId: string,
  emoji: string,
): Promise<Burst> {
  const burst: Burst = {
    id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    emoji,
    ts: Date.now(),
  };
  const key = burstsKey(tournamentId);
  await redis.lpush(key, JSON.stringify(burst));
  await redis.ltrim(key, 0, BURST_CAP - 1);
  await redis.expire(key, BURST_TTL);
  return burst;
}

/** Recent bursts, newest first. Clients diff against ids they've already shown. */
export async function getRecentBursts(
  tournamentId: string,
): Promise<Burst[]> {
  const raw = await redis.lrange<string>(burstsKey(tournamentId), 0, BURST_CAP - 1);
  return raw
    .map((r) => {
      try {
        return typeof r === "string" ? (JSON.parse(r) as Burst) : (r as Burst);
      } catch {
        return null;
      }
    })
    .filter((b): b is Burst => b !== null);
}

// ──────────────────────────────────────────────────────────────────
// Comments
// ──────────────────────────────────────────────────────────────────

export async function addComment(comment: FeedComment): Promise<void> {
  const key = commentsKey(comment.eventId);
  await redis.lpush(key, JSON.stringify(comment));
  await redis.ltrim(key, 0, COMMENTS_PER_EVENT_CAP - 1);
}

export async function getComments(
  eventId: string,
  limit: number = 100,
): Promise<FeedComment[]> {
  const raw = await redis.lrange<string>(commentsKey(eventId), 0, limit - 1);
  return raw
    .map((r) => {
      try {
        return typeof r === "string"
          ? (JSON.parse(r) as FeedComment)
          : (r as FeedComment);
      } catch {
        return null;
      }
    })
    .filter((c): c is FeedComment => c !== null)
    .reverse(); // oldest first for display
}

export async function getCommentCountsBulk(
  eventIds: string[],
): Promise<Record<string, number>> {
  if (eventIds.length === 0) return {};
  const pipe = redis.pipeline();
  for (const id of eventIds) pipe.llen(commentsKey(id));
  const results = (await pipe.exec()) as number[];
  const out: Record<string, number> = {};
  eventIds.forEach((id, i) => {
    out[id] = Number(results[i] ?? 0);
  });
  return out;
}
