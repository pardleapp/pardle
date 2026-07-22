/**
 * Tests for the raw→enhanced affine calibration in
 * buildHoleBirdieData. The 2019-2023 3M Open events only carry raw
 * pin coords, which are in a different frame from the enhanced-frame
 * green image the modal renders on top of. Buildup fits a per-hole
 * affine from years that have BOTH raw+enh and applies it to
 * raw-only years so the dots land where they should.
 */
import { describe, expect, it } from "vitest";
import { buildHoleBirdieData, type EventInput } from "./course-birdies";
import type { CoursePinHole } from "@/lib/golf-api/pgatour";

function counts(birdiesTotalByRound: Record<number, [number, number]>) {
  const m = new Map<string, { birdies: number; total: number; rate: number }>();
  for (const [rStr, [b, t]] of Object.entries(birdiesTotalByRound)) {
    m.set(`${1}:${rStr}`, { birdies: b, total: t, rate: t > 0 ? b / t : 0 });
  }
  return m;
}

function holeSheet(pinByRound: CoursePinHole["pinByRound"]): CoursePinHole {
  return {
    holeNumber: 1,
    par: 4,
    yards: 400,
    greenImageUrl: "",
    pinByRound,
    yardsByRound: {},
    scoringByRound: {},
  };
}

describe("buildHoleBirdieData — affine calibration for raw-only years", () => {
  it("transforms raw-only pins using the affine fit from paired years", () => {
    // Calibration data: for hole 1, raw→enhanced is
    //   enhX = 0.5 * rawX + 0.1
    //   enhY = 0.5 * rawY + 0.2
    // Pairs need independent rawX/rawY variation, else the Gram
    // matrix is singular — matches real orchestrator data where x
    // and y move independently across rounds.
    const pair = (rx: number, ry: number) => ({
      rawX: rx,
      rawY: ry,
      x: 0.5 * rx + 0.1,
      y: 0.5 * ry + 0.2,
      frameEnh: true as const,
    });
    const paired: EventInput[] = [2024, 2025].map((year) => ({
      year,
      tournamentId: `R${year}525`,
      pins: [
        holeSheet({
          1: pair(0.2, 0.8),
          2: pair(0.4, 0.3),
          3: pair(0.6, 0.5),
          4: pair(0.8, 0.6),
        }),
      ],
      counts: counts({ 1: [10, 100], 2: [10, 100], 3: [10, 100], 4: [10, 100] }),
    }));

    // 2020 has raw-only pins (no rawX/rawY, no frameEnh flag).
    const rawOnly: EventInput = {
      year: 2020,
      tournamentId: "R2020525",
      pins: [
        holeSheet({
          1: { x: 0.4, y: 0.6 },
          2: { x: 0.6, y: 0.4 },
        }),
      ],
      counts: counts({ 1: [5, 50], 2: [5, 50] }),
    };

    const data = buildHoleBirdieData(1, [...paired, rawOnly]);
    expect(data).not.toBeNull();
    const pins = data!.pins.filter((p) => p.year === 2020);
    expect(pins).toHaveLength(2);
    const r1 = pins.find((p) => p.round === 1)!;
    const r2 = pins.find((p) => p.round === 2)!;
    // R1 raw=(0.4, 0.6) → enh=(0.3, 0.5)
    expect(r1.x).toBeCloseTo(0.3, 5);
    expect(r1.y).toBeCloseTo(0.5, 5);
    // R2 raw=(0.6, 0.4) → enh=(0.4, 0.4)
    expect(r2.x).toBeCloseTo(0.4, 5);
    expect(r2.y).toBeCloseTo(0.4, 5);
    // Paired years' coords stay untouched — the fit isn't applied
    // to pins that were already in the enhanced frame.
    const paired2024R1 = data!.pins.find(
      (p) => p.year === 2024 && p.round === 1,
    )!;
    expect(paired2024R1.x).toBeCloseTo(0.2, 6); // 0.5*0.2 + 0.1
    expect(paired2024R1.y).toBeCloseTo(0.6, 6); // 0.5*0.8 + 0.2
  });

  it("no-op when no calibration pairs exist (all years are raw-only)", () => {
    // Only 2019 and 2020 events, both raw-only → nothing to fit
    // against. Coords render as-is.
    const rawOnly: EventInput[] = [2019, 2020].map((year) => ({
      year,
      tournamentId: `R${year}525`,
      pins: [
        holeSheet({
          1: { x: 0.4, y: 0.5 },
          2: { x: 0.6, y: 0.5 },
        }),
      ],
      counts: counts({ 1: [10, 100], 2: [10, 100] }),
    }));
    const data = buildHoleBirdieData(1, rawOnly);
    expect(data).not.toBeNull();
    const p2019R1 = data!.pins.find((p) => p.year === 2019 && p.round === 1)!;
    expect(p2019R1.x).toBe(0.4);
    expect(p2019R1.y).toBe(0.5);
  });

  it("leaves enhanced pins untouched even when raw-only years are also present", () => {
    // Modern year with both frames, older year with raw-only. The
    // modern pin should render exactly as its enhanced coord, not
    // as a fit-transformed value.
    const events: EventInput[] = [
      {
        year: 2024,
        tournamentId: "R2024525",
        pins: [
          holeSheet({
            1: {
              x: 0.48,
              y: 0.61,
              rawX: 0.5,
              rawY: 0.7,
              frameEnh: true,
            },
          }),
        ],
        counts: counts({ 1: [10, 100] }),
      },
      {
        year: 2025,
        tournamentId: "R2025525",
        pins: [
          holeSheet({
            1: {
              x: 0.52,
              y: 0.55,
              rawX: 0.55,
              rawY: 0.65,
              frameEnh: true,
            },
          }),
        ],
        counts: counts({ 1: [8, 100] }),
      },
      {
        year: 2020,
        tournamentId: "R2020525",
        pins: [
          holeSheet({
            1: { x: 0.5, y: 0.7 },
          }),
        ],
        counts: counts({ 1: [12, 100] }),
      },
    ];
    const data = buildHoleBirdieData(1, events);
    const p2024 = data!.pins.find((p) => p.year === 2024)!;
    const p2025 = data!.pins.find((p) => p.year === 2025)!;
    expect(p2024.x).toBe(0.48);
    expect(p2024.y).toBe(0.61);
    expect(p2025.x).toBe(0.52);
    expect(p2025.y).toBe(0.55);
    // With only 2 calibration pairs the fit is under-determined
    // (needs ≥3), so 2020 stays raw. That degrades gracefully rather
    // than silently mis-transforming.
    const p2020 = data!.pins.find((p) => p.year === 2020)!;
    expect(p2020.x).toBe(0.5);
    expect(p2020.y).toBe(0.7);
  });
});
