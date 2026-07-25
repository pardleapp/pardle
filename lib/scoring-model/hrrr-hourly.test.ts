/**
 * Unit tests for HRRR hourly wind interpolation. The fetch path is
 * network-bound and mocked out — we only exercise the pure
 * `windAtHour` interpolation here.
 */
import { describe, expect, it } from "vitest";
import { windAtHour, type HourlyWind } from "./hrrr-hourly";

const series: HourlyWind[] = [
  { hour: 8, windMph: 10, windDirDeg: 200 },
  { hour: 9, windMph: 12, windDirDeg: 200 },
  { hour: 10, windMph: 14, windDirDeg: 200 },
  { hour: 11, windMph: 16, windDirDeg: 200 },
  { hour: 12, windMph: 18, windDirDeg: 200 },
];

describe("windAtHour", () => {
  it("returns exact value when hour is on grid", () => {
    const w = windAtHour(series, 10);
    expect(w).not.toBeNull();
    expect(w!.windMph).toBeCloseTo(14, 4);
    expect(w!.windDirDeg).toBeCloseTo(200, 4);
  });

  it("interpolates between adjacent hours", () => {
    const w = windAtHour(series, 10.5);
    expect(w).not.toBeNull();
    // Linear interp: speed at 10.5 = midpoint of 14 and 16 = 15
    expect(w!.windMph).toBeCloseTo(15, 4);
    // Same direction on both sides → direction stays at 200°.
    expect(w!.windDirDeg).toBeCloseTo(200, 4);
  });

  it("returns null on empty series", () => {
    expect(windAtHour([], 12)).toBeNull();
  });

  it("clamps out-of-range target hour to available bounds", () => {
    // Before first hour → uses hour 8's value
    const w = windAtHour(series, 5);
    expect(w).not.toBeNull();
    expect(w!.windMph).toBeCloseTo(10, 4);
  });
});
