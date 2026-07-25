/**
 * Unit tests for the per-hole WLS fit and cluster residual assembly.
 * These are the load-bearing pure functions of the scoring model —
 * every projection eventually flows through them.
 */
import { describe, expect, it } from "vitest";
import { fitPerHole, assembleHoleFit } from "./coefficients";
import type { FitRow } from "./types";

describe("fitPerHole", () => {
  it("returns null when there are fewer than 6 rows", () => {
    const rows: FitRow[] = Array.from({ length: 5 }, () => ({
      clusterIdx: 0,
      yards: 400,
      headwind: 0,
      avgVsPar: 0.1,
      total: 100,
    }));
    expect(fitPerHole(rows)).toBeNull();
  });

  it("recovers coefficients from a synthetic linear system", () => {
    // Ground truth: avgVsPar = 0.002 × yards + 0.02 × headwind + (-0.85)
    const yardsList = [380, 400, 420, 440, 460, 380, 420, 460];
    const headList = [-10, -5, 0, 5, 10, 8, -3, 12];
    const rows: FitRow[] = yardsList.map((y, i) => ({
      clusterIdx: 0,
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
      { clusterIdx: 0, yards: 400, headwind: 0, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, yards: 400, headwind: 0, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, yards: 400, headwind: 0, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, yards: 401, headwind: 1, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, yards: 402, headwind: 2, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, yards: 403, headwind: 3, avgVsPar: -1.0, total: 10 },
      { clusterIdx: 0, yards: 400, headwind: 0, avgVsPar: 0.5, total: 1000 },
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
        clusterIdx: 0,
        yards: yardsList[i],
        headwind: headList[i],
        avgVsPar: 0.2,
        total: 100,
      });
    }
    // 8 B pins around avgVsPar = -0.3
    for (let i = 0; i < 8; i++) {
      rows.push({
        clusterIdx: 1,
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
      clusterIdx: 0,
      yards: 400,
      headwind: 0,
      avgVsPar: 0,
      total: 100,
    }));
    expect(assembleHoleFit(rows, {})).toBeNull();
  });
});
