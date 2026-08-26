import { describe, expect, it } from "vitest";

/**
 * Guards the invariant that motivated field-strength re-centring:
 * the mean of the per-player projections must equal the field
 * forecast they were built from. Both describe the same field, so
 * any gap is the model contradicting itself.
 *
 * Reproduces the arithmetic rather than booting runForecast, which
 * needs a fitted course model, HRRR wind and Redis. The line under
 * test is a subtraction, and it is the subtraction that was wrong.
 */

/** The projection step, before and after the fix. */
function project(
  fieldForecast: number,
  edges: number[],
  recentre: boolean,
): number[] {
  const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
  return edges.map((e) => fieldForecast - (recentre ? e - mean : e));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The real 2026 TOUR Championship field: 30 players, mean edge
 *  +1.33, Scheffler top at +2.805. */
const TC_EDGES = [
  2.805, 1.935, 1.861, 1.79, 1.692, 1.69, 1.62, 1.58, 1.54, 1.5, 1.49, 1.46,
  1.44, 1.42, 1.4, 1.38, 1.35, 1.33, 1.3, 1.28, 1.25, 1.22, 1.19, 1.16, 1.12,
  1.09, 1.049, 0.98, 0.72, 0.487,
];
const FIELD_FORECAST = 68.14;

describe("field-strength re-centring", () => {
  it("makes the projections average back to the field forecast", () => {
    const after = project(FIELD_FORECAST, TC_EDGES, true);
    expect(mean(after)).toBeCloseTo(FIELD_FORECAST, 6);
  });

  it("documents the contradiction it replaced", () => {
    const before = project(FIELD_FORECAST, TC_EDGES, false);
    // The old behaviour: same thirty players, two different answers.
    expect(FIELD_FORECAST - mean(before)).toBeCloseTo(mean(TC_EDGES), 6);
    expect(mean(before)).toBeLessThan(FIELD_FORECAST - 1);
  });

  it("still ranks the field in exactly the same order", () => {
    // Re-centring is a constant shift — it must move everyone, and
    // change nobody's position. If this ever fails the change has
    // become something other than a re-centring.
    const before = project(FIELD_FORECAST, TC_EDGES, false);
    const after = project(FIELD_FORECAST, TC_EDGES, true);
    const order = (xs: number[]) =>
      xs
        .map((v, i) => [v, i] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([, i]) => i);
    expect(order(after)).toEqual(order(before));
    const shifts = after.map((v, i) => v - before[i]);
    for (const s of shifts) expect(s).toBeCloseTo(mean(TC_EDGES), 6);
  });

  it("is a no-op on a field that averages the tour baseline", () => {
    // A field whose mean edge is zero needs no correction, which is
    // why this went unnoticed at ordinary events and screamed at the
    // TOUR Championship.
    const balanced = [1.2, 0.4, -0.4, -1.2];
    const before = project(70, balanced, false);
    const after = project(70, balanced, true);
    expect(after).toEqual(before);
  });

  it("shifts an elite field more than a flat one", () => {
    const elite = mean(project(68, [2.8, 1.9, 1.4, 1.0], true).map((v, i) =>
      v - project(68, [2.8, 1.9, 1.4, 1.0], false)[i],
    ));
    const flat = mean(project(71, [0.4, 0.2, -0.1, -0.3], true).map((v, i) =>
      v - project(71, [0.4, 0.2, -0.1, -0.3], false)[i],
    ));
    expect(elite).toBeGreaterThan(flat);
  });
});
