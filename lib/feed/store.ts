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
import type { ShotTrace } from "./shot-trace";

const redis = Redis.fromEnv();

const REACTED_TTL = 24 * 60 * 60;
// Coalesce window for viewer-triggered polls. Speed is the most
// valuable property of the live feed (highlights minutes-late kills
// the social loop), so we keep this short. 100 concurrent viewers
// still collapse to one PGA orchestrator fetch per window; the
// orchestrator itself comfortably handles this rate.
const POLL_LOCK_SECONDS = 6;

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
/** Sorted set per event of (authorKey → ts) — the timestamp each
 *  unique reacter most recently reacted. Drives the "going off" hot
 *  chip: ZCOUNT(reactionTsKey, now-60s, +inf) = distinct reacters in
 *  the last minute. Kept short-lived (1h TTL) since hotness only
 *  matters in the moments after an event lands. */
function reactionTsKey(e: string) {
  return `feed:reactts:${e}`;
}
const REACTION_TS_TTL = 60 * 60;
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
   * playerId → last-seen shot signature, of the form
   * `${currentHole}:${currentShotDisplay}:${playByPlay}`. When this
   * changes, a new stroke has been recorded. Used to emit shot-level
   * events (long drives, stuffed approaches, penalties) ahead of the
   * hole-completion score events. Optional for back-compat with old
   * snapshots written before the shots field existed.
   */
  shots?: Record<string, string>;
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
  // Single HTTP request via pipeline — was 4 separate round-trips,
  // each counted against Upstash's daily request budget.
  const key = presenceKey(tournamentId);
  const now = Date.now();
  const pipe = redis.pipeline();
  pipe.zadd(key, { score: now, member: visitorId });
  pipe.zremrangebyscore(key, 0, now - PRESENCE_WINDOW_MS);
  pipe.expire(key, 120);
  pipe.zcard(key);
  const res = (await pipe.exec()) as unknown[];
  return Number(res[3] ?? 0);
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
  // Pipelined for the same reason as touchPresence — 1 HTTP request
  // vs 3.
  const date = new Date().toISOString().slice(0, 10);
  const key = `feed:seen:${tournamentId}:${date}`;
  const pipe = redis.pipeline();
  pipe.sadd(key, visitorId);
  pipe.expire(key, 3 * 24 * 60 * 60);
  pipe.scard(key);
  const res = (await pipe.exec()) as unknown[];
  return Number(res[2] ?? 0);
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
  const want = dir === "up" ? "u" : "d";

  // Atomic claim — set marker to the new direction only if it
  // changed. Returns the previous value so we know which counter
  // to decrement. Two concurrent taps from the same author can't
  // both win this transition, fixing the double-increment race
  // where prev was checked in a separate round-trip from the set.
  const prev = (await redis.set(marker, want, {
    ex: REACTED_TTL,
    get: true,
  })) as string | null;
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
  // Record the reaction timestamp for hot-chip velocity tracking.
  // Use authorKey as member so re-reactions (down→up flip) update
  // the same entry rather than double-counting one person as two
  // reacters.
  const tsKey = reactionTsKey(eventId);
  await redis.zadd(tsKey, { score: Date.now(), member: authorKey });
  await redis.expire(tsKey, REACTION_TS_TTL);
  return getReactions(eventId);
}

/**
 * Bulk-count distinct reacters per event in the last `windowMs`. Used
 * at /api/feed render time to inject the 🔥 hot chip on events where
 * the engagement velocity has crossed a threshold. ZCOUNT is O(log n)
 * per key, pipelined across all event ids in one round-trip.
 */
export async function getReactionVelocityBulk(
  eventIds: string[],
  windowMs: number,
): Promise<Record<string, number>> {
  if (eventIds.length === 0) return {};
  const since = Date.now() - windowMs;
  const pipe = redis.pipeline();
  for (const id of eventIds) {
    pipe.zcount(reactionTsKey(id), since, "+inf");
  }
  const res = (await pipe.exec()) as unknown[];
  const out: Record<string, number> = {};
  for (let i = 0; i < eventIds.length; i++) {
    const v = res[i];
    out[eventIds[i]] = typeof v === "number" ? v : 0;
  }
  return out;
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
  /** True when shot detail confirmed a genuine wow shot for the best reel. */
  reelGreat: boolean;
  /** Normalised shot trace for the hole — drawn as an SVG on reel cards. */
  trace?: ShotTrace;
}

// Versioned — bump when the enrichment analysis changes so the backlog
// re-processes against the new logic instead of keeping stale verdicts.
function enrichKey(t: string) {
  return `feed:enrich:v13:${t}`;
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
// Tournament par map — hole → par, per round. Doesn't really change
// once a course is set up, but we refresh from the orchestrator each
// poll cycle just in case (free-tier hosting tee changes etc).
// Powers round-score bet valuation: client needs to know which holes
// remain and what their par is to project the rest of a round.
// ──────────────────────────────────────────────────────────────────

export type TournamentPars = Record<number, Record<number, number>>;

export async function cacheTournamentPars(
  tournamentId: string,
  parsByRoundHole: TournamentPars,
): Promise<void> {
  await redis.set(`feed:pars:${tournamentId}`, parsByRoundHole, {
    ex: 24 * 60 * 60,
  });
}

export async function getCachedTournamentPars(
  tournamentId: string,
): Promise<TournamentPars> {
  return (
    (await redis.get<TournamentPars>(`feed:pars:${tournamentId}`)) ?? {}
  );
}

// ──────────────────────────────────────────────────────────────────
// Player skill cache — DataGolf SG_total (strokes gained per round
// vs current field). Refreshed ~daily; powers the round-score bet
// model's skill adjustment.
// ──────────────────────────────────────────────────────────────────

export type PlayerSkillMap = Record<string, number>;

export async function cachePlayerSkill(
  tournamentId: string,
  skill: PlayerSkillMap,
): Promise<void> {
  await redis.set(`feed:skill:${tournamentId}`, skill, {
    ex: 24 * 60 * 60,
  });
}

export async function getCachedPlayerSkill(
  tournamentId: string,
): Promise<PlayerSkillMap | null> {
  return await redis.get<PlayerSkillMap>(`feed:skill:${tournamentId}`);
}

// ──────────────────────────────────────────────────────────────────
// Winning-score CDF snapshot — per-tournament rolling history of the
// model's "P(eventual winner < L)" for L at half-integer steps. Used
// to draw a trajectory chart on the bet detail page; not used in any
// real-time decision path.
// ──────────────────────────────────────────────────────────────────

export interface WinningScoreCdfPoint {
  line: number;
  /** P(winner < line) at this snapshot. 0..1. */
  probUnder: number;
}

export interface WinningScoreSnapshot {
  ts: number;
  points: WinningScoreCdfPoint[];
}

const WS_MAX_SNAPSHOTS = 720;

function wsKey(tournamentId: string): string {
  return `feed:wscdf:${tournamentId}`;
}

export async function pushWinningScoreSnapshot(
  tournamentId: string,
  snapshot: WinningScoreSnapshot,
): Promise<void> {
  const k = wsKey(tournamentId);
  await redis.lpush(k, JSON.stringify(snapshot));
  await redis.ltrim(k, 0, WS_MAX_SNAPSHOTS - 1);
}

export async function getCachedWinningScoreHistory(
  tournamentId: string,
): Promise<WinningScoreSnapshot[]> {
  const raw = await redis.lrange<unknown>(
    wsKey(tournamentId),
    0,
    WS_MAX_SNAPSHOTS - 1,
  );
  const out: WinningScoreSnapshot[] = [];
  for (const r of raw) {
    try {
      const parsed =
        typeof r === "string" ? (JSON.parse(r) as WinningScoreSnapshot) : (r as WinningScoreSnapshot);
      if (parsed && typeof parsed.ts === "number" && Array.isArray(parsed.points)) {
        out.push(parsed);
      }
    } catch {}
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Field hole stats — for the round-score bet model. Each entry is
// the field-wide mean and variance of (strokes − par) on a given
// (round, hole), aggregated across every player who's completed it
// so far this tournament.
// ──────────────────────────────────────────────────────────────────

export interface FieldHoleStat {
  mean: number;
  variance: number;
  count: number;
}

export type FieldHoleStats = Record<number, Record<number, FieldHoleStat>>;

export function computeFieldStats(
  snapshot: PollSnapshot | null,
  pars: TournamentPars,
): FieldHoleStats {
  if (!snapshot) return {};
  const sums: Record<
    number,
    Record<number, { sum: number; sumsq: number; count: number }>
  > = {};
  for (const byRound of Object.values(snapshot.holes)) {
    for (const [rStr, holes] of Object.entries(byRound)) {
      const round = Number(rStr);
      const pr = pars[round] ?? {};
      if (!sums[round]) sums[round] = {};
      for (const [holeStr, scoreStr] of Object.entries(holes)) {
        const hole = Number(holeStr);
        const par = pr[hole];
        const strokes = Number(scoreStr);
        if (par == null || !Number.isFinite(strokes) || strokes <= 0) continue;
        const dev = strokes - par;
        const slot = sums[round][hole] ?? { sum: 0, sumsq: 0, count: 0 };
        slot.sum += dev;
        slot.sumsq += dev * dev;
        slot.count++;
        sums[round][hole] = slot;
      }
    }
  }
  const out: FieldHoleStats = {};
  for (const [rStr, holes] of Object.entries(sums)) {
    const round = Number(rStr);
    out[round] = {};
    for (const [hStr, slot] of Object.entries(holes)) {
      const hole = Number(hStr);
      const mean = slot.sum / slot.count;
      const variance = Math.max(
        0.05,
        slot.sumsq / slot.count - mean * mean,
      );
      out[round][hole] = { mean, variance, count: slot.count };
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Feed bundle — pipelines every read /api/feed needs into ONE HTTP
// request. Each helper above issues a separate Upstash request which
// adds up fast (their daily quota caps total requests, not commands).
// Use this for /api/feed's main payload assembly; individual helpers
// stay for narrow callers.
// ──────────────────────────────────────────────────────────────────

/** Re-shape of OddsSample from ./odds-store, kept local so the bundle
 *  doesn't pull a circular import. */
interface FeedBundleOddsSample {
  ts: number;
  p: number;
}

export interface FeedBundle {
  events: FeedEvent[]; // up to FEED_MAX_EVENTS (1000) — caller slices
  bursts: Burst[];
  leaderboard: CachedLeaderboardRow[];
  enrichments: Record<string, Enrichment>;
  snapshot: PollSnapshot | null;
  pars: TournamentPars;
  /** playerId → ordered samples (or null when the player has none yet) */
  oddsBuffers: Record<string, FeedBundleOddsSample[] | null>;
  /** playerId → ordered DataGolf in-play prob samples — outright chart
   *  fallback when Polymarket is thin for a given player. */
  dgWinProbs: Record<string, FeedBundleDgSample[] | null>;
  /** Rolling history of winning-score CDF snapshots (newest first). */
  winningScoreHistory: WinningScoreSnapshot[];
  /** DraftKings top-X decimal-odds buffers. cutoff → playerId → samples.
   *  Kept for backward compat; the top-finish bet now reads from
   *  topFinishCurrent / topFinishHistory (internal MC). */
  dkTopOdds: Record<5 | 10 | 20, Record<string, FeedBundleOddsSample[] | null>>;
  /** DK + FD outright winner odds via The Odds API. */
  bookOdds: {
    draftkings: Record<string, FeedBundleOddsSample[] | null>;
    fanduel: Record<string, FeedBundleOddsSample[] | null>;
  };
}

interface FeedBundleDgSample {
  ts: number;
  prob: number;
}

function parseEventStr(raw: unknown): FeedEvent | null {
  try {
    if (typeof raw === "string") return JSON.parse(raw) as FeedEvent;
    if (raw && typeof raw === "object") return raw as FeedEvent;
  } catch {}
  return null;
}
function parseBurstStr(raw: unknown): Burst | null {
  try {
    if (typeof raw === "string") return JSON.parse(raw) as Burst;
    if (raw && typeof raw === "object") return raw as Burst;
  } catch {}
  return null;
}

export async function getFeedBundle(
  tournamentId: string,
): Promise<FeedBundle> {
  const pipe = redis.pipeline();
  // Index 0 — events list (newest first, capped at FEED_MAX_EVENTS)
  pipe.lrange(eventsKey(tournamentId), 0, FEED_MAX_EVENTS - 1);
  // Index 1 — recent bursts
  pipe.lrange(burstsKey(tournamentId), 0, 59);
  // Index 2 — cached leaderboard (full field for player search)
  pipe.get(`feed:leaderboard:${tournamentId}`);
  // Index 3 — enrichment overlay (per-event headline / trace / reel flags)
  pipe.hgetall(enrichKey(tournamentId));
  // Index 4 — snapshot (per-player hole state for round-score bets)
  pipe.get(snapshotKey(tournamentId));
  // Index 5 — tournament hole pars (per round)
  pipe.get(`feed:pars:${tournamentId}`);
  // Index 6 — full odds buffer hash (per-player rolling samples). We
  // fetch the whole hash instead of hmget'ing a known subset so we
  // can stay inside one pipeline; the payload's bounded by player
  // count × MAX_SAMPLES.
  pipe.hgetall(`feed:odds:${tournamentId}`);
  // Index 7 — DataGolf in-play win-prob buffer (per-player). Used as
  // outright chart fallback when Polymarket is thin.
  pipe.hgetall(`feed:dg:${tournamentId}`);
  // Index 8 — Winning-score CDF rolling history (newest first).
  pipe.lrange(wsKey(tournamentId), 0, WS_MAX_SNAPSHOTS - 1);
  // Index 9-11 — DraftKings top-X (5/10/20) odds buffers (legacy, empty).
  pipe.hgetall(`feed:dk-top:${tournamentId}:5`);
  pipe.hgetall(`feed:dk-top:${tournamentId}:10`);
  pipe.hgetall(`feed:dk-top:${tournamentId}:20`);
  // Index 12-13 — Odds API per-book outright winner buffers.
  pipe.hgetall(`feed:book-odds:${tournamentId}:draftkings`);
  pipe.hgetall(`feed:book-odds:${tournamentId}:fanduel`);
  const res = (await pipe.exec()) as unknown[];

  const eventsRaw = (res[0] ?? []) as unknown[];
  const burstsRaw = (res[1] ?? []) as unknown[];
  const leaderboardRaw = (res[2] ?? null) as
    | CachedLeaderboardRow[]
    | null;
  const enrichRaw = (res[3] ?? {}) as Record<string, Enrichment | string>;
  const snapshotRaw = (res[4] ?? null) as PollSnapshot | null;
  const parsRaw = (res[5] ?? {}) as TournamentPars;
  const oddsRaw = (res[6] ?? {}) as Record<
    string,
    FeedBundleOddsSample[] | null
  >;
  const dgRaw = (res[7] ?? {}) as Record<
    string,
    FeedBundleDgSample[] | null
  >;
  const dkTop5Raw = (res[9] ?? {}) as Record<
    string,
    FeedBundleOddsSample[] | null
  >;
  const dkTop10Raw = (res[10] ?? {}) as Record<
    string,
    FeedBundleOddsSample[] | null
  >;
  const dkTop20Raw = (res[11] ?? {}) as Record<
    string,
    FeedBundleOddsSample[] | null
  >;
  const bookDkRaw = (res[12] ?? {}) as Record<
    string,
    FeedBundleOddsSample[] | null
  >;
  const bookFdRaw = (res[13] ?? {}) as Record<
    string,
    FeedBundleOddsSample[] | null
  >;
  const wsRaw = (res[8] ?? []) as unknown[];
  const winningScoreHistory: WinningScoreSnapshot[] = [];
  for (const r of wsRaw) {
    try {
      const parsed =
        typeof r === "string"
          ? (JSON.parse(r) as WinningScoreSnapshot)
          : (r as WinningScoreSnapshot);
      if (
        parsed &&
        typeof parsed.ts === "number" &&
        Array.isArray(parsed.points)
      ) {
        winningScoreHistory.push(parsed);
      }
    } catch {}
  }

  const events: FeedEvent[] = [];
  for (const r of eventsRaw) {
    const e = parseEventStr(r);
    if (e) events.push(e);
  }
  const bursts: Burst[] = [];
  for (const r of burstsRaw) {
    const b = parseBurstStr(r);
    if (b) bursts.push(b);
  }
  const enrichments: Record<string, Enrichment> = {};
  for (const [id, val] of Object.entries(enrichRaw)) {
    try {
      enrichments[id] =
        typeof val === "string" ? (JSON.parse(val) as Enrichment) : val;
    } catch {}
  }

  return {
    events,
    bursts,
    leaderboard: leaderboardRaw ?? [],
    enrichments,
    snapshot: snapshotRaw,
    pars: parsRaw,
    oddsBuffers: oddsRaw,
    dgWinProbs: dgRaw,
    winningScoreHistory,
    dkTopOdds: {
      5: dkTop5Raw,
      10: dkTop10Raw,
      20: dkTop20Raw,
    },
    bookOdds: {
      draftkings: bookDkRaw,
      fanduel: bookFdRaw,
    },
  };
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
