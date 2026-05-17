/**
 * Monte Carlo top-finish model. Given each active player's
 * N(mean, variance) projection of their final 4-round score, simulate
 * `nSims` tournaments and count how often each player lands in the
 * top 5 / top 10 / top 20. Ties at the cutoff get fractional credit
 * (standard dead-heat counting), which means the probabilities we
 * emit are settlement-equivalent to what a dead-heat-rule book would
 * pay out on.
 *
 * Approach mirrors pga_model/src/simulation/live_model.py's
 * _count_outcomes — same algorithm, hand-translated to JS.
 *
 * Server-only.
 */

import "server-only";

export interface TopFinishProbs {
  top5: number;
  top10: number;
  top20: number;
}

interface MCPlayer {
  playerId: string;
  mean: number;
  sd: number;
}

/** Standard Box-Muller transform — one N(0,1) sample. */
function gaussian(): number {
  let u1 = 0;
  while (u1 === 0) u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function simulateTopFinish(
  projections: Record<
    string,
    { mean: number; variance: number; active: boolean }
  >,
  nSims: number = 5000,
): Record<string, TopFinishProbs> {
  const players: MCPlayer[] = [];
  for (const [pid, p] of Object.entries(projections)) {
    if (!p.active) continue;
    if (!Number.isFinite(p.mean) || !Number.isFinite(p.variance)) continue;
    players.push({
      playerId: pid,
      mean: p.mean,
      sd: Math.sqrt(Math.max(0.01, p.variance)),
    });
  }
  if (players.length === 0) return {};

  const n = players.length;
  const cnt5 = new Float64Array(n);
  const cnt10 = new Float64Array(n);
  const cnt20 = new Float64Array(n);
  const totals = new Float64Array(n);
  const CUTOFFS: [number, Float64Array][] = [
    [5, cnt5],
    [10, cnt10],
    [20, cnt20],
  ];

  for (let s = 0; s < nSims; s++) {
    // Draw a final-score sample for every active player.
    for (let i = 0; i < n; i++) {
      totals[i] = players[i].mean + gaussian() * players[i].sd;
    }

    // For each cutoff, count strict-inside + fractional-at-cutoff.
    // (Same dead-heat math the pga_model uses.)
    for (const [cutoff, counter] of CUTOFFS) {
      if (cutoff >= n) {
        // Field smaller than the cutoff — everyone counts as in.
        for (let i = 0; i < n; i++) counter[i] += 1;
        continue;
      }
      // Find the cutoff-th smallest total via partial sort (use a
      // simple O(n*k) selection — cutoff is at most 20 so this is
      // genuinely faster than a full sort over 150+ players).
      let cutoffVal = Infinity;
      // Quick partial-selection: copy and partition.
      const sorted = Array.from(totals).sort((a, b) => a - b);
      cutoffVal = sorted[cutoff - 1];

      let nStrictlyIn = 0;
      let nAtCutoff = 0;
      for (let i = 0; i < n; i++) {
        if (totals[i] < cutoffVal) nStrictlyIn++;
        else if (totals[i] === cutoffVal) nAtCutoff++;
      }
      const spotsLeft = Math.max(0, cutoff - nStrictlyIn);
      const fractionalCredit = nAtCutoff > 0 ? spotsLeft / nAtCutoff : 0;
      for (let i = 0; i < n; i++) {
        if (totals[i] < cutoffVal) counter[i] += 1;
        else if (totals[i] === cutoffVal) counter[i] += fractionalCredit;
      }
    }
  }

  const result: Record<string, TopFinishProbs> = {};
  for (let i = 0; i < n; i++) {
    result[players[i].playerId] = {
      top5: cnt5[i] / nSims,
      top10: cnt10[i] / nSims,
      top20: cnt20[i] / nSims,
    };
  }
  return result;
}
