import { describe, it, expect } from "vitest";
import {
  formatMarket,
  formatOddsAmerican,
  impliedProbability,
  formatStake,
  formatSlipHeadline,
  formatAgo,
  formatSlipResult,
  shortenName,
} from "./format";
import type { PardleBetSlip } from "./types";

describe("formatMarket", () => {
  it("renders every market kind under 20 chars for the card chip", () => {
    expect(formatMarket({ kind: "outright-winner" })).toBe("Winner");
    expect(formatMarket({ kind: "top-finish", n: 10 })).toBe("Top 10");
    expect(formatMarket({ kind: "leader-after-round", round: 2 })).toBe("R2 Leader");
    expect(formatMarket({ kind: "round-score", round: 3, direction: "over", line: 68.5 })).toBe("R3 O 68.5");
    expect(formatMarket({ kind: "round-score", round: 4, direction: "under", line: 70 })).toBe("R4 U 70");
    expect(formatMarket({ kind: "make-cut" })).toBe("Make cut");
    expect(formatMarket({ kind: "unknown", propositionRaw: "x", bookDescriptionRaw: "y" })).toBe("Prop");
  });

  it("shortens the matchup opponent name for the chip", () => {
    const m = {
      kind: "matchup" as const,
      opponent: {
        displayName: "Rory McIlroy",
        dgId: 10091,
        pgaId: null,
        sharpSportsPositionId: null,
      },
    };
    expect(formatMarket(m)).toBe("vs R. McIlroy");
  });
});

describe("formatOddsAmerican", () => {
  it("uses Unicode minus for negative odds", () => {
    expect(formatOddsAmerican(-140)).toBe("−140");
    expect(formatOddsAmerican(+350)).toBe("+350");
    expect(formatOddsAmerican(0)).toBe("+0");
  });
});

describe("impliedProbability", () => {
  it("converts +200 to 33.3%", () => {
    expect(impliedProbability(200)).toBeCloseTo(1 / 3, 3);
  });
  it("converts -150 to 60%", () => {
    expect(impliedProbability(-150)).toBeCloseTo(0.6, 3);
  });
});

describe("formatStake", () => {
  it("cents to dollars with sensible rounding", () => {
    expect(formatStake(500)).toBe("$5.00");
    expect(formatStake(2500)).toBe("$25");
    expect(formatStake(250_000)).toBe("$2500");
  });
  it("supports gbp and eur", () => {
    expect(formatStake(500, "GBP")).toBe("£5.00");
    expect(formatStake(500, "EUR")).toBe("€5.00");
  });
});

describe("formatAgo", () => {
  it("scales seconds → minutes → hours → days", () => {
    const now = 1_000_000_000_000;
    expect(formatAgo(now, now)).toBe("0s");
    expect(formatAgo(now - 30_000, now)).toBe("30s");
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5m");
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe("2h");
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe("3d");
  });
});

describe("formatSlipHeadline + result", () => {
  const baseSlip = (): PardleBetSlip => ({
    slipId: "SLIP_x",
    bettorAccountId: "BACT_x",
    book: { id: "BOOK_x", name: "DraftKings", abbr: "dk" },
    bookRef: "abc",
    placedAt: "2026-04-10T00:00:00Z",
    isParlay: false,
    slipOddsAmerican: -110,
    atRiskCents: 2000,
    toWinCents: 1818,
    netProfitCents: 1818,
    status: "completed",
    outcome: "win",
    golfLegs: [
      {
        legId: "BET_x",
        tournament: { displayName: "The Masters 2026", pgaId: "R2026014", dgEventId: 14, dgYear: 2026, startDate: "2026-04-09" },
        player: {
          displayName: "Scottie Scheffler",
          dgId: 18417,
          pgaId: "46046",
          sharpSportsPositionId: "PLYR_x",
        },
        market: { kind: "top-finish", n: 10 },
        oddsAmerican: -110,
        outcome: "win",
        isLive: false,
        incomplete: false,
      },
    ],
    otherLegsCount: 0,
    hasUnknownFields: false,
  });

  it("renders one-leg headline", () => {
    expect(formatSlipHeadline(baseSlip())).toBe("Scottie Scheffler — Top 10");
  });

  it("renders parlay headline joined with +", () => {
    const s = baseSlip();
    s.golfLegs.push({
      ...s.golfLegs[0],
      legId: "BET_y",
      player: { ...s.golfLegs[0].player!, displayName: "Rory McIlroy" },
      market: { kind: "outright-winner" },
    });
    expect(formatSlipHeadline(s)).toBe(
      "Scottie Scheffler — Top 10 + Rory McIlroy — Winner",
    );
  });

  it("settled win renders +profit", () => {
    const r = formatSlipResult(baseSlip());
    expect(r.outcome).toBe("win");
    expect(r.amount.startsWith("+")).toBe(true);
  });

  it("settled loss renders −loss", () => {
    const s = { ...baseSlip(), outcome: "loss" as const, netProfitCents: -2000 };
    const r = formatSlipResult(s);
    expect(r.outcome).toBe("loss");
    expect(r.amount.startsWith("−")).toBe(true);
  });
});

describe("shortenName", () => {
  it("initials the first name only", () => {
    expect(shortenName("Rory McIlroy")).toBe("R. McIlroy");
    expect(shortenName("Ludvig Åberg")).toBe("L. Åberg");
    expect(shortenName("Cameron")).toBe("Cameron");
  });
});
