import { describe, expect, it } from "vitest";
import { ols2, fitAdjustmentFor, type CourseTraitFit } from "./trait-fit";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const u1 = (s + 1) / 4294967297;
    s = (s * 1664525 + 1013904223) % 4294967296;
    const u2 = (s + 1) / 4294967297;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

describe("ols2", () => {
  it("recovers coefficients it was given", () => {
    const n = rng(3);
    const x1: number[] = [];
    const x2: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = n();
      const b = n();
      x1.push(a);
      x2.push(b);
      // Intercept deliberately non-zero so a solver that forgets to
      // centre it out gets caught here.
      y.push(1.4 + 0.9 * a + 0.6 * b + n() * 0.3);
    }
    const fit = ols2(x1, x2, y);
    expect(fit).not.toBeNull();
    expect(fit!.ott).toBeCloseTo(0.9, 1);
    expect(fit!.app).toBeCloseTo(0.6, 1);
  });

  it("separates two correlated predictors", () => {
    // Distance and accuracy are negatively correlated in real fields;
    // the solver has to attribute credit correctly regardless.
    const n = rng(11);
    const x1: number[] = [];
    const x2: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 800; i++) {
      const a = n();
      const b = -0.5 * a + n() * 0.8;
      x1.push(a);
      x2.push(b);
      y.push(1.0 * a + 0.2 * b + n() * 0.2);
    }
    const fit = ols2(x1, x2, y)!;
    expect(fit.ott).toBeCloseTo(1.0, 1);
    expect(fit.app).toBeCloseTo(0.2, 1);
  });

  it("refuses a singular system rather than returning nonsense", () => {
    const x1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // x2 perfectly collinear with x1 — no unique solution exists.
    const x2 = x1.map((v) => v * 2);
    const y = x1.map((v) => v * 3);
    expect(ols2(x1, x2, y)).toBeNull();
  });

  it("refuses a sample too small to mean anything", () => {
    expect(ols2([1, 2, 3], [3, 2, 1], [1, 2, 3])).toBeNull();
  });
});

describe("fitAdjustmentFor", () => {
  const fit = {
    premium: { ott: 0.2, app: -0.1 },
  } as CourseTraitFit;

  it("is zero when there is no fit to apply", () => {
    expect(
      fitAdjustmentFor(null, { baselineSgOtt: 1, baselineSgApp: 1 }),
    ).toBe(0);
  });

  it("rewards the skill the course pays a premium for", () => {
    const bomber = fitAdjustmentFor(fit, {
      baselineSgOtt: 1.0,
      baselineSgApp: 0.0,
    });
    const ironPlayer = fitAdjustmentFor(fit, {
      baselineSgOtt: 0.0,
      baselineSgApp: 1.0,
    });
    expect(bomber).toBeGreaterThan(0);
    expect(ironPlayer).toBeLessThan(0);
    expect(bomber).toBeGreaterThan(ironPlayer);
  });

  it("stays small — this effect is a tiebreak, not an edge", () => {
    // A player two standard deviations clear on both skills should
    // still only move by a fraction of a stroke per round. If this
    // ever fails, the shrinkage has been loosened too far.
    const extreme = Math.abs(
      fitAdjustmentFor(fit, { baselineSgOtt: 1.5, baselineSgApp: 1.5 }),
    );
    expect(extreme).toBeLessThan(0.5);
  });
});
