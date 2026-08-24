import { describe, expect, it } from "vitest";
import {
  computePersistence,
  reliabilityFor,
  type PlayerResiduals,
} from "./persistence";
import realEastLake from "./__fixtures__/east-lake-residuals.json";

/** Deterministic normal-ish sampler so the synthetic cases don't
 *  flake. Box-Muller over a seeded LCG. */
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

/** Players who each have `visits` trips to a venue, where a fraction
 *  of their course fit is a real persistent effect (trueSd) and the
 *  rest is week-to-week scatter (noiseSd). */
function synth(
  players: number,
  visits: number,
  trueSd: number,
  noiseSd: number,
  seed = 7,
): PlayerResiduals[] {
  const n = rng(seed);
  const out: PlayerResiduals[] = [];
  for (let p = 0; p < players; p++) {
    const truth = n() * trueSd;
    const v: number[] = [];
    for (let i = 0; i < visits; i++) v.push(truth + n() * noiseSd);
    out.push({
      dgId: p + 1,
      ott: v,
      app: v,
      visitsOtt: v,
      visitsApp: v,
    });
  }
  return out;
}

describe("computePersistence", () => {
  it("returns nothing usable when too few players have history", () => {
    const stats = computePersistence(synth(5, 4, 0.3, 1.0));
    expect(stats.usable).toBe(false);
    // Callers must fall back to raw numbers, not to a made-up shrink.
    expect(reliabilityFor(stats.ott, 4)).toBe(1);
  });

  it("returns nothing usable when nobody has visited twice", () => {
    // Single-visit players carry no information about repeatability,
    // however many of them there are.
    const single = synth(60, 1, 0.5, 1.0);
    const stats = computePersistence(single);
    expect(stats.usable).toBe(false);
    expect(stats.repeatVisitors).toBe(0);
  });

  it("finds no signal when every player is identical plus noise", () => {
    // trueSd = 0 means nobody has a real course effect. The estimator
    // should say so rather than manufacturing one out of noise.
    const stats = computePersistence(synth(60, 4, 0.0, 1.0));
    expect(stats.usable).toBe(true);
    expect(stats.ott.trueVar).toBeLessThan(0.05);
    expect(stats.ott.typicalReliability).toBeLessThan(0.15);
  });

  it("keeps most of the signal when the effect is real and noise is low", () => {
    const stats = computePersistence(synth(60, 6, 1.0, 0.4));
    expect(stats.ott.typicalReliability).toBeGreaterThan(0.8);
    expect(stats.ott.testRetest).toBeGreaterThan(0.5);
  });

  it("agrees in sign with its own test-retest check", () => {
    const real = computePersistence(synth(60, 6, 1.0, 0.5));
    expect(real.ott.trueVar).toBeGreaterThan(0);
    expect(real.ott.testRetest).toBeGreaterThan(0);

    const none = computePersistence(synth(60, 6, 0.0, 1.0));
    expect(none.ott.trueVar).toBeLessThan(0.05);
    expect(Math.abs(none.ott.testRetest ?? 0)).toBeLessThan(0.3);
  });

  it("trusts a player with more visits more than one with fewer", () => {
    const stats = computePersistence(synth(60, 6, 0.6, 0.9));
    const few = reliabilityFor(stats.ott, 2);
    const many = reliabilityFor(stats.ott, 20);
    expect(many).toBeGreaterThan(few);
    expect(few).toBeGreaterThan(0);
    expect(many).toBeLessThanOrEqual(1);
  });

  it("never scales a number up", () => {
    const stats = computePersistence(synth(60, 4, 0.4, 1.0));
    for (const v of [1, 2, 4, 12, 50]) {
      const r = reliabilityFor(stats.ott, v);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe("real East Lake history", () => {
  const stats = computePersistence(realEastLake as PlayerResiduals[]);

  it("has enough history to measure", () => {
    expect(stats.usable).toBe(true);
    expect(stats.playersUsed).toBeGreaterThan(50);
    expect(stats.repeatVisitors).toBeGreaterThan(30);
  });

  it("finds almost nothing that repeats", () => {
    // This is the honest answer for this venue and the reason the
    // module exists. Both test-retest correlations sit near zero, so
    // the adjusted column should collapse a raw record toward
    // nothing. If a future change makes East Lake look confidently
    // predictive, suspect the change before believing it.
    expect(Math.abs(stats.ott.testRetest ?? 0)).toBeLessThan(0.3);
    expect(Math.abs(stats.app.testRetest ?? 0)).toBeLessThan(0.3);
    expect(stats.ott.typicalReliability).toBeLessThan(0.3);
    expect(stats.app.typicalReliability).toBeLessThan(0.4);
  });

  it("discards most of a two-visit record", () => {
    // Wyndham Clark's raw record here is ~+1.09 combined over 2 visits.
    // Whatever survives should be a small fraction of that.
    const keptOtt = reliabilityFor(stats.ott, 2);
    const keptApp = reliabilityFor(stats.app, 2);
    expect(keptOtt).toBeLessThan(0.35);
    expect(keptApp).toBeLessThan(0.35);
  });
});
