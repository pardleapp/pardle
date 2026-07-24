/**
 * Regression tests for the pin-sheet augment step. The bug this guards
 * against: /api/course-pin-birdies used to fetch raw pins from
 * getCoursePins() and cache them WITHOUT applying augmentYardsFromHistorical.
 * That poisoned the shared pin cache with replicated per-round coords
 * for pre-2023 events, so the birdie-history modal's four per-round
 * dots stacked on top of each other instead of scattering across the
 * green.
 *
 * These tests exercise the augment helper directly against the real
 * bundled data/historical/*.json fixtures — so any regression in
 * either the augment logic OR the JSON data shape would fail the test.
 */
import { describe, expect, it } from "vitest";
import type { CoursePinSheet } from "@/lib/golf-api/pgatour";
import {
  augmentYardsFromHistorical,
  historicalRefFor,
} from "./pin-sheet-augment";

/** Build a replicated-pin sheet — mirrors what parseCoursePinsPayload
 *  produces for pre-2023 events where courseStats only ships one
 *  roundless pin per hole. Every round's coord coincides. */
function replicatedSheet(coord: {
  x: number;
  y: number;
}): CoursePinSheet {
  const holes = [];
  for (let h = 1; h <= 18; h++) {
    holes.push({
      holeNumber: h,
      par: 4,
      yards: 400,
      greenImageUrl: "",
      pinByRound: {
        1: { ...coord },
        2: { ...coord },
        3: { ...coord },
        4: { ...coord },
      },
      yardsByRound: {},
      scoringByRound: {},
    });
  }
  return { tournamentId: "R2020525", courseName: "", holes };
}

describe("historicalRefFor", () => {
  it("resolves 3M Open family across years", () => {
    expect(historicalRefFor("R2019525")).toEqual({
      slug: "3m-open",
      year: 2019,
    });
    expect(historicalRefFor("R2020525")).toEqual({
      slug: "3m-open",
      year: 2020,
    });
    expect(historicalRefFor("R2022525")).toEqual({
      slug: "3m-open",
      year: 2022,
    });
    expect(historicalRefFor("R2025525")).toEqual({
      slug: "3m-open",
      year: 2025,
    });
  });

  it("returns null for non-3M-family tournaments", () => {
    expect(historicalRefFor("R2024541")).toBeNull(); // British Open
    expect(historicalRefFor("R2024100")).toBeNull();
    expect(historicalRefFor("R2020024")).toBeNull(); // The Masters
    expect(historicalRefFor("garbage")).toBeNull();
  });
});

describe("augmentYardsFromHistorical — pin merge for pre-2023 events", () => {
  it("swaps replicated per-round pins for the real per-round coords from historical JSON", async () => {
    const sheet = replicatedSheet({ x: 0.5, y: 0.5 });
    const augmented = await augmentYardsFromHistorical(sheet, "R2022525");
    // Every hole should now have distinct per-round pins — the exact
    // failure mode this test guards against is all-coincident coords.
    for (const hole of augmented.holes) {
      const coords = Object.values(hole.pinByRound);
      expect(coords.length).toBeGreaterThanOrEqual(2);
      const first = coords[0];
      const hasDistinct = coords.some(
        (c) => Math.abs(c.x - first.x) > 0.001 || Math.abs(c.y - first.y) > 0.001,
      );
      expect(
        hasDistinct,
        `H${hole.holeNumber} pinByRound coords are still all-coincident after augment: ${JSON.stringify(coords)}`,
      ).toBe(true);
    }
  });

  it("preserves already-distinct per-round pins (2024+ orchestrator data)", async () => {
    // A 2024 sheet with real per-round pins should pass through unchanged
    // on the pin-merge branch — the "roundless-replicated" guard only
    // fires when the input is coincident.
    const holes = [];
    for (let h = 1; h <= 18; h++) {
      holes.push({
        holeNumber: h,
        par: 4,
        yards: 400,
        greenImageUrl: "",
        pinByRound: {
          1: { x: 0.3, y: 0.4 },
          2: { x: 0.5, y: 0.5 },
          3: { x: 0.7, y: 0.6 },
          4: { x: 0.4, y: 0.7 },
        },
        yardsByRound: {},
        scoringByRound: {},
      });
    }
    const sheet: CoursePinSheet = {
      tournamentId: "R2024525",
      courseName: "",
      holes,
    };
    const augmented = await augmentYardsFromHistorical(sheet, "R2024525");
    for (const hole of augmented.holes) {
      const orig = sheet.holes.find((h) => h.holeNumber === hole.holeNumber)!;
      expect(hole.pinByRound[1]).toEqual(orig.pinByRound[1]);
      expect(hole.pinByRound[2]).toEqual(orig.pinByRound[2]);
      expect(hole.pinByRound[3]).toEqual(orig.pinByRound[3]);
      expect(hole.pinByRound[4]).toEqual(orig.pinByRound[4]);
    }
  });

  it("no-ops for tournaments outside the historical family", async () => {
    const sheet = replicatedSheet({ x: 0.5, y: 0.5 });
    // British Open — no data/historical/british-open-*.json exists.
    const augmented = await augmentYardsFromHistorical(sheet, "R2024541");
    expect(augmented).toBe(sheet);
  });

  it("is idempotent — augmenting twice returns the same result", async () => {
    // Applying the augment step twice must be safe so any future caller
    // that layers it in defensively doesn't break the output.
    const sheet = replicatedSheet({ x: 0.5, y: 0.5 });
    const once = await augmentYardsFromHistorical(sheet, "R2022525");
    const twice = await augmentYardsFromHistorical(once, "R2022525");
    expect(twice).toEqual(once);
  });
});
