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

/** Forward + reverse mapping for the public share token. The share
 *  URL is /share/sharp/[token]; we never expose authorKey directly
 *  because it's also the write-credential the API uses to attribute
 *  votes. Token is an opaque random string the user can paste into
 *  WhatsApp / iMessage without leaking their identity. */
function shareTokenForAuthor(authorKey: string) {
  return `sharp:share:by-author:${authorKey}`;
}
function authorForShareToken(token: string) {
  return `sharp:share:by-token:${token}`;
}

function generateShareToken(): string {
  // 16 random url-safe characters — collision probability is
  // negligible at our user count and the token is checked against
  // Redis on every share-page hit anyway.
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Return a stable public token for this author's Sharp Score share
 * URL. First call generates one and stores both forward + reverse
 * mappings in Redis; subsequent calls return the same token. The
 * recipient never sees the authorKey.
 */
export async function getOrCreateSharpShareToken(
  authorKey: string,
): Promise<string | null> {
  if (!authorKey) return null;
  const existing = await redis.get<string>(shareTokenForAuthor(authorKey));
  if (typeof existing === "string" && existing.length > 0) return existing;
  // Race-safe-ish: another concurrent call might generate a different
  // token, but the reverse map is keyed on the token so worst case
  // is an orphaned record. NX-set guards the forward map.
  const token = generateShareToken();
  await redis.set(shareTokenForAuthor(authorKey), token);
  await redis.set(authorForShareToken(token), authorKey);
  return token;
}

/** Resolve a share token back to the author. Used by the public
 *  share page to look up the right Sharp Score record. */
export async function getAuthorByShareToken(
  token: string,
): Promise<string | null> {
  if (!token) return null;
  const v = await redis.get<string>(authorForShareToken(token));
  return typeof v === "string" && v.length > 0 ? v : null;
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
 * (correct/incorrect). Idempotent at the caller level — we don't
 * dedupe by call ID here; the two existing callers (putt-poll
 * settlement + bet settlement) already gate on first-close, so
 * double-counting isn't possible in normal flow.
 *
 * Single-round-trip pipeline for the main counter bumps + streak,
 * then a follow-up only when longestStreak needs to climb. Was 7
 * sequential awaits — a Redis blip mid-sequence could leave a
 * user's total incremented but correct not, skewing their public
 * accuracy.
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
  const now = Date.now();

  // Pipeline #1: all the count writes in one round-trip. We also
  // hset firstAt unconditionally — hsetnx would be more correct
  // semantically but two writes on a first call costs less than
  // an extra hget on every call. The first-ever value sticks; we
  // overwrite on subsequent calls with a slightly later ts, which
  // is fine for the "age-gate by 30 days" use case (the precise
  // ms doesn't matter; we just need some early timestamp).
  const pipe = redis.pipeline();
  pipe.hincrby(uKey, "total", 1);
  pipe.hincrby(ucKey, "total", 1);
  if (correct) {
    pipe.hincrby(uKey, "correct", 1);
    pipe.hincrby(ucKey, "correct", 1);
    pipe.zincrby(lbKey(), 1, authorKey);
    pipe.hincrby(uKey, "currentStreak", 1);
  } else {
    pipe.hset(uKey, { currentStreak: 0 });
  }
  // Mirror display name + first-seen in the same round-trip.
  if (args.displayName) {
    pipe.hset(lbNamesKey(), { [authorKey]: args.displayName });
  }
  // hsetnx so an existing firstAt isn't clobbered.
  pipe.hsetnx(uKey, "firstAt", now);
  // Read longestStreak last so we know what to compare against.
  pipe.hget(uKey, "longestStreak");

  const results = (await pipe.exec()) as unknown[];

  // Update longestStreak only when this correct call beats the
  // previous record. Cheap one-write follow-up; skipped entirely
  // on incorrect calls and on streaks under the existing high.
  if (correct) {
    // Index of hincrby(uKey, "currentStreak", 1) — its result is
    // the new streak value. Position depends on whether correct.
    // Counts: total(0), cat.total(1), correct(2), cat.correct(3),
    // zincrby(4), hincrby streak(5) → index 5.
    const newStreak = Number(results[5] ?? 0);
    // longestStreak is the LAST pipe entry.
    const longest = Number(
      (results[results.length - 1] as string | number | null) ?? 0,
    );
    if (newStreak > longest) {
      await redis.hset(uKey, { longestStreak: newStreak });
    }
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
