/**
 * Putt-prediction "IQ" — per-user accuracy + streak + leaderboards.
 *
 * The engagement layer on top of the raw poll voting. Every time a poll
 * settles we sweep the voter list and:
 *   - increment each voter's total / correct counts
 *   - update their current streak (resets on a miss; bumps on a hit)
 *   - update the tournament leaderboard sorted set, keyed by correct
 *     count (with a min-polls floor enforced at read time so a 1/1
 *     account doesn't dominate)
 *
 * Identity is the same anonymous `authorKey` (cookie id) used by
 * reactions + comments + voting. No auth, no Supabase migration —
 * everything lives in Redis with TTLs that keep the storage bounded.
 *
 * Storage:
 *   feed:puttpoll:voters:{pollId}                 → hash { authorKey: "y"|"n" }
 *   feed:puttiq:user:{authorKey}                  → hash { total, correct,
 *                                                          currentStreak,
 *                                                          longestStreak,
 *                                                          name? }
 *   feed:puttiq:user:{authorKey}:t:{tournamentId} → hash { total, correct }
 *   feed:puttiq:lb:{tournamentId}                 → ZSET (member=authorKey,
 *                                                         score=correct count)
 *   feed:puttiq:lb:names:{tournamentId}           → hash { authorKey: displayName }
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const USER_TTL = 60 * 24 * 60 * 60; // 60d — keeps streaks alive across weeks
const TOURNAMENT_TTL = 30 * 24 * 60 * 60;
const VOTERS_TTL = 48 * 60 * 60; // matches the poll itself

/** Min polls before a leaderboard entry is "qualified" — stops a 1/1
 *  account from sitting above someone who's hit 18/25. */
export const LEADERBOARD_MIN_POLLS = 5;

function votersKey(pollId: string) {
  return `feed:puttpoll:voters:${pollId}`;
}
function userKey(authorKey: string) {
  return `feed:puttiq:user:${authorKey}`;
}
function userTournamentKey(authorKey: string, tournamentId: string) {
  return `feed:puttiq:user:${authorKey}:t:${tournamentId}`;
}
function leaderboardKey(tournamentId: string) {
  return `feed:puttiq:lb:${tournamentId}`;
}
function namesKey(tournamentId: string) {
  return `feed:puttiq:lb:names:${tournamentId}`;
}

// ── Voter list (per poll) ──────────────────────────────────────────

/** Mark a voter against a poll. Idempotent — overwrites flips. */
export async function recordVoter(
  pollId: string,
  authorKey: string,
  vote: "yes" | "no",
): Promise<void> {
  const k = votersKey(pollId);
  await redis.hset(k, { [authorKey]: vote === "yes" ? "y" : "n" });
  await redis.expire(k, VOTERS_TTL);
}

export async function getVoters(
  pollId: string,
): Promise<Record<string, "yes" | "no">> {
  const h = await redis.hgetall<Record<string, string>>(votersKey(pollId));
  if (!h) return {};
  const out: Record<string, "yes" | "no"> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = v === "y" ? "yes" : "no";
  }
  return out;
}

// ── Per-user stats ─────────────────────────────────────────────────

export interface PuttIqStats {
  total: number;
  correct: number;
  currentStreak: number;
  longestStreak: number;
  /** Per-tournament breakdown — populated when the caller requested it. */
  tournament?: {
    total: number;
    correct: number;
  };
  /** Rank in the tournament leaderboard, 1-indexed; null when caller
   *  hasn't qualified yet (under LEADERBOARD_MIN_POLLS). */
  tournamentRank?: number | null;
}

export async function getUserStats(
  authorKey: string,
  tournamentId?: string,
): Promise<PuttIqStats> {
  const u = await redis.hgetall<Record<string, string>>(userKey(authorKey));
  const base: PuttIqStats = {
    total: Number(u?.total ?? 0),
    correct: Number(u?.correct ?? 0),
    currentStreak: Number(u?.currentStreak ?? 0),
    longestStreak: Number(u?.longestStreak ?? 0),
  };
  if (!tournamentId) return base;
  const t = await redis.hgetall<Record<string, string>>(
    userTournamentKey(authorKey, tournamentId),
  );
  base.tournament = {
    total: Number(t?.total ?? 0),
    correct: Number(t?.correct ?? 0),
  };
  // Leaderboard rank (only meaningful if qualified).
  if ((base.tournament?.total ?? 0) >= LEADERBOARD_MIN_POLLS) {
    const r = await redis.zrevrank(leaderboardKey(tournamentId), authorKey);
    if (typeof r === "number") base.tournamentRank = r + 1;
  } else {
    base.tournamentRank = null;
  }
  return base;
}

/**
 * Settle stats for one poll — read its voter list, compute correct/
 * incorrect for each voter, and update their personal + per-tournament
 * + leaderboard counters in a single batched Redis pipeline.
 *
 * Idempotent in the engine sense: the caller (engine settle path) only
 * fires this on the first close (we already short-circuit there). Don't
 * call this from places that might re-settle.
 */
export async function settlePollStats(args: {
  pollId: string;
  tournamentId: string;
  made: boolean;
}): Promise<void> {
  const voters = await getVoters(args.pollId);
  const entries = Object.entries(voters);
  if (entries.length === 0) return;

  const lbKey = leaderboardKey(args.tournamentId);
  const pipe = redis.pipeline();
  for (const [author, vote] of entries) {
    const correct = (vote === "yes" && args.made) || (vote === "no" && !args.made);
    const uKey = userKey(author);
    const utKey = userTournamentKey(author, args.tournamentId);
    pipe.hincrby(uKey, "total", 1);
    pipe.hincrby(utKey, "total", 1);
    if (correct) {
      pipe.hincrby(uKey, "correct", 1);
      pipe.hincrby(uKey, "currentStreak", 1);
      pipe.hincrby(utKey, "correct", 1);
      pipe.zincrby(lbKey, 1, author);
    } else {
      // Streak resets to 0 on a miss. Longest streak is reconciled by
      // the read path (max of current + stored longest).
      pipe.hset(uKey, { currentStreak: 0 });
    }
    pipe.expire(uKey, USER_TTL);
    pipe.expire(utKey, TOURNAMENT_TTL);
  }
  pipe.expire(lbKey, TOURNAMENT_TTL);
  await pipe.exec();

  // Reconcile longestStreak per user — read current values, bump
  // longest where current exceeded it. Cheap enough at typical scale
  // (a poll settles with maybe a few dozen voters).
  await Promise.all(
    entries.map(async ([author, vote]) => {
      const correct = (vote === "yes" && args.made) || (vote === "no" && !args.made);
      if (!correct) return;
      const h = await redis.hgetall<Record<string, string>>(userKey(author));
      const cur = Number(h?.currentStreak ?? 0);
      const longest = Number(h?.longestStreak ?? 0);
      if (cur > longest) {
        await redis.hset(userKey(author), { longestStreak: cur });
      }
    }),
  );
}

// ── Display names ──────────────────────────────────────────────────

/** Stash the display name a user picks for the leaderboard. Same
 *  cookie-based identity model as comments — no auth required. */
export async function setUserName(
  tournamentId: string,
  authorKey: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim().slice(0, 30);
  if (!trimmed) return;
  await redis.hset(namesKey(tournamentId), { [authorKey]: trimmed });
  await redis.expire(namesKey(tournamentId), TOURNAMENT_TTL);
}

async function getNames(
  tournamentId: string,
  authorKeys: string[],
): Promise<Record<string, string>> {
  if (authorKeys.length === 0) return {};
  const h = await redis.hgetall<Record<string, string>>(
    namesKey(tournamentId),
  );
  const out: Record<string, string> = {};
  for (const k of authorKeys) {
    if (h?.[k]) out[k] = h[k];
  }
  return out;
}

// ── Tournament leaderboard ─────────────────────────────────────────

export interface LeaderboardRow {
  authorKey: string;
  displayName: string;
  correct: number;
  total: number;
  accuracy: number; // 0..1
}

/**
 * Top callers for a tournament — sorted by correct count, with the
 * minimum-polls floor enforced. Names default to "Caller XXXX"
 * (short hash of authorKey) when the user hasn't set one.
 */
export async function getTopCallers(
  tournamentId: string,
  limit = 20,
): Promise<LeaderboardRow[]> {
  // Over-fetch a bit so the min-polls filter doesn't leave us short.
  const raw = await redis.zrange<string[]>(
    leaderboardKey(tournamentId),
    0,
    Math.max(limit * 3, 50),
    { rev: true, withScores: true },
  );
  if (!raw || raw.length === 0) return [];
  const candidates: { authorKey: string; correct: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const authorKey = raw[i];
    const correct = Number(raw[i + 1]);
    candidates.push({ authorKey, correct });
  }
  // Pull totals for each candidate so we can filter on min-polls.
  const totals = await Promise.all(
    candidates.map((c) =>
      redis.hget<string>(
        userTournamentKey(c.authorKey, tournamentId),
        "total",
      ),
    ),
  );
  const names = await getNames(
    tournamentId,
    candidates.map((c) => c.authorKey),
  );
  const rows: LeaderboardRow[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const total = Number(totals[i] ?? 0);
    if (total < LEADERBOARD_MIN_POLLS) continue;
    const { authorKey, correct } = candidates[i];
    rows.push({
      authorKey,
      displayName: names[authorKey] ?? `Caller ${authorKey.slice(0, 4)}`,
      correct,
      total,
      accuracy: total > 0 ? correct / total : 0,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * Crowd accuracy on a closed poll — used by the feed to surface a
 * "crowd was wrong" chip when consensus opposed the outcome.
 *
 * Returns null when the vote count is too small to read as consensus.
 */
export function crowdConsensusWasWrong(args: {
  yes: number;
  no: number;
  made: boolean;
  minVotes?: number;
  minMargin?: number;
}): boolean {
  const total = args.yes + args.no;
  const minVotes = args.minVotes ?? 6;
  const minMargin = args.minMargin ?? 0.6; // 60%+ said one way
  if (total < minVotes) return false;
  const yesFrac = args.yes / total;
  if (yesFrac >= minMargin && !args.made) return true; // crowd said yes, missed
  if (1 - yesFrac >= minMargin && args.made) return true; // crowd said no, made
  return false;
}
