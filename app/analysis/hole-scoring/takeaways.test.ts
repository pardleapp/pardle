import { describe, it, expect } from "vitest";
import { deriveTakeaways, expectedSetupDelta } from "./takeaways";
import type { HoleRow } from "./HoleSetup";

function row(overrides: Partial<HoleRow> = {}): HoleRow {
  return {
    hole: 1,
    par: 4,
    yards: 440,
    dYards: 0,
    head: 0,
    cross: 0,
    windKind: null,
    score: 0,
    dScore: 0,
    ...overrides,
  };
}

describe("expectedSetupDelta", () => {
  it("returns 0 for a neutral setup", () => {
    expect(expectedSetupDelta(row())).toBe(0);
  });

  it("makes longer yardage harder", () => {
    const d = expectedSetupDelta(row({ dYards: 50 }));
    expect(d).toBeGreaterThan(0);
  });

  it("makes headwind harder, tailwind easier", () => {
    expect(expectedSetupDelta(row({ head: 10, windKind: "into" }))).toBeGreaterThan(0);
    expect(expectedSetupDelta(row({ head: -10, windKind: "down" }))).toBeLessThan(0);
  });
});

describe("deriveTakeaways", () => {
  it("flags a 'shorter and downwind but scoring worse' surprise", () => {
    const rows = [
      row({
        hole: 8,
        dYards: -20,
        head: -8,
        windKind: "down",
        dScore: 0.35,
      }),
    ];
    const out = deriveTakeaways(rows);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("surprise-hard");
    expect(out[0].hole).toBe(8);
    expect(out[0].detail).toMatch(/up 20 yds/);
    expect(out[0].detail).toMatch(/downwind/);
  });

  it("flags a 'longer and into wind but scoring easier' surprise", () => {
    const rows = [
      row({
        hole: 12,
        dYards: 30,
        head: 12,
        windKind: "into",
        dScore: -0.35,
      }),
    ];
    const out = deriveTakeaways(rows);
    expect(out[0].kind).toBe("surprise-easy");
    expect(out[0].hole).toBe(12);
  });

  it("flags a quiet-setup / loud-scoring hole as pin-driven", () => {
    const rows = [
      row({
        hole: 5,
        dYards: 3,
        head: 1,
        cross: 1,
        windKind: "cross",
        dScore: 0.35,
      }),
    ];
    const out = deriveTakeaways(rows);
    expect(out[0].kind).toBe("quiet-setup-loud-scoring");
  });

  it("flags a loud-setup / quiet-scoring hole", () => {
    const rows = [
      row({
        hole: 14,
        dYards: 40,
        head: 8,
        windKind: "into",
        dScore: -0.02,
      }),
    ];
    const out = deriveTakeaways(rows);
    expect(out[0].kind).toBe("loud-setup-quiet-scoring");
  });

  it("still surfaces a big yardage jump even when scoring behaves", () => {
    const rows = [
      row({
        hole: 9,
        dYards: 35,
        head: 0,
        windKind: null,
        dScore: 0.05, // small — under quiet threshold
      }),
    ];
    const out = deriveTakeaways(rows);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].kind).toBe("yardage-jump");
  });

  it("returns at most `limit` items and de-duplicates by hole", () => {
    const rows: HoleRow[] = [];
    for (let h = 1; h <= 18; h++) {
      rows.push(row({ hole: h, dYards: 30, head: 10, windKind: "into", dScore: -0.5 }));
    }
    const out = deriveTakeaways(rows, { limit: 3 });
    expect(out.length).toBe(3);
    const holes = new Set(out.map((t) => t.hole));
    expect(holes.size).toBe(3);
  });

  it("ranks stronger surprises earlier", () => {
    const rows = [
      row({ hole: 1, dYards: -15, head: -6, windKind: "down", dScore: 0.22 }),
      row({ hole: 2, dYards: -25, head: -10, windKind: "down", dScore: 0.45 }),
    ];
    const out = deriveTakeaways(rows);
    expect(out[0].hole).toBe(2);
    expect(out[0].severity).toBeGreaterThan(out[1].severity);
  });

  it("emits nothing when everything is calm and expected", () => {
    const rows = [
      row({ hole: 1, dYards: 2, head: 1, windKind: "cross", dScore: 0.02 }),
      row({ hole: 2, dYards: -3, head: 0, windKind: null, dScore: -0.01 }),
    ];
    const out = deriveTakeaways(rows);
    expect(out.length).toBe(0);
  });
});
