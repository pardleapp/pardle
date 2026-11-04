/**
 * Unit tests for the per-hole WLS fit and cluster residual assembly.
 * These are the load-bearing pure functions of the scoring model —
 * every projection eventually flows through them.
 */
import { describe, expect, it } from "vitest";
import { fitPerHole, assembleHoleFit, pooledHeadSlope } from "./coefficients";
import type { FitRow } from "./types";

describe("pooledHeadSlope", () => {
  it("recovers wind and ignores days that scored low everywhere", () => {
    // Two holes playing opposite ways, four days with big day effects.
    const days = [{ d: "a", w: 10, e: -1 }, { d: "b", w: -8, e: 0.8 }, { d: "c", w: 4, e: 0.3 }, { d: "e", w: -2, e: -0.4 }];
    const rows = days.flatMap(({ d, w, e }) => [
      { hole: 1, day: d, headwind: w, avgVsPar: 0.1 + e + 0.02 * w },
      { hole: 2, day: d, headwind: -w, avgVsPar: -0.2 + e - 0.02 * w },
    ]);
    expect(pooledHeadSlope(rows)).toBeCloseTo(0.02, 6);
  });

  it("never returns a negative slope", () => {
    const rows = [1, -1, 2, -2].flatMap((w, i) => [
      { hole: 1, day: String(i), headwind: w, avgVsPar: -0.05 * w },
      { hole: 2, day: String(i), headwind: -w, avgVsPar: 0.05 * w },
    ]);
    expect(pooledHeadSlope(rows)).toBe(0);
  });
});

describe("fitPerHole", () => {
  it("returns null when there are fewer than 6 rows", () => {
    const rows: FitRow[] = Array.from({ length: 5 }, () => ({
      clusterIdx: 0, round: 1,
      yards: 400,
      headwind: 0,
      avgVsPar: 0.1,
      total: 100,
    }));
    expect(fitPerHole(rows)).toBeNull();
  });

  it("falls back to the hole mean when every round has the same yardage", () => {
    const rows: FitRow[] = [0.11, 0.21, -0.07, 0.3, 0.02, 0.16, 0.09, 0.25].map((avgVsPar, i) => ({
      clusterIdx: 0, round: (i % 4) + 1,
      yards: 462.37,
      headwind: 0,
      avgVsPar,
      total: 90 + i * 7,
    }));
    expect(fitPerHole(rows)).toBeNull();
    const fit = assembleHoleFit(rows, {});
    expect(fit).not.toBeNull();
    expect(fit!.bYards).toBe(0);
    expect(fit!.bHead).toBe(0);
    expect(fit!.clusterResiduals.A).toBe(0);
  });

  it("fits wind alone when yardage is constant but headwind varies", () => {
    const rows: FitRow[] = [-8, -4, 0, 3, 6, 10].map((headwind) => ({
      clusterIdx: 0, round: 1,
      yards: 462,
      headwind,
      avgVsPar: 0.1 + 0.02 * headwind,
      total: 100,
    }));
    const fit = fitPerHole(rows);
    expect(fit!.bYards).toBe(0);
    expect(fit!.bHead).toBeCloseTo(0.02, 6);
    expect(fit!.intercept).toBeCloseTo(0.1, 6);
  });

  it("recovers coefficients from a synthetic linear system", () => {
    // Ground truth: avgVsPar = 0.002 × yards + 0.02 × headwind + (-0.85)
    const yardsList = [380, 400, 420, 440, 460, 380, 420, 460];
    const headList = [-10, -5, 0, 5, 10, 8, -3, 12];
    const rows: FitRow[] = yardsList.map((y, i) => ({
      clusterIdx: 0, round: 1,
      yards: y,
      headwind: headList[i],
      avgVsPar: 0.002 * y + 0.02 * headList[i] - 0.85,
      total: 100,
    }));
    const fit = fitPerHole(rows);
    expect(fit).not.toBeNull();
    expect(fit!.bYards).toBeCloseTo(0.002, 5);
    expect(fit!.bHead).toBeCloseTo(0.02, 5);
    expect(fit!.intercept).toBeCloseTo(-0.85, 4);
  });

  it("weights heavier-sampled rows more strongly", () => {
    // Two clusters of rows around different avgVsPar values. The
    // heavy-weight row should pull the intercept toward its value.
    const rows: FitRow[] = [
      { clusterIdx: 0, round: 1, yards: 400, headwind: 0, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, round: 1, yards: 400, headwind: 0, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, round: 1, yards: 400, headwind: 0, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, round: 1, yards: 401, headwind: 1, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, round: 1, yards: 402, headwind: 2, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, round: 1, yards: 403, headwind: 3, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, round: 1, yards: 400, headwind: 0, avgVsPar: 0.5, total: 1000 },
    ];
    const fit = fitPerHole(rows);
    expect(fit).not.toBeNull();
    // Heavy-weight (total=1000) row at avgVsPar=0.5 dominates over
    // the six light-weight (total=10) rows at avgVsPar=-1.0.
    const pred = fit!.bYards * 400 + fit!.bHead * 0 + fit!.intercept;
    expect(pred).toBeGreaterThan(0);
  });
});

describe("assembleHoleFit", () => {
  it("computes weighted mean cluster residuals", () => {
    // Two clusters, distinct residual patterns. yards + headwind
    // decoupled to keep the design matrix full-rank.
    const rows: FitRow[] = [];
    const yardsList = [380, 400, 420, 440, 380, 400, 420, 440];
    const headList = [-10, -5, 0, 5, 8, 3, -2, -6];
    // 8 A pins around avgVsPar = +0.2
    for (let i = 0; i < 8; i++) {
      rows.push({
        clusterIdx: 0, round: 1,
        yards: yardsList[i],
        headwind: headList[i],
        avgVsPar: 0.2,
        total: 100,
      });
    }
    // 8 B pins around avgVsPar = -0.3
    for (let i = 0; i < 8; i++) {
      rows.push({
        clusterIdx: 1, round: 1,
        yards: yardsList[i],
        headwind: headList[i],
        avgVsPar: -0.3,
        total: 100,
      });
    }
    const centroids = {
      A: { x: 0.3, y: 0.3 },
      B: { x: 0.7, y: 0.7 },
    };
    const fit = assembleHoleFit(rows, centroids);
    expect(fit).not.toBeNull();
    // Cluster A residual should be positive, B negative.
    expect(fit!.clusterResiduals.A).toBeGreaterThan(0);
    expect(fit!.clusterResiduals.B).toBeLessThan(0);
    // The centroids and rowCount survive.
    expect(fit!.clusterCentroids.A).toEqual({ x: 0.3, y: 0.3 });
    expect(fit!.clusterCentroids.B).toEqual({ x: 0.7, y: 0.7 });
    expect(fit!.rowCount).toBe(16);
    // Historical means are computed from the fit rows (all weight 100).
    expect(fit!.histMeanAvgVsPar).toBeCloseTo(-0.05, 4);
  });

  it("returns null when fit is too degenerate", () => {
    const rows: FitRow[] = Array.from({ length: 3 }, () => ({
      clusterIdx: 0, round: 1,
      yards: 400,
      headwind: 0,
      avgVsPar: 0,
      total: 100,
    }));
    expect(assembleHoleFit(rows, {})).toBeNull();
  });

  it("falls back to the weighted hole mean for a single past edition", () => {
    // One pin per round, 4 rounds: too few rows for the regression.
    const rows: FitRow[] = [1, 2, 3, 4].map((round, i) => ({
      clusterIdx: i, round,
      yards: 400 + i * 10, headwind: i - 2,
      avgVsPar: [0.2, 0.0, 0.1, 0.3][i], total: i === 3 ? 200 : 100,
    }));
    const fit = assembleHoleFit(rows, {});
    expect(fit).not.toBeNull();
    expect(fit!.bYards).toBe(0);
    expect(fit!.bHead).toBe(0);
    // (0.2 + 0.0 + 0.1) × 100 + 0.3 × 200 over 500 total weight
    expect(fit!.histMeanAvgVsPar).toBeCloseTo(0.18, 6);
    for (const v of Object.values(fit!.clusterResiduals)) expect(v).toBe(0);
    expect(fit!.historicalPins).toEqual([]);
  });

  it("computes per-round baselines when rounds have ≥3 rows", () => {
    // Mix of R1 and R3 rows with distinct avg-vs-par means.
    const yardsList = [380, 400, 420, 440, 380, 400, 420, 440];
    const headList = [-10, -5, 0, 5, 8, 3, -2, -6];
    const rows: FitRow[] = [];
    // 4 R1 rows at avgVsPar = 0.0
    for (let i = 0; i < 4; i++) {
      rows.push({
        clusterIdx: 0, round: 1,
        yards: yardsList[i], headwind: headList[i],
        avgVsPar: 0.0, total: 100,
      });
    }
    // 4 R3 rows at avgVsPar = -0.5 (R3 plays softer)
    for (let i = 4; i < 8; i++) {
      rows.push({
        clusterIdx: 0, round: 3,
        yards: yardsList[i], headwind: headList[i],
        avgVsPar: -0.5, total: 100,
      });
    }
    const fit = assembleHoleFit(rows, { A: { x: 0.5, y: 0.5 } });
    expect(fit).not.toBeNull();
    // R1 baseline is near 0.0 (weighted mean of the 4 R1 rows).
    expect(fit!.histMeanAvgVsParByRound[1]).toBeCloseTo(0.0, 2);
    // R3 baseline is near -0.5 (weighted mean of the 4 R3 rows).
    expect(fit!.histMeanAvgVsParByRound[3]).toBeCloseTo(-0.5, 2);
    // R2/R4 have no rows so are undefined.
    expect(fit!.histMeanAvgVsParByRound[2]).toBeUndefined();
    expect(fit!.histMeanAvgVsParByRound[4]).toBeUndefined();
  });
});
