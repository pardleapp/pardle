/**
 * Unit tests for the pure projection function — headwind math,
 * pin cluster matching, and the model-live blend.
 */
import { describe, expect, it } from "vitest";
import {
  computeHeadwind,
  matchPinToCluster,
  projectHoleAvgToPar,
  TARGET_LIVE_SAMPLE,
} from "./project";
import type { HoleFit } from "./types";

function fixtureFit(overrides: Partial<HoleFit> = {}): HoleFit {
  return {
    bYards: 0.002,
    bHead: 0.02,
    intercept: -1.5,
    clusterResiduals: {
      A: 0.15,
      B: -0.05,
      C: -0.2,
    },
    clusterCentroids: {
      A: { x: 0.3, y: 0.3 },
      B: { x: 0.5, y: 0.5 },
      C: { x: 0.7, y: 0.7 },
    },
    histMeanYards: 420,
    histMeanHead: 5,
    histMeanAvgVsPar: -0.5,
    histMeanAvgVsParByRound: {},
    histMeanYardsByRound: {},
    histMeanHeadByRound: {},
    rowCount: 30,
    ...overrides,
  };
}

describe("computeHeadwind", () => {
  it("returns full wind when direction FROM matches bearing", () => {
    // Wind FROM 200°, hole plays TO 200° → pure headwind.
    expect(computeHeadwind(20, 200, 200)).toBeCloseTo(20, 6);
  });
  it("returns negative wind (tailwind) when direction opposite", () => {
    expect(computeHeadwind(20, 20, 200)).toBeCloseTo(-20, 6);
  });
  it("returns zero for pure crosswind", () => {
    // 90° offset
    expect(computeHeadwind(20, 110, 200)).toBeCloseTo(0, 6);
  });
});

describe("matchPinToCluster", () => {
  it("returns nearest cluster by centroid distance", () => {
    const fit = fixtureFit();
    const match = matchPinToCluster(fit, 0.29, 0.31);
    expect(match?.letter).toBe("A");
    expect(match!.distance).toBeLessThan(0.05);
  });
  it("returns null when there are no clusters", () => {
    const fit = fixtureFit({
      clusterCentroids: {},
      clusterResiduals: {},
    });
    expect(matchPinToCluster(fit, 0.5, 0.5)).toBeNull();
  });
});

describe("projectHoleAvgToPar", () => {
  it("model-only prediction: no live sample → equals raw model output", () => {
    const fit = fixtureFit();
    const bearing = 200;
    const proj = projectHoleAvgToPar({
      fit,
      bearing,
      conditions: {
        yards: 430, // +10 vs hist mean (420)
        windSpeed: 15,
        windDir: 200, // full headwind
        pinX: 0.3,
        pinY: 0.3, // cluster A
      },
    });
    // Expected:
    //   headwind = 15 (full)
    //   modelAvg = histMean + clusterRes + bHead × (15 - 5) + bYards × (430 - 420)
    //            = -0.5 + 0.15 + 0.02 × 10 + 0.002 × 10
    //            = -0.5 + 0.15 + 0.2 + 0.02
    //            = -0.13
    expect(proj.modelAvgVsPar).toBeCloseTo(-0.13, 4);
    expect(proj.avgVsPar).toBeCloseTo(-0.13, 4);
    expect(proj.liveWeight).toBe(0);
    expect(proj.matchedCluster).toBe("A");
  });

  it("small live sample: mostly model, some live", () => {
    const fit = fixtureFit();
    const proj = projectHoleAvgToPar({
      fit,
      bearing: 200,
      conditions: {
        yards: 420,
        windSpeed: 5,
        windDir: 200,
        pinX: 0.5,
        pinY: 0.5,
      },
      liveSample: { avgVsPar: 0.8, count: 3 },
    });
    // count=3 → weight = 3/30 = 0.1
    // model = histMean + clusterB residual (-0.05) + 0 + 0 = -0.55
    // blended = 0.1 × 0.8 + 0.9 × -0.55 = 0.08 - 0.495 = -0.415
    expect(proj.liveWeight).toBeCloseTo(0.1, 6);
    expect(proj.avgVsPar).toBeCloseTo(-0.415, 3);
    expect(proj.modelAvgVsPar).toBeCloseTo(-0.55, 4);
  });

  it("large live sample: fully anchored on observed", () => {
    const fit = fixtureFit();
    const proj = projectHoleAvgToPar({
      fit,
      bearing: 200,
      conditions: { yards: 420, windSpeed: 5, windDir: 200 },
      liveSample: { avgVsPar: 0.9, count: TARGET_LIVE_SAMPLE * 2 },
    });
    expect(proj.liveWeight).toBe(1);
    expect(proj.avgVsPar).toBeCloseTo(0.9, 6);
  });

  it("no pin coords → cluster residual = 0", () => {
    const fit = fixtureFit();
    const proj = projectHoleAvgToPar({
      fit,
      bearing: 200,
      conditions: { yards: 420, windSpeed: 5, windDir: 200 },
    });
    expect(proj.matchedCluster).toBeNull();
    expect(proj.modelAvgVsPar).toBeCloseTo(-0.5, 4);
  });

  it("uses round-specific baseline when available", () => {
    // R3 baseline is a stroke lower than the all-rounds baseline.
    const fit = fixtureFit({
      histMeanAvgVsPar: -0.5,
      histMeanAvgVsParByRound: { 3: -1.5 },
      histMeanHeadByRound: { 3: 5 },
      histMeanYardsByRound: { 3: 420 },
    });
    // Without roundNum: uses all-rounds baseline (-0.5).
    const allRounds = projectHoleAvgToPar({
      fit,
      bearing: 200,
      conditions: { yards: 420, windSpeed: 5, windDir: 200 },
    });
    expect(allRounds.modelAvgVsPar).toBeCloseTo(-0.5, 4);
    // With roundNum=3: uses R3 baseline (-1.5).
    const r3 = projectHoleAvgToPar({
      fit,
      bearing: 200,
      conditions: { yards: 420, windSpeed: 5, windDir: 200 },
      roundNum: 3,
    });
    expect(r3.modelAvgVsPar).toBeCloseTo(-1.5, 4);
  });

  it("applies level shift on top of model prediction", () => {
    const fit = fixtureFit();
    const shift = -0.3; // course playing 0.3 softer than model
    const proj = projectHoleAvgToPar({
      fit,
      bearing: 200,
      conditions: { yards: 420, windSpeed: 5, windDir: 200 },
      levelShift: shift,
    });
    // Base = histMean (-0.5) + 0 shifts + shift → -0.8
    expect(proj.modelAvgVsPar).toBeCloseTo(-0.8, 4);
  });

  it("falls back to all-rounds baseline when round-specific missing", () => {
    const fit = fixtureFit({
      histMeanAvgVsPar: -0.5,
      histMeanAvgVsParByRound: { 1: -0.2 }, // only R1 available
    });
    // Asking for R3 — no R3 baseline → falls back to -0.5.
    const proj = projectHoleAvgToPar({
      fit,
      bearing: 200,
      conditions: { yards: 420, windSpeed: 5, windDir: 200 },
      roundNum: 3,
    });
    expect(proj.modelAvgVsPar).toBeCloseTo(-0.5, 4);
  });
});
