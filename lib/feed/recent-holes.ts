/**
 * Server helper: per-hole synopses for a player's most recent holes —
 * "up and down for par on 12", "missed the green for bogey on 13". Fed
 * by a single shot-detail fetch for the round currently in progress (or
 * the most recently completed round if they're between rounds).
 */

import "server-only";
import {
  getShotDetailsBatch,
  type PGAScorecard,
  type PGAShotHole,
} from "@/lib/golf-api/pgatour";
import { resultFor, type ScoreResult } from "./types";
import { summarizeHole } from "./shot-analysis";

export interface RecentHole {
  round: number;
  holeNumber: number;
  par: number;
  score: number;
  result: ScoreResult;
  synopsis: string;
  emoji: string;
}

const RECENT_LIMIT = 6;

function latestPlayedRound(scorecard: PGAScorecard): number | null {
  for (let r = 4; r >= 1; r--) {
    const holes = scorecard.rounds[r];
    if (!holes || holes.length === 0) continue;
    const played = holes.some(
      (h) => h.score !== "" && h.score !== "-" && Number.isFinite(Number(h.score)),
    );
    if (played) return r;
  }
  return null;
}

const FRONT_TO_BACK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const BACK_TO_FRONT = [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * In two-tee starts, half the field begins on hole 10 and wraps to the
 * front nine after 18 — so their most-recently played hole isn't
 * always the highest number. The orchestrator marks back-nine starters
 * with `*` in the `thru` string ("14*", "F*"). When that hint is
 * missing, fall back to the pattern of played holes.
 */
function inferStartTee(
  played: Set<number>,
  thruHint: string | undefined,
): 1 | 10 {
  if (thruHint?.includes("*")) return 10;
  if (thruHint && thruHint !== "") return 1;
  if (played.has(18) && !played.has(9)) return 10;
  if (played.has(10) && !played.has(1)) return 10;
  return 1;
}

export async function getRecentHoles(
  tournamentId: string,
  playerId: string,
  scorecard: PGAScorecard | undefined,
  thruHint?: string,
): Promise<RecentHole[]> {
  if (!scorecard) return [];
  const round = latestPlayedRound(scorecard);
  if (round === null) return [];

  const detail = await getShotDetailsBatch(tournamentId, [
    { playerId, round },
  ]);
  const holes: PGAShotHole[] = detail[`${playerId}:${round}`] ?? [];
  if (holes.length === 0) return [];

  const playedHoles = holes.filter((h) => {
    const s = Number(h.score);
    return Number.isFinite(s) && s > 0;
  });
  const byNumber = new Map(playedHoles.map((h) => [h.holeNumber, h]));
  const playedSet = new Set(byNumber.keys());

  const start = inferStartTee(playedSet, thruHint);
  const order = start === 10 ? BACK_TO_FRONT : FRONT_TO_BACK;

  const inPlayOrder = order
    .filter((n) => byNumber.has(n))
    .map((n) => byNumber.get(n)!);
  // Most-recent last in play order; take the tail then reverse for display.
  const recent = inPlayOrder.slice(-RECENT_LIMIT).reverse();

  return recent.map((h): RecentHole => {
    const score = Number(h.score);
    const result = resultFor(score, h.par);
    const { synopsis, emoji } = summarizeHole(h.strokes, h.par, score);
    return {
      round,
      holeNumber: h.holeNumber,
      par: h.par,
      score,
      result,
      synopsis,
      emoji,
    };
  });
}
