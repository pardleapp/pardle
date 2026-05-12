/**
 * Server-side stats backend — counts daily plays / wins / score
 * distribution per game in Upstash Redis. Designed to be cheap on
 * commands (free tier covers 500k/month).
 *
 * Keys (all per day):
 *   stats:{game}:{day}:total          — number of distinct devices played
 *   stats:{game}:{day}:wins           — number of those who won
 *   stats:{game}:{day}:dist:{score}   — bucket count per score, "X" for losses
 *   played:{game}:{day}:{userToken}   — dedup marker, 48h TTL
 *
 * Reads collect those four games' counters via a pipeline so the
 * /today page only spends ~12 commands per render.
 */

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export type StatsGameId =
  | "pros"
  | "holes"
  | "clubs"
  | "connections"
  | "trivia"
  | "faces";

// Note: "clubs" is intentionally absent — the Clubhouses tile is hidden
// from the hub and we don't show it on /today either. The type still
// includes it so the /clubs page can still record plays via direct link.
export const STATS_GAMES: readonly StatsGameId[] = [
  "pros",
  "holes",
  "connections",
  "trivia",
  "faces",
];

/**
 * Games with multiple modes/difficulties record stats per variant so
 * /today can filter by Easy/Medium/Hard. Games not in this map are
 * recorded under a single aggregate key.
 */
export const GAME_VARIANTS: Partial<Record<StatsGameId, readonly string[]>> = {
  trivia: ["easy", "medium", "hard"],
};

export interface GameDayStats {
  game: StatsGameId;
  /** Variant the stats are scoped to (e.g. "medium") — undefined when
   * the game has no variants. */
  variant?: string;
  total: number;
  wins: number;
  /** Map of score (e.g. "3", "X") -> count. "X" means a loss. */
  distribution: Record<string, number>;
}

export interface DayStats {
  day: number;
  games: GameDayStats[];
}

function base(game: StatsGameId, day: number, variant?: string): string {
  // Variant key appends after day so games without variants keep their
  // historical keys unchanged. e.g. stats:trivia:5:medium vs stats:pros:5
  return variant ? `stats:${game}:${day}:${variant}` : `stats:${game}:${day}`;
}

/**
 * Record a single game completion. Idempotent per (game, variant, day,
 * userToken) for 48 hours, so refreshes / re-mounts don't double-count.
 *
 * Returns true if this call actually recorded a new play, false if it
 * was deduplicated.
 */
export async function recordPlay(args: {
  game: StatsGameId;
  variant?: string;
  day: number;
  userToken: string;
  isWin: boolean;
  score: number; // guesses used for Pros/Holes/Clubs; mistakes used for Connections
}): Promise<boolean> {
  const dedupKey = args.variant
    ? `played:${args.game}:${args.day}:${args.variant}:${args.userToken}`
    : `played:${args.game}:${args.day}:${args.userToken}`;
  const setResult = await redis.set(dedupKey, "1", {
    nx: true,
    ex: 60 * 60 * 48, // 48-hour TTL
  });
  if (setResult !== "OK") return false;

  const b = base(args.game, args.day, args.variant);
  const distKey = args.isWin ? String(args.score) : "X";

  const pipeline = redis.pipeline();
  pipeline.incr(`${b}:total`);
  if (args.isWin) pipeline.incr(`${b}:wins`);
  pipeline.incr(`${b}:dist:${distKey}`);
  await pipeline.exec();
  return true;
}

/**
 * Read aggregated stats for *today* across all games. Each game has its
 * own launch date so its own day index — pass them in as a map.
 *
 * For games with variants (e.g. trivia easy/medium/hard) one entry is
 * returned per variant. For games without variants, one entry with
 * `variant: undefined`. Caller groups by `game` and renders accordingly.
 *
 * Single Redis pipeline regardless of game/variant count.
 */
export async function readPerGameStats(
  days: Record<StatsGameId, number>,
): Promise<GameDayStats[]> {
  // Widened to 0..12 so the Faces game (max 12 pros named) and Trivia
  // (max 10/10) report a complete distribution on /today. Pros/Holes/
  // Clubs only ever write 0..6 so the extra buckets cost a few empty
  // Redis GETs per page-load (free-tier headroom is fine).
  const distBuckets = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "X",
  ];

  // Expand each game into one query per variant (or one with no variant
  // for variant-less games). Keep parallel arrays so we can re-map the
  // pipeline results back to the right game/variant.
  const queries: { game: StatsGameId; variant?: string }[] = [];
  for (const game of STATS_GAMES) {
    const variants = GAME_VARIANTS[game];
    if (variants && variants.length > 0) {
      for (const v of variants) queries.push({ game, variant: v });
    } else {
      queries.push({ game });
    }
  }

  const pipeline = redis.pipeline();
  for (const q of queries) {
    const b = base(q.game, days[q.game], q.variant);
    pipeline.get(`${b}:total`);
    pipeline.get(`${b}:wins`);
    for (const bucket of distBuckets) {
      pipeline.get(`${b}:dist:${bucket}`);
    }
  }
  const results = (await pipeline.exec()) as (string | number | null)[];

  const out: GameDayStats[] = [];
  let cursor = 0;
  const valuesPerQuery = 2 + distBuckets.length;
  for (const q of queries) {
    const slice = results.slice(cursor, cursor + valuesPerQuery);
    cursor += valuesPerQuery;
    const total = Number(slice[0] ?? 0);
    const wins = Number(slice[1] ?? 0);
    const distribution: Record<string, number> = {};
    distBuckets.forEach((bucket, i) => {
      const count = Number(slice[2 + i] ?? 0);
      if (count > 0) distribution[bucket] = count;
    });
    out.push({ game: q.game, variant: q.variant, total, wins, distribution });
  }

  return out;
}
