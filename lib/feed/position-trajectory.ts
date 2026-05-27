/**
 * Per-player live leaderboard position history. Each successful
 * pollAndDiff samples the current numeric position; the inline
 * scorecard panel renders the last few hours as a sparkline so a
 * viewer can see whether a player is climbing, holding, or sliding
 * in real time.
 *
 * Redis schema:
 *   lbpos:traj:{tournamentId}:{playerId}   list<json> JSON{ts, pos}
 *     (LPUSH new sample, LTRIM to MAX_SAMPLES)
 *   lbpos:traj:{tournamentId}:{playerId}:lastTs  string<ms>
 *     (consulted by sampler to enforce min-interval throttling)
 *
 * Server-only.
 */
import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

/** Keep the last ~4 hours at one sample every 5 minutes. */
const MAX_SAMPLES = 48;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface PositionSample {
  ts: number;
  pos: number;
}

function key(tournamentId: string, playerId: string) {
  return `lbpos:traj:${tournamentId}:${playerId}`;
}

function lastTsKey(tournamentId: string, playerId: string) {
  return `lbpos:traj:${tournamentId}:${playerId}:lastTs`;
}

/** Parse "T9", "9", "CUT", "WD", "--" into a numeric rank.
 *  Inactive states return null and are skipped (no sample written). */
function parseRank(position: string): number | null {
  if (!position) return null;
  if (position === "CUT" || position === "WD" || position === "DQ" || position === "--") {
    return null;
  }
  const stripped = position.replace(/^T/, "");
  const n = Number(stripped);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Sample every active player's current rank. Throttled per-player
 * to MIN_INTERVAL_MS so the trajectory stays evenly spaced even
 * when pollAndDiff fires every minute or two.
 */
export async function samplePositions(
  tournamentId: string,
  leaderboard: Array<{ playerId: string; position: string }>,
): Promise<void> {
  if (leaderboard.length === 0) return;
  const now = Date.now();

  // Bulk read all last-sample timestamps in one mget round trip.
  const lastTsKeys = leaderboard.map((r) => lastTsKey(tournamentId, r.playerId));
  const lastTsRaw = (await redis.mget<(string | null)[]>(...lastTsKeys)) ?? [];

  // Build the write list — only players whose rank is parseable AND
  // whose last sample is older than MIN_INTERVAL_MS.
  const writes: Array<{ playerId: string; sample: PositionSample }> = [];
  leaderboard.forEach((r, i) => {
    const rank = parseRank(r.position);
    if (rank == null) return;
    const lastTs = Number(lastTsRaw[i] ?? 0);
    if (now - lastTs < MIN_INTERVAL_MS) return;
    writes.push({
      playerId: r.playerId,
      sample: { ts: now, pos: rank },
    });
  });
  if (writes.length === 0) return;

  // Fire all writes in parallel. Each entry is one lpush + ltrim +
  // a lastTs set; cheap and idempotent within the throttle window.
  await Promise.all(
    writes.map(async ({ playerId, sample }) => {
      const k = key(tournamentId, playerId);
      const tsK = lastTsKey(tournamentId, playerId);
      await redis.lpush(k, JSON.stringify(sample));
      await redis.ltrim(k, 0, MAX_SAMPLES - 1);
      await redis.set(tsK, String(sample.ts));
    }),
  );
}

/**
 * Read one player's trajectory, oldest-first so the sparkline can
 * render left-to-right without flipping the array client-side.
 */
export async function getPositionTrajectory(
  tournamentId: string,
  playerId: string,
): Promise<PositionSample[]> {
  const k = key(tournamentId, playerId);
  const raw = (await redis.lrange<string>(k, 0, MAX_SAMPLES - 1)) ?? [];
  if (raw.length === 0) return [];
  const parsed: PositionSample[] = [];
  for (const r of raw) {
    try {
      // Upstash returns deserialised values when the underlying
      // payload parses as JSON — guard for both shapes.
      const obj =
        typeof r === "string"
          ? (JSON.parse(r) as PositionSample)
          : (r as PositionSample);
      if (
        obj &&
        Number.isFinite(obj.ts) &&
        Number.isFinite(obj.pos) &&
        obj.pos > 0
      ) {
        parsed.push(obj);
      }
    } catch {
      // ignore corrupt entries
    }
  }
  // lpush stores newest-first; reverse for chronological render.
  return parsed.reverse();
}
