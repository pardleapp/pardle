import { describe, expect, it } from "vitest";
import {
  hasComputedSg,
  withComputedSgEvents,
  withComputedSgRounds,
} from "./computed-sg";
import type { DGHistoricalEvent, DGHistoricalRoundsPayload } from "./datagolf";
import baycurrent2025 from "@/data/sg-computed/527-2025.json";

const someDgId = Number(Object.keys(baycurrent2025.players)[0]);

function round(over: Partial<Record<string, number | null>> = {}) {
  return {
    score: 70, course_par: 71, sg_total: 1.2,
    sg_ott: null, sg_app: null, sg_arg: null, sg_putt: null, sg_t2g: null,
    ...over,
  } as unknown as NonNullable<DGHistoricalRoundsPayload["scores"][number]["round_1"]>;
}

describe("computed SG overlay", () => {
  it("knows which event-years it covers", () => {
    expect(hasComputedSg(527, 2025)).toBe(true);
    expect(hasComputedSg(527, 2024)).toBe(false);
  });

  it("flags covered events as having SG categories, leaving others alone", () => {
    const list = [
      { event_id: 527, calendar_year: 2025, sg_categories: "no" },
      { event_id: 527, calendar_year: 2023, sg_categories: "no" },
    ] as DGHistoricalEvent[];
    const out = withComputedSgEvents(list);
    expect(out[0].sg_categories).toBe("yes");
    expect(out[1].sg_categories).toBe("no");
  });

  it("fills null categories and never overwrites DataGolf's own values", () => {
    const payload = {
      event_completed: "", event_id: 527, event_name: "Baycurrent Classic",
      scores: [
        { dg_id: someDgId, fin_text: "1", player_name: "x", round_1: round(), round_2: round({ sg_ott: 9 }) },
        { dg_id: -1, fin_text: "2", player_name: "y", round_1: round() },
      ],
    } as DGHistoricalRoundsPayload;
    const out = withComputedSgRounds(payload, 527, 2025);
    const expected = (baycurrent2025.players as Record<string, Record<string, { sg_ott: number }>>)[String(someDgId)]["1"];
    expect(out.scores[0].round_1!.sg_ott).toBe(expected.sg_ott);
    expect(out.scores[0].round_2!.sg_ott).toBe(9);
    expect(out.scores[1].round_1!.sg_ott).toBeNull();
    // Idempotent.
    expect(withComputedSgRounds(out, 527, 2025)).toEqual(out);
    // Other events untouched.
    expect(withComputedSgRounds(payload, 527, 2024)).toBe(payload);
  });
});
