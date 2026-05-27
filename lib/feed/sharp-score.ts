/**
 * Sharp Score — generalised accuracy track-record across every
 * prediction a user makes on Pardle. Putt-polls, pre-round picks,
 * pre-tournament outright/cut calls, tracked-bet outcomes — all
 * funnel into one rolling credibility number.
 *
 * Lives alongside Putt-IQ (lib/feed/putt-iq.ts) rather than
 * replacing it; Putt-IQ stays as the putt-specific surface for
 * users who only engage with the polls. Sharp Score is the
 * everything-aggregated number that becomes the social-currency
 * chip on every name + every tipster channel.
 *
 * Redis schema:
 *   sharp:user:{authorKey}              hash { total, correct,
 *                                              currentStreak, longestStreak,
 *                                              firstAt }
 *   sharp:user:{authorKey}:cat:{cat}    hash { total, correct }
 *   sharp:lb:season                     zset authorKey → correct (rank by)
 *   sharp:lb:season:names               hash authorKey → display name
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

/** Categories of predictions that count toward Sharp Score.
 *  Weighting could be added later (e.g. bets count 2x putts) but
 *  v1 is all calls = 1 unit. */
export type SharpCategory =
  | "putt-poll"
  | "bet-outright"
  | "bet-top-finish"
  | "bet-round-score"
  | "bet-winning-score";

/** Minimum settled calls before a user's Sharp Score displays
 *  publicly. Low-data accuracy lies — 3/4 = 75% reads as elite but
 *  is noise. Below this threshold the UI shows "Newcomer". */
export const SHARP_MIN_CALLS = 10;

/** Rolling window we'll display once we add time-bucketed reads.
 *  v1 stores lifetime; v2 layers the 90-day window. */
export const SHARP_ROLLING_DAYS = 90;

function userKey(authorKey: string) {
  return `sharp:user:${authorKey}`;
}
function userCatKey(authorKey: string, cat: SharpCategory) {
  return `sharp:user:${authorKey}:cat:${cat}`;
}
function lbKey() {
  return `sharp:lb:season`;
}
function lbNamesKey() {
  return `sharp:lb:season:names`;
}

export interface SharpScoreStats {
  total: number;
  correct: number;
  accuracy: number;
  currentStreak: number;
  longestStreak: number;
  /** Cold-start gate — true when total >= SHARP_MIN_CALLS so the
   *  caller knows whether to render publicly or show "Newcomer". */
  qualified: boolean;
  /** Per-category breakdown for the panel view. */
  byCategory: Record<SharpCategory, { total: number; correct: number }>;
  /** Season-leaderboard rank, 1-indexed; null when below threshold. */
  rank: number | null;
}

/**
 * Record one settled prediction. Caller already knows the outcome
 * (correct/incorrect). Idempotent at the caller level — we
 * don't dedupe by call ID here. The two existing callers (putt-
 * poll settlement + bet settlement) already gate on first-close,
 * so double-counting isn't possible in normal flow.
 */
export async function recordCall(args: {
  authorKey: string;
  displayName?: string | null;
  category: SharpCategory;
  correct: boolean;
}): Promise<void> {
  const { authorKey, category, correct } = args;
  if (!authorKey) return;
  const uKey = userKey(authorKey);
  const ucKey = userCatKey(authorKey, category);

  await redis.hincrby(uKey, "total", 1);
  await redis.hincrby(ucKey, "total", 1);
  if (correct) {
    await redis.hincrby(uKey, "correct", 1);
    await redis.hincrby(ucKey, "correct", 1);
    await redis.zincrby(lbKey(), 1, authorKey);
  }

  // Streak tracking — increment on correct, reset on incorrect.
  if (correct) {
    const cur = (await redis.hincrby(uKey, "currentStreak", 1)) as number;
    const u = await redis.hgetall<Record<string, string>>(uKey);
    const longest = Number(u?.longestStreak ?? 0);
    if (cur > longest) {
      await redis.hset(uKey, { longestStreak: cur });
    }
  } else {
    await redis.hset(uKey, { currentStreak: 0 });
  }

  // First-seen timestamp so we can age-gate the leaderboard later
  // ("must have at least 30 days of calls"). Cheap conditional set.
  const u = await redis.hgetall<Record<string, string>>(uKey);
  if (!u?.firstAt) {
    await redis.hset(uKey, { firstAt: Date.now() });
  }

  // Mirror display name onto the leaderboard names lookup so the
  // leaderboard page can render without a join. Last-write wins.
  if (args.displayName) {
    await redis.hset(lbNamesKey(), { [authorKey]: args.displayName });
  }
}

/**
 * Read a user's Sharp Score across every category. Pipelined to one
 * Redis round-trip per non-empty category — typical reader will hit
 * 6-7 keys including the rank lookup, all in a single call.
 */
export async function getSharpScore(
  authorKey: string,
): Promise<SharpScoreStats> {
  const empty: SharpScoreStats = {
    total: 0,
    correct: 0,
    accuracy: 0,
    currentStreak: 0,
    longestStreak: 0,
    qualified: false,
    byCategory: {
      "putt-poll": { total: 0, correct: 0 },
      "bet-outright": { total: 0, correct: 0 },
      "bet-top-finish": { total: 0, correct: 0 },
      "bet-round-score": { total: 0, correct: 0 },
      "bet-winning-score": { total: 0, correct: 0 },
    },
    rank: null,
  };
  if (!authorKey) return empty;

  const u = await redis.hgetall<Record<string, string>>(userKey(authorKey));
  if (!u) return empty;
  const total = Number(u.total ?? 0);
  const correct = Number(u.correct ?? 0);
  empty.total = total;
  empty.correct = correct;
  empty.accuracy = total > 0 ? correct / total : 0;
  empty.currentStreak = Number(u.currentStreak ?? 0);
  empty.longestStreak = Number(u.longestStreak ?? 0);
  empty.qualified = total >= SHARP_MIN_CALLS;

  // Per-category — fire in parallel, all cheap Redis hashes.
  const cats: SharpCategory[] = [
    "putt-poll",
    "bet-outright",
    "bet-top-finish",
    "bet-round-score",
    "bet-winning-score",
  ];
  const catReads = await Promise.all(
    cats.map((c) =>
      redis.hgetall<Record<string, string>>(userCatKey(authorKey, c)),
    ),
  );
  cats.forEach((c, i) => {
    const h = catReads[i];
    if (h) {
      empty.byCategory[c].total = Number(h.total ?? 0);
      empty.byCategory[c].correct = Number(h.correct ?? 0);
    }
  });

  // Leaderboard rank — only meaningful past the cold-start gate.
  if (empty.qualified) {
    const r = await redis.zrevrank(lbKey(), authorKey);
    if (typeof r === "number") empty.rank = r + 1;
  }
  return empty;
}

export interface SharpLeaderRow {
  authorKey: string;
  displayName: string | null;
  correct: number;
}

/**
 * Top N callers by season-correct count. Caller filters out users
 * who don't qualify (total < SHARP_MIN_CALLS) — the leaderboard
 * stores all winners but qualification is checked per-row.
 */
export async function getTopSharpCallers(
  limit: number = 25,
): Promise<SharpLeaderRow[]> {
  const raw = await redis.zrange<string[]>(lbKey(), 0, limit - 1, {
    rev: true,
    withScores: true,
  });
  if (!raw || raw.length === 0) return [];
  const names =
    (await redis.hgetall<Record<string, string>>(lbNamesKey())) ?? {};
  const out: SharpLeaderRow[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const authorKey = String(raw[i]);
    const correct = Number(raw[i + 1]);
    out.push({
      authorKey,
      displayName: names[authorKey] ?? null,
      correct,
    });
  }
  return out;
}

/** Friendly accuracy label for the UI chip. 'New caller' until
 *  qualified, then 'NN%' once we have enough data. */
export function formatSharpAccuracy(stats: SharpScoreStats): string {
  if (!stats.qualified) return "New caller";
  return `${Math.round(stats.accuracy * 100)}%`;
}
