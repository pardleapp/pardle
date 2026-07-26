/**
 * Unit tests for the per-player remaining-holes projection.
 * Exercises the tee-time-aware wind lookup and the skill delta
 * application without needing a real HRRR fetch.
 */
import { describe, expect, it } from "vitest";
import {
  projectRemainingForPlayer,
  remainingHoles,
} from "./per-player";
import type { ScoringModelCoefficients } from "./types";
import type { HourlyWind } from "./hrrr-hourly";

function fixtureCoeffs(): ScoringModelCoefficients {
  const holes: ScoringModelCoefficients["holes"] = {};
  for (let h = 1; h <= 18; h++) {
    holes[h] = {
      bYards: 0,
      bHead: 0.02,
      intercept: -0.4,
      clusterResiduals: { A: 0 },
      clusterCentroids: { A: { x: 0.5, y: 0.5 } },
      histMeanYards: 400,
      histMeanHead: 0,
      histMeanAvgVsPar: -0.4,
      histMeanAvgVsParByRound: {},
      histMeanYardsByRound: {},
      histMeanHeadByRound: {},
      historicalPins: [],
      rowCount: 20,
    };
  }
  return {
    tournamentId: "TEST",
    fittedAt: new Date().toISOString(),
    holes,
  };
}

describe("remainingHoles", () => {
  it("returns full 18 holes when thru=0", () => {
    expect(remainingHoles(1, 0)).toHaveLength(18);
    expect(remainingHoles(1, 0)[0]).toBe(1);
    expect(remainingHoles(1, 0)[17]).toBe(18);
  });

  it("handles back-nine starts with wraparound", () => {
    const rem = remainingHoles(10, 4);
    expect(rem).toHaveLength(14);
    // First remaining hole after playing 10, 11, 12, 13 is 14.
    expect(rem[0]).toBe(14);
    // Rotation wraps 18 → 1
    expect(rem).toContain(1);
    expect(rem).toContain(9);
  });

  it("returns empty when round is complete", () => {
    expect(remainingHoles(1, 18)).toHaveLength(0);
  });
});

describe("projectRemainingForPlayer", () => {
  it("applies per-hole skill delta correctly", () => {
    const coeffs = fixtureCoeffs();
    const bearings: Record<number, number> = {};
    const yards: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) {
      bearings[h] = 200;
      yards[h] = 400;
    }
    const proj = projectRemainingForPlayer({
      teeHourLocal: 8,
      startHole: 1,
      thruHoles: 0,
      sgTotal: 3.0, // 3 strokes better per round
      coefficients: coeffs,
      setup: {
        yardsByHole: yards,
        bearingsByHole: bearings,
      },
      hourlyWind: [], // empty — will use fallback
      fallbackWind: { windMph: 0, windDirDeg: 0 },
    });
    // Field expected per hole = intercept + histMean stuff → around -0.4 × 18 = -7.2
    // With sgTotal=3, skill delta = -3/18 per hole → -3 across 18 holes
    // Player expected = field - 3 = -10.2
    expect(proj.fieldExpectedRemainingToPar).toBeCloseTo(-7.2, 1);
    expect(proj.playerExpectedRemainingToPar).toBeCloseTo(-10.2, 1);
    expect(proj.details).toHaveLength(18);
  });

  it("uses HRRR hourly wind for each hole's time-of-play", () => {
    const coeffs = fixtureCoeffs();
    const bearings: Record<number, number> = {};
    const yards: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) {
      bearings[h] = 200;
      yards[h] = 400;
    }
    // Wind starts at 0 mph, builds to 20 mph by 2 PM
    const hourly: HourlyWind[] = [];
    for (let h = 8; h <= 14; h++) {
      hourly.push({
        hour: h,
        windMph: (h - 8) * (20 / 6),
        windDirDeg: 200, // full headwind
      });
    }
    const proj = projectRemainingForPlayer({
      teeHourLocal: 8,
      startHole: 1,
      thruHoles: 0,
      sgTotal: 0,
      coefficients: coeffs,
      setup: {
        yardsByHole: yards,
        bearingsByHole: bearings,
      },
      hourlyWind: hourly,
    });
    // Hole 1 played at 8:00 (wind 0), hole 18 played at ~12:15 (wind ~14 mph).
    // First hole avgVsPar ≈ -0.4 (no wind adjustment). Later holes bigger
    // because wind is bigger. So the last hole's avgVsPar should be
    // meaningfully higher than the first.
    const first = proj.details[0].avgVsPar;
    const last = proj.details[proj.details.length - 1].avgVsPar;
    expect(last).toBeGreaterThan(first);
    // Wind at first hole should be tiny; wind at last hole should be bigger.
    expect(proj.details[0].wind.windMph).toBeCloseTo(0, 1);
    expect(proj.details[proj.details.length - 1].wind.windMph).toBeGreaterThan(
      10,
    );
  });
});
