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

export const STATS_GAMES: readonly StatsGameId[] = [
  "pros",
  "holes",
  "clubs",
  "connections",
  "trivia",
  "faces",
];

export interface GameDayStats {
  game: StatsGameId;
  total: number;
  wins: number;
  /** Map of score (e.g. "3", "X") -> count. "X" means a loss. */
  distribution: Record<string, number>;
}

export interface DayStats {
  day: number;
  games: GameDayStats[];
}

function base(game: StatsGameId, day: number): string {
  return `stats:${game}:${day}`;
}

/**
 * Record a single game completion. Idempotent per (game, day, userToken)
 * for 48 hours, so refreshes / re-mounts don't double-count.
 *
 * Returns true if this call actually recorded a new play, false if it
 * was deduplicated.
 */
export async function recordPlay(args: {
  game: StatsGameId;
  day: number;
  userToken: string;
  isWin: boolean;
  score: number; // guesses used for Pros/Holes/Clubs; mistakes used for Connections
}): Promise<boolean> {
  const dedupKey = `played:${args.game}:${args.day}:${args.userToken}`;
  const setResult = await redis.set(dedupKey, "1", {
    nx: true,
    ex: 60 * 60 * 48, // 48-hour TTL
  });
  if (setResult !== "OK") return false;

  const b = base(args.game, args.day);
  const distKey = args.isWin ? String(args.score) : "X";

  const pipeline = redis.pipeline();
  pipeline.incr(`${b}:total`);
  if (args.isWin) pipeline.incr(`${b}:wins`);
  pipeline.incr(`${b}:dist:${distKey}`);
  await pipeline.exec();
  return true;
}

/**
 * Read aggregated stats for *today* across all four games. Each game
 * has its own launch date so its own day index — pass them in as a
 * map. Single Redis pipeline regardless of game count.
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

  const pipeline = redis.pipeline();
  for (const game of STATS_GAMES) {
    const b = base(game, days[game]);
    pipeline.get(`${b}:total`);
    pipeline.get(`${b}:wins`);
    for (const bucket of distBuckets) {
      pipeline.get(`${b}:dist:${bucket}`);
    }
  }
  const results = (await pipeline.exec()) as (string | number | null)[];

  const games: GameDayStats[] = [];
  let cursor = 0;
  const valuesPerGame = 2 + distBuckets.length;
  for (const game of STATS_GAMES) {
    const slice = results.slice(cursor, cursor + valuesPerGame);
    cursor += valuesPerGame;
    const total = Number(slice[0] ?? 0);
    const wins = Number(slice[1] ?? 0);
    const distribution: Record<string, number> = {};
    distBuckets.forEach((bucket, i) => {
      const count = Number(slice[2 + i] ?? 0);
      if (count > 0) distribution[bucket] = count;
    });
    games.push({ game, total, wins, distribution });
  }

  return games;
}
