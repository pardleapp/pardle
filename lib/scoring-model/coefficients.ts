/**
 * Per-hole weighted-least-squares regression on field-average
 * strokes-vs-par. Fits:
 *
 *   avgVsPar = b_yards × yards + b_head × headwind + intercept
 *
 * Each row = one (pin position, historical round) instance, weighted
 * by sqrt(sample_size) so pins with 100+ player rounds behind them
 * dominate the fit. Cluster residuals = the weighted mean residual
 * across the pins in each cluster (the intrinsic pin-position
 * difficulty after wind + yardage have been accounted for).
 *
 * Pure function — takes fit rows in, returns coefficients out.
 * Server-only wiring (loading historical files, calling this) lives
 * in loader.ts.
 */

import type { FitRow, HoleFit } from "./types";

/** Weighted-least-squares fit for the design matrix [yards, head, 1]
 *  → avgVsPar. Solves via normal equations on the 3×3 Gram matrix.
 *  Returns null when the row count is too low or the matrix is
 *  singular. */
export function fitPerHole(
  rows: FitRow[],
): { bYards: number; bHead: number; intercept: number } | null {
  if (rows.length < 6) return null;
  const w = rows.map((r) => Math.sqrt(Math.max(1, r.total)));
  let s11 = 0, s12 = 0, s13 = 0;
  let s22 = 0, s23 = 0;
  let s33 = 0;
  let bx1 = 0, bx2 = 0, bx3 = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const wi = w[i];
    const x1 = r.yards * wi;
    const x2 = r.headwind * wi;
    const x3 = wi;
    const yv = r.avgVsPar * wi;
    s11 += x1 * x1;
    s12 += x1 * x2;
    s13 += x1 * x3;
    s22 += x2 * x2;
    s23 += x2 * x3;
    s33 += x3 * x3;
    bx1 += x1 * yv;
    bx2 += x2 * yv;
    bx3 += x3 * yv;
  }
  const det =
    s11 * (s22 * s33 - s23 * s23) -
    s12 * (s12 * s33 - s23 * s13) +
    s13 * (s12 * s23 - s22 * s13);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const i11 = (s22 * s33 - s23 * s23) / det;
  const i12 = -(s12 * s33 - s23 * s13) / det;
  const i13 = (s12 * s23 - s22 * s13) / det;
  const i22 = (s11 * s33 - s13 * s13) / det;
  const i23 = -(s11 * s23 - s13 * s12) / det;
  const i33 = (s11 * s22 - s12 * s12) / det;
  return {
    bYards: i11 * bx1 + i12 * bx2 + i13 * bx3,
    bHead: i12 * bx1 + i22 * bx2 + i23 * bx3,
    intercept: i13 * bx1 + i23 * bx2 + i33 * bx3,
  };
}

/** Given a fit + the fit rows + centroid coords per cluster, return
 *  a complete HoleFit including cluster residuals and baseline stats.
 *  Returns null if the underlying fit was too degenerate. */
export function assembleHoleFit(
  rows: FitRow[],
  clusterCentroids: Record<string, { x: number; y: number }>,
): HoleFit | null {
  const fit = fitPerHole(rows);
  if (!fit) return null;

  // Weighted mean residual per cluster + per-round baselines.
  const clusterAgg: Record<string, { w: number; s: number }> = {};
  const perRoundAgg: Record<
    number,
    { w: number; sAvg: number; sHead: number; sYds: number; rows: number }
  > = {};
  let totalW = 0;
  let totalSum = 0;
  let totalHead = 0;
  let totalYds = 0;
  for (const r of rows) {
    const pred = fit.bYards * r.yards + fit.bHead * r.headwind + fit.intercept;
    const res = r.avgVsPar - pred;
    const letter = String.fromCharCode(65 + r.clusterIdx);
    (clusterAgg[letter] ??= { w: 0, s: 0 });
    clusterAgg[letter].w += r.total;
    clusterAgg[letter].s += res * r.total;
    (perRoundAgg[r.round] ??= { w: 0, sAvg: 0, sHead: 0, sYds: 0, rows: 0 });
    const pra = perRoundAgg[r.round];
    pra.w += r.total;
    pra.sAvg += r.avgVsPar * r.total;
    pra.sHead += r.headwind * r.total;
    pra.sYds += r.yards * r.total;
    pra.rows += 1;
    totalW += r.total;
    totalSum += r.avgVsPar * r.total;
    totalHead += r.headwind * r.total;
    totalYds += r.yards * r.total;
  }
  const clusterResiduals: Record<string, number> = {};
  for (const [letter, a] of Object.entries(clusterAgg)) {
    clusterResiduals[letter] = a.s / a.w;
  }
  const histMeanAvgVsParByRound: Partial<Record<1 | 2 | 3 | 4, number>> = {};
  const histMeanYardsByRound: Partial<Record<1 | 2 | 3 | 4, number>> = {};
  const histMeanHeadByRound: Partial<Record<1 | 2 | 3 | 4, number>> = {};
  for (const [rStr, a] of Object.entries(perRoundAgg)) {
    // Skip rounds with too few rows — the mean would be too noisy.
    if (a.rows < 3) continue;
    const r = Number(rStr) as 1 | 2 | 3 | 4;
    histMeanAvgVsParByRound[r] = a.sAvg / a.w;
    histMeanYardsByRound[r] = a.sYds / a.w;
    histMeanHeadByRound[r] = a.sHead / a.w;
  }
  // Per-pin historical residuals. For each row (a single pin
  // instance in a specific round), compute:
  //   residualToBase = avgVsPar
  //                    − (roundBaseline + b_yards × (yards − roundYardsMean)
  //                       + b_head × (head − roundHeadMean))
  // The result isolates PIN POSITION difficulty from yardage and
  // wind. Callers doing nearest-neighbour lookups (e.g. the level-
  // shift calc) can weight by `total` and average across nearby
  // historical pins to get a pin-specific expected residual.
  const historicalPins: HoleFit["historicalPins"] = [];
  for (const r of rows) {
    if (typeof r.pinX !== "number" || typeof r.pinY !== "number") continue;
    const roundBase =
      perRoundAgg[r.round]?.rows && perRoundAgg[r.round]!.rows >= 3
        ? perRoundAgg[r.round]!.sAvg / perRoundAgg[r.round]!.w
        : totalSum / totalW;
    const roundYardsMean =
      perRoundAgg[r.round]?.rows && perRoundAgg[r.round]!.rows >= 3
        ? perRoundAgg[r.round]!.sYds / perRoundAgg[r.round]!.w
        : totalYds / totalW;
    const roundHeadMean =
      perRoundAgg[r.round]?.rows && perRoundAgg[r.round]!.rows >= 3
        ? perRoundAgg[r.round]!.sHead / perRoundAgg[r.round]!.w
        : totalHead / totalW;
    const yardsAdj = fit.bYards * (r.yards - roundYardsMean);
    const headAdj = fit.bHead * (r.headwind - roundHeadMean);
    const residualToBase =
      r.avgVsPar - (roundBase + yardsAdj + headAdj);
    historicalPins.push({
      x: r.pinX,
      y: r.pinY,
      round: r.round,
      avgVsPar: r.avgVsPar,
      residualToBase,
      total: r.total,
    });
  }

  return {
    bYards: fit.bYards,
    bHead: fit.bHead,
    intercept: fit.intercept,
    clusterResiduals,
    clusterCentroids,
    histMeanYards: totalYds / totalW,
    histMeanHead: totalHead / totalW,
    histMeanAvgVsPar: totalSum / totalW,
    histMeanAvgVsParByRound,
    histMeanYardsByRound,
    histMeanHeadByRound,
    historicalPins,
    rowCount: rows.length,
  };
}
