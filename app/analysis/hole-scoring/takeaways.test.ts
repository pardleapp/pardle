import { describe, it, expect } from "vitest";
import {
  buildPinInsight,
  deriveTakeaways,
  expectedSetupDelta,
  matchClusterForPin,
} from "./takeaways";
import type { HoleRow } from "./HoleSetup";
import type {
  HoleBirdieData,
  PinCluster,
} from "@/lib/analysis/course-birdies";
import type { CoursePinHole } from "@/lib/golf-api/pgatour";

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

function cluster(overrides: Partial<PinCluster> = {}): PinCluster {
  return {
    clusterId: "A",
    centroid: { x: 0.5, y: 0.5 },
    radius: 0.06,
    pinCount: 4,
    memberIndices: [0, 1, 2, 3],
    birdies: 3,
    bogeys: 6,
    sumVsPar: 3,
    total: 20,
    rate: 0.15,
    bogeyRate: 0.3,
    avgVsPar: 0.15,
    ...overrides,
  };
}

function history(overrides: Partial<HoleBirdieData> = {}): HoleBirdieData {
  return {
    holeNumber: 8,
    par: 4,
    yards: null,
    greenImageUrl: "",
    quadrants: {
      TL: {} as HoleBirdieData["quadrants"]["TL"],
      TR: {} as HoleBirdieData["quadrants"]["TR"],
      BL: {} as HoleBirdieData["quadrants"]["BL"],
      BR: {} as HoleBirdieData["quadrants"]["BR"],
    },
    clusters: [cluster()],
    pins: [],
    overall: {
      pinCount: 4,
      birdies: 12,
      bogeys: 12,
      sumVsPar: 0,
      total: 80,
      rate: 0.15,
      bogeyRate: 0.15,
      avgVsPar: 0,
    },
    yearsCovered: [2023, 2024, 2025],
    ...overrides,
  };
}

function pinHole(
  round: number,
  x: number,
  y: number,
): CoursePinHole {
  return {
    holeNumber: 8,
    par: 4,
    pinByRound: { [round]: { x, y } },
    yardsByRound: {},
    scoringByRound: {},
  } as unknown as CoursePinHole;
}

describe("matchClusterForPin", () => {
  it("returns null when there's no pin or clusters", () => {
    expect(matchClusterForPin(null, [cluster()])).toBeNull();
    expect(matchClusterForPin({ x: 0.5, y: 0.5 }, [])).toBeNull();
  });

  it("returns a cluster whose radius contains the pin", () => {
    const c = cluster({ centroid: { x: 0.5, y: 0.5 }, radius: 0.05 });
    expect(matchClusterForPin({ x: 0.51, y: 0.5 }, [c])?.clusterId).toBe(c.clusterId);
  });

  it("prefers the nearest containing cluster when several qualify", () => {
    const near = cluster({ clusterId: "NEAR", centroid: { x: 0.5, y: 0.5 }, radius: 0.1 });
    const far = cluster({ clusterId: "FAR", centroid: { x: 0.6, y: 0.5 }, radius: 0.15 });
    // Pin sits inside both radii; NEAR is closer.
    expect(matchClusterForPin({ x: 0.52, y: 0.5 }, [near, far])?.clusterId).toBe("NEAR");
  });

  it("falls back to the nearest cluster within 2x radius when nothing contains the pin", () => {
    const c = cluster({ centroid: { x: 0.5, y: 0.5 }, radius: 0.05 });
    // 0.08 away — outside radius but inside 2x tolerance
    expect(matchClusterForPin({ x: 0.58, y: 0.5 }, [c])?.clusterId).toBe(c.clusterId);
  });

  it("returns null when the pin is well outside every cluster", () => {
    const c = cluster({ centroid: { x: 0.1, y: 0.1 }, radius: 0.03 });
    expect(matchClusterForPin({ x: 0.9, y: 0.9 }, [c])).toBeNull();
  });
});

describe("buildPinInsight", () => {
  it("returns null without history or pin", () => {
    expect(buildPinInsight(8, 2, 0.3, undefined, pinHole(2, 0.5, 0.5))).toBeNull();
    expect(buildPinInsight(8, 2, 0.3, history(), undefined)).toBeNull();
  });

  it("returns null when the sample is too small", () => {
    const h = history({
      clusters: [cluster({ pinCount: 1, avgVsPar: 0.4 })],
      overall: { ...history().overall, avgVsPar: 0 },
    });
    expect(buildPinInsight(8, 2, 0.3, h, pinHole(2, 0.5, 0.5))).toBeNull();
  });

  it("returns null when cluster/green delta is trivial", () => {
    const h = history({
      clusters: [cluster({ pinCount: 6, avgVsPar: 0.03 })],
      overall: { ...history().overall, avgVsPar: 0 },
    });
    expect(buildPinInsight(8, 2, 0.3, h, pinHole(2, 0.5, 0.5))).toBeNull();
  });

  it("returns null when cluster is easier but the day played harder", () => {
    const h = history({
      clusters: [cluster({ pinCount: 6, avgVsPar: -0.2 })],
      overall: { ...history().overall, avgVsPar: 0 },
    });
    // dScore > 0 (harder), cluster easier — direction mismatch.
    expect(buildPinInsight(8, 2, 0.3, h, pinHole(2, 0.5, 0.5))).toBeNull();
  });

  it("returns an insight when a tough cluster explains a hard day", () => {
    const h = history({
      clusters: [
        cluster({
          pinCount: 5,
          avgVsPar: 0.25,
          rate: 0.06,
          bogeyRate: 0.35,
        }),
      ],
      overall: { ...history().overall, avgVsPar: 0 },
    });
    const out = buildPinInsight(8, 2, 0.3, h, pinHole(2, 0.5, 0.5));
    expect(out).not.toBeNull();
    expect(out!.clusterDelta).toBeCloseTo(0.25);
    expect(out!.pinCount).toBe(5);
    expect(out!.headline).toMatch(/tough pin/i);
    expect(out!.headline).toMatch(/35% bogey/);
  });

  it("returns an insight when an easy cluster explains a soft day", () => {
    const h = history({
      clusters: [
        cluster({
          pinCount: 4,
          avgVsPar: -0.2,
          rate: 0.28,
          bogeyRate: 0.08,
        }),
      ],
      overall: { ...history().overall, avgVsPar: 0 },
    });
    const out = buildPinInsight(8, 2, -0.3, h, pinHole(2, 0.5, 0.5));
    expect(out).not.toBeNull();
    expect(out!.headline).toMatch(/scoring pin/i);
    expect(out!.headline).toMatch(/28% birdie/);
  });
});

describe("deriveTakeaways with pin context", () => {
  it("attaches pinInsight to a takeaway when the day's pin sits in an explanatory cluster", () => {
    const rows = [
      row({ hole: 8, dYards: 3, head: 1, cross: 1, windKind: "cross", dScore: 0.35 }),
    ];
    const h = history({
      holeNumber: 8,
      clusters: [
        cluster({
          pinCount: 5,
          avgVsPar: 0.22,
          rate: 0.08,
          bogeyRate: 0.32,
        }),
      ],
      overall: { ...history().overall, avgVsPar: 0 },
    });
    const out = deriveTakeaways(rows, {
      round: 2,
      pinsByHole: { 8: pinHole(2, 0.5, 0.5) },
      birdieHistoryByHole: { "8": h },
    });
    expect(out.length).toBe(1);
    expect(out[0].pinInsight).toBeDefined();
    expect(out[0].pinInsight!.clusterDelta).toBeGreaterThan(0);
  });

  it("leaves pinInsight undefined when no context is supplied", () => {
    const rows = [
      row({ hole: 8, dYards: 3, head: 1, cross: 1, windKind: "cross", dScore: 0.35 }),
    ];
    const out = deriveTakeaways(rows);
    expect(out[0].pinInsight).toBeUndefined();
  });
});
