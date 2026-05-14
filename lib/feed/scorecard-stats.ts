/**
 * Derive "basic stats" for a player from their PGA Tour scorecard —
 * no second data source, no id-mapping headache. Everything here is
 * computed from the per-hole scores the orchestrator already gives us.
 */

import type { PGAScorecard, PGAHoleScore } from "@/lib/golf-api/pgatour";
import { type ScoreResult, resultFor } from "./types";

export interface RoundSummary {
  round: number;
  /** Total strokes for the round; null if no holes scored yet. */
  strokes: number | null;
  toPar: number | null;
  holesPlayed: number;
  birdies: number;
  eagles: number; // includes albatross
  bogeys: number;
  doubles: number; // double or worse
}

export interface PlayerStats {
  rounds: RoundSummary[];
  totalBirdies: number;
  totalEagles: number;
  totalBogeys: number;
  totalDoubles: number;
  /** Lowest completed-round strokes, or null if no full round yet. */
  bestRound: number | null;
  /** Mean strokes over completed rounds, or null. */
  scoringAvg: number | null;
}

function isUnplayed(score: string): boolean {
  return score === "" || score === "-" || score == null;
}

function summariseRound(round: number, holes: PGAHoleScore[]): RoundSummary {
  let strokes = 0;
  let par = 0;
  let holesPlayed = 0;
  let birdies = 0;
  let eagles = 0;
  let bogeys = 0;
  let doubles = 0;

  for (const h of holes) {
    if (isUnplayed(h.score)) continue;
    const s = Number(h.score);
    if (!Number.isFinite(s) || s <= 0) continue;
    holesPlayed++;
    strokes += s;
    par += h.par;
    const r: ScoreResult = resultFor(s, h.par);
    if (r === "birdie") birdies++;
    else if (r === "eagle" || r === "albatross") eagles++;
    else if (r === "bogey") bogeys++;
    else if (r === "double" || r === "triple-plus") doubles++;
  }

  return {
    round,
    strokes: holesPlayed > 0 ? strokes : null,
    toPar: holesPlayed > 0 ? strokes - par : null,
    holesPlayed,
    birdies,
    eagles,
    bogeys,
    doubles,
  };
}

export function derivePlayerStats(scorecard: PGAScorecard): PlayerStats {
  const rounds: RoundSummary[] = [];
  for (let r = 1; r <= 4; r++) {
    const holes = scorecard.rounds[r];
    if (!holes || holes.length === 0) continue;
    rounds.push(summariseRound(r, holes));
  }

  const totalBirdies = rounds.reduce((a, r) => a + r.birdies, 0);
  const totalEagles = rounds.reduce((a, r) => a + r.eagles, 0);
  const totalBogeys = rounds.reduce((a, r) => a + r.bogeys, 0);
  const totalDoubles = rounds.reduce((a, r) => a + r.doubles, 0);

  // A "completed" round = all 18 holes scored.
  const completed = rounds.filter((r) => r.holesPlayed === 18);
  const bestRound =
    completed.length > 0
      ? Math.min(...completed.map((r) => r.strokes ?? Infinity))
      : null;
  const scoringAvg =
    completed.length > 0
      ? completed.reduce((a, r) => a + (r.strokes ?? 0), 0) / completed.length
      : null;

  return {
    rounds,
    totalBirdies,
    totalEagles,
    totalBogeys,
    totalDoubles,
    bestRound,
    scoringAvg,
  };
}
