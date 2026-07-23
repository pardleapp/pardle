/**
 * Per-hole expected score-to-par with a live-first fallback chain.
 *
 * Callers (tee-time-scoring, round-score bet projection) want to know:
 * "what score does the field expect on hole H right now?" — so their
 * remaining-holes projection for a player mid-round can lean on
 * course-specific reality instead of assuming every remaining hole
 * plays like par.
 *
 * Fallback chain per hole, in order:
 *
 *   1. Current round of THIS tournament — only if ≥ MIN_PLAYERS have
 *      completed the hole. That's a live, course-conditions-aware
 *      signal (pin location, wind that day, tee length that day).
 *
 *   2. Previous round of this tournament — same course, different day,
 *      still the closest real-world signal for how the hole plays.
 *
 *   3. Previous year's average for the same hole — only reached when
 *      we're in R1 with < MIN_PLAYERS finished; captures the hole's
 *      long-run difficulty when we have nothing better.
 *
 *   4. Hole par (returns 0 score-to-par). Last-resort fallback so the
 *      shape of the return is always defined for all 18 holes.
 *
 * This module is pure — it takes the sampled scores in and returns
 * the averages out. The server-side loader (which reads Pardle's
 * snapshot and the historical JSON files on disk) lives in
 * lib/hole-averages-loader.ts.
 */

/** Minimum player count on a hole before its running average is
 *  considered reliable enough to prefer over the prior-round fallback.
 *  Per user spec: 15. */
export const MIN_PLAYERS_FOR_LIVE_AVG = 15;

/** Per-hole score samples for one round of a tournament, keyed by hole
 *  number (1-18). Each entry is the array of raw strokes players have
 *  posted on that hole so far. */
export type HoleScoreSamples = Record<number, number[]>;

/** Per-hole strokes-to-par lookup. Value = expected strokes above par
 *  (positive → hole plays over par, negative → hole gives up birdies).
 *  Always populated for holes 1..18. */
export type HoleAverages = Record<number, number>;

export type HoleAvgSource =
  | "current-round"
  | "prev-round"
  | "prev-year"
  | "par";

/** Per-hole diagnostic — which source the average came from and how
 *  many samples backed it. Exposed for the API response so callers can
 *  surface "R2 · 42 players" style tooltips. */
export type HoleAverageDiag = {
  toPar: number;
  source: HoleAvgSource;
  sampleCount: number;
};

export interface ComputeInputs {
  /** Per-hole samples from the current round (this tournament, this
   *  round). Live. */
  currentRound: HoleScoreSamples;
  /** Per-hole samples from the immediately previous round of THIS
   *  tournament. `null` when we're in R1 (no prior round exists yet).
   *  Should be the fully completed round's data. */
  prevRound: HoleScoreSamples | null;
  /** Per-hole samples from the previous year's edition of this event,
   *  merged across all four rounds. `null` when we have no prior-year
   *  cache. Rarely reached — only kicks in for R1 holes with < MIN
   *  players finished. */
  prevYear: HoleScoreSamples | null;
  /** Per-hole par lookup. Required so we can convert averages to
   *  score-to-par consistently. */
  holePars: Record<number, number>;
}

function meanOf(samples: number[] | undefined): number | null {
  if (!samples || samples.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const v of samples) {
    if (!Number.isFinite(v) || v <= 0) continue;
    sum += v;
    n += 1;
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * Return per-hole score-to-par averages with the fallback chain
 * applied. Also returns per-hole diagnostics so the caller can surface
 * "which source drove this hole's estimate" in the API response.
 */
export function computeHoleAverages(
  inputs: ComputeInputs,
): { averages: HoleAverages; diag: Record<number, HoleAverageDiag> } {
  const { currentRound, prevRound, prevYear, holePars } = inputs;
  const averages: HoleAverages = {};
  const diag: Record<number, HoleAverageDiag> = {};

  for (let h = 1; h <= 18; h++) {
    const par = holePars[h];
    const curSamples = currentRound[h] ?? [];
    const curCount = curSamples.filter(
      (v) => Number.isFinite(v) && v > 0,
    ).length;

    // 1. Current round — only if we have enough samples.
    if (curCount >= MIN_PLAYERS_FOR_LIVE_AVG) {
      const mean = meanOf(curSamples);
      if (mean != null && typeof par === "number") {
        averages[h] = mean - par;
        diag[h] = {
          toPar: averages[h],
          source: "current-round",
          sampleCount: curCount,
        };
        continue;
      }
    }

    // 2. Previous round of this tournament.
    if (prevRound) {
      const prevSamples = prevRound[h] ?? [];
      const prevCount = prevSamples.filter(
        (v) => Number.isFinite(v) && v > 0,
      ).length;
      if (prevCount > 0) {
        const mean = meanOf(prevSamples);
        if (mean != null && typeof par === "number") {
          averages[h] = mean - par;
          diag[h] = {
            toPar: averages[h],
            source: "prev-round",
            sampleCount: prevCount,
          };
          continue;
        }
      }
    }

    // 3. Previous year's data for the same hole.
    if (prevYear) {
      const pySamples = prevYear[h] ?? [];
      const pyCount = pySamples.filter(
        (v) => Number.isFinite(v) && v > 0,
      ).length;
      if (pyCount > 0) {
        const mean = meanOf(pySamples);
        if (mean != null && typeof par === "number") {
          averages[h] = mean - par;
          diag[h] = {
            toPar: averages[h],
            source: "prev-year",
            sampleCount: pyCount,
          };
          continue;
        }
      }
    }

    // 4. Last-resort: par (0 score-to-par).
    averages[h] = 0;
    diag[h] = { toPar: 0, source: "par", sampleCount: 0 };
  }

  return { averages, diag };
}

/**
 * Which holes does a player have left, given their starting hole and
 * how many holes they've completed? Handles back-nine starts.
 *
 * A player who started on hole 10 and is thru 4 has played holes
 * 10-13 and has 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9
 * remaining (14 holes). Rotation wraps from 18 to 1.
 */
export function remainingHoles(
  startHole: number,
  thruHoles: number,
): number[] {
  const start = Math.max(1, Math.min(18, Math.floor(startHole)));
  const thru = Math.max(0, Math.min(18, Math.floor(thruHoles)));
  const remaining: number[] = [];
  const total = 18 - thru;
  for (let i = 0; i < total; i++) {
    const offset = thru + i; // holes into the round
    const h = ((start - 1 + offset) % 18) + 1;
    remaining.push(h);
  }
  return remaining;
}

/**
 * Sum of expected score-to-par across a player's remaining holes.
 * Multiply the field-anchored per-hole averages up, so the caller can
 * then layer on the player's skill delta ((holesRemaining × −sgTotal/18)).
 */
export function sumRemainingToPar(
  averages: HoleAverages,
  remaining: number[],
): number {
  let sum = 0;
  for (const h of remaining) {
    const v = averages[h];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}
