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

export async function getRecentHoles(
  tournamentId: string,
  playerId: string,
  scorecard: PGAScorecard | undefined,
): Promise<RecentHole[]> {
  if (!scorecard) return [];
  const round = latestPlayedRound(scorecard);
  if (round === null) return [];

  const detail = await getShotDetailsBatch(tournamentId, [
    { playerId, round },
  ]);
  const holes: PGAShotHole[] = detail[`${playerId}:${round}`] ?? [];
  if (holes.length === 0) return [];

  const played = holes
    .filter((h) => {
      const s = Number(h.score);
      return Number.isFinite(s) && s > 0;
    })
    .sort((a, b) => b.holeNumber - a.holeNumber)
    .slice(0, RECENT_LIMIT);

  return played.map((h): RecentHole => {
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
