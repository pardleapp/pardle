import { describe, it, expect } from "vitest";
import {
  parseSlip,
  parseMarket,
  normName,
  normaliseTournamentName,
  type GolferLookupEntry,
  type TournamentLookupEntry,
} from "./parser";
import type { SSBetSlip } from "./types";

// ── Test fixtures — the three JSONs SharpSports sent, minus the
// bettor id and account id which are per-tester so we anonymise. ──

const winnerSlip = {
  id: "SLIP_8d25edf80a1541698ce2a777d5054866",
  bettor: "BTTR_anon",
  book: { id: "BOOK_IPBQaQQTCRxplZx7SYOA", name: "Caesars", abbr: "ca" },
  bettorAccount: "BACT_anon",
  bookRef: "6f9f0ed0-17e5-11f0-ac1e-9dc3dfe4838c",
  timePlaced: "2025-04-12T21:31:03Z",
  type: "single",
  subtype: null,
  oddsAmerican: 2000,
  atRisk: 500,
  toWin: 13000,
  status: "completed",
  outcome: "loss",
  refreshResponse: "RRES_anon",
  incomplete: false,
  netProfit: -500,
  dateClosed: null,
  timeClosed: null,
  typeSpecial: null,
  bets: [
    {
      id: "BET_7be5688e48514cec816278ab84dbc3ae",
      type: "prop",
      event: {
        id: "EVNT_8b2f0035eb0c4cc69d01735f53d91913",
        sport: "Golf",
        league: null,
        name: "The Masters 2025",
        nameSpecial: "The Masters 2025",
        startTime: "2025-04-10T11:00:00Z",
        sportId: "SPRT_golf",
      },
      proposition: "winner",
      position: "Ludvig Aberg",
      line: null,
      oddsAmerican: 2000,
      status: "completed",
      outcome: "loss",
      live: true,
      incomplete: false,
      bookDescription:
        "Masters Tournament 2025 Markets - Tournament Winner Live - Ludvig Aberg",
      marketSelection: "MRKT_170af31675b342039ba2ff21bb04a5cc",
      positionId: "PLYR_f16ba45a239b433da214834f9e3f124f",
      propDetails: { future: true },
    },
  ],
} as unknown as SSBetSlip;

const r1LeaderSlip = {
  id: "SLIP_d975043cc5644d948a0160d483e14389",
  bettor: "BTTR_anon",
  book: { id: "BOOK_88064cc6787c47ccbd4bbb036c7f55c5", name: "BetRivers", abbr: "br" },
  bettorAccount: "BACT_anon",
  bookRef: "15293391081",
  timePlaced: "2026-02-18T18:06:36Z",
  type: "single",
  subtype: null,
  oddsAmerican: 2000,
  atRisk: 2500,
  toWin: 50000,
  status: "completed",
  outcome: "win",
  refreshResponse: "RRES_anon",
  incomplete: false,
  netProfit: 10625,
  dateClosed: null,
  timeClosed: null,
  typeSpecial: null,
  bets: [
    {
      id: "BET_c679338d7a3b45e0984dd6ee24c775e9",
      type: "prop",
      event: {
        id: "EVNT_704d04a2718b49b0b5820f21e7dcbce5",
        sport: "Golf",
        league: null,
        name: "The Genesis Invitational 2026",
        startTime: "2026-02-19T15:15:00Z",
        startDate: "2026-02-19",
        sportId: "SPRT_golf",
      },
      proposition: "Leader after Round 1",
      position: "Rory McIlroy",
      line: null,
      oddsAmerican: 2000,
      status: "completed",
      outcome: "win",
      live: false,
      incomplete: false,
      bookDescription: "The Genesis Invitational 2026 - Leader After Round 1 - Rory McIlroy",
      marketSelection: null,
      positionId: "PLYR_b9ef81d118284066807e0346b5d1503c",
      propDetails: { future: true },
    },
  ],
} as unknown as SSBetSlip;

const parlayMixedSlip = {
  id: "SLIP_75eca7fa48b74227881b5eb8594ff6e9",
  bettor: "BTTR_anon",
  book: { id: "BOOK_88064cc6787c47ccbd4bbb036c7f55c5", name: "BetRivers", abbr: "br" },
  bettorAccount: "BACT_anon",
  bookRef: "10238318799",
  timePlaced: "2024-04-11T02:03:37Z",
  type: "parlay",
  oddsAmerican: -104,
  atRisk: 2284,
  toWin: 2186,
  status: "completed",
  outcome: "win",
  refreshResponse: "RRES_anon",
  incomplete: false,
  netProfit: 2187,
  bets: [
    {
      id: "BET_golf1",
      type: "prop",
      event: {
        id: "EVNT_golf",
        sport: "Golf",
        league: null,
        name: "The Masters 2024",
        startTime: "2024-04-11T11:37:52Z",
        sportId: "SPRT_golf",
      },
      proposition: "top 10",
      position: "Scottie Scheffler",
      line: null,
      oddsAmerican: -222,
      status: "completed",
      outcome: "win",
      live: false,
      incomplete: false,
      bookDescription: "Masters Tournament 2024 - Finishing Position - Scheffler, Scottie",
      marketSelection: "MRKT_dcea0e6319594f3593adfd20012ee8db",
      positionId: "PLYR_7c8570ce5a3d462185241dbe732078c3",
      propDetails: { future: true, matchupSpecial: null },
    },
    {
      id: "BET_nba1",
      type: "straight",
      event: {
        id: "EVNT_nba",
        sport: "Basketball",
        league: "NBA",
        name: "MIN @ DEN",
        startTime: "2024-04-11T02:00:00Z",
        sportId: "SPRT_basketball",
      },
      proposition: "moneyline",
      position: "Denver Nuggets",
      line: null,
      oddsAmerican: -286,
      status: "completed",
      outcome: "win",
      live: true,
      incomplete: false,
      bookDescription: "MIN Timberwolves @ DEN Nuggets - Moneyline - DEN Nuggets",
      marketSelection: "MRKT_bd156c5b12f3406ebe25b340b81ed9ba",
      propDetails: null,
    },
  ],
} as unknown as SSBetSlip;

// ── Lookup tables — small enough to hand-populate for tests. ──

const golfers = new Map<string, GolferLookupEntry>([
  [normName("Scottie Scheffler"), { displayName: "Scottie Scheffler", dgId: 18417, pgaId: "46046" }],
  [normName("Rory McIlroy"), { displayName: "Rory McIlroy", dgId: 10091, pgaId: "28237" }],
  [normName("Ludvig Aberg"), { displayName: "Ludvig Åberg", dgId: 23950, pgaId: "52955" }],
]);

const tournaments = new Map<string, TournamentLookupEntry>([
  [
    normaliseTournamentName("The Masters 2025"),
    { displayName: "The Masters 2025", pgaId: "R2025014", dgEventId: 14, dgYear: 2025, startDate: "2025-04-10" },
  ],
  [
    normaliseTournamentName("The Masters 2024"),
    { displayName: "The Masters 2024", pgaId: "R2024014", dgEventId: 14, dgYear: 2024, startDate: "2024-04-11" },
  ],
  [
    normaliseTournamentName("The Genesis Invitational 2026"),
    { displayName: "The Genesis Invitational 2026", pgaId: "R2026007", dgEventId: 7, dgYear: 2026, startDate: "2026-02-19" },
  ],
]);

// ── Tests ──

describe("normName", () => {
  it("strips accents so Åberg matches Aberg", () => {
    expect(normName("Ludvig Åberg")).toBe(normName("Ludvig Aberg"));
  });
  it("collapses punctuation", () => {
    expect(normName("Cameron Champ Jr.")).toBe("cameronchampjr");
  });
});

describe("normaliseTournamentName", () => {
  it("strips 'Markets' and 'Tournament' noise so book descriptions and event names collide", () => {
    expect(normaliseTournamentName("The Masters 2024 Markets")).toBe(
      normaliseTournamentName("The Masters 2024"),
    );
    expect(normaliseTournamentName("Masters Tournament 2025")).toBe(
      normaliseTournamentName("Masters 2025"),
    );
  });
});

describe("parseMarket", () => {
  it("classifies 'winner' proposition as outright-winner", () => {
    const m = parseMarket(winnerSlip.bets[0]);
    expect(m.kind).toBe("outright-winner");
  });

  it("classifies 'top 10' as top-finish n=10", () => {
    const m = parseMarket(parlayMixedSlip.bets[0]);
    expect(m).toEqual({ kind: "top-finish", n: 10 });
  });

  it("classifies 'Leader after Round 1' as leader-after-round r=1", () => {
    const m = parseMarket(r1LeaderSlip.bets[0]);
    expect(m).toEqual({ kind: "leader-after-round", round: 1 });
  });

  it("falls into unknown for a truly novel proposition, preserving raw strings", () => {
    const stub = {
      ...winnerSlip.bets[0],
      proposition: "hole in one somewhere",
      bookDescription: "Made-up market string",
      position: "Rory McIlroy",
    };
    const m = parseMarket(stub);
    expect(m.kind).toBe("unknown");
    if (m.kind === "unknown") {
      expect(m.propositionRaw).toBe("hole in one somewhere");
      expect(m.bookDescriptionRaw).toBe("Made-up market string");
    }
  });

  it("recognises a round-score O/U from position + line + bookDescription", () => {
    const stub = {
      ...winnerSlip.bets[0],
      proposition: "player round score",
      bookDescription: "Round 2 Score - Over 68.5",
      position: "Over",
      line: 68.5,
      propDetails: { future: false, player: "Scottie Scheffler", playerId: "PLYR_x" },
    };
    const m = parseMarket(stub);
    expect(m).toEqual({ kind: "round-score", round: 2, direction: "over", line: 68.5 });
  });

  it("classifies a head-to-head as matchup (opponent enrichment happens later)", () => {
    const stub = {
      ...winnerSlip.bets[0],
      proposition: "player matchup",
      bookDescription: "Scheffler vs McIlroy",
      position: "Scottie Scheffler",
    };
    const m = parseMarket(stub);
    expect(m.kind).toBe("matchup");
  });
});

describe("parseSlip — end-to-end", () => {
  it("resolves the Caesars winner slip end-to-end", () => {
    const out = parseSlip(winnerSlip, { golfers, tournaments });
    expect(out.slipId).toBe(winnerSlip.id);
    expect(out.book.name).toBe("Caesars");
    expect(out.otherLegsCount).toBe(0);
    expect(out.golfLegs).toHaveLength(1);
    const leg = out.golfLegs[0];
    expect(leg.market.kind).toBe("outright-winner");
    expect(leg.player?.displayName).toBe("Ludvig Aberg");
    expect(leg.player?.dgId).toBe(23950);
    expect(leg.tournament.pgaId).toBe("R2025014");
    expect(leg.outcome).toBe("loss");
    expect(out.hasUnknownFields).toBe(false);
  });

  it("resolves the BetRivers R1 Leader slip end-to-end (marketSelection null)", () => {
    const out = parseSlip(r1LeaderSlip, { golfers, tournaments });
    const leg = out.golfLegs[0];
    expect(leg.market).toEqual({ kind: "leader-after-round", round: 1 });
    expect(leg.player?.displayName).toBe("Rory McIlroy");
    expect(leg.player?.dgId).toBe(10091);
    expect(leg.tournament.pgaId).toBe("R2026007");
    expect(leg.outcome).toBe("win");
  });

  it("keeps only the golf leg on a mixed-sport parlay, counts the rest", () => {
    const out = parseSlip(parlayMixedSlip, { golfers, tournaments });
    expect(out.isParlay).toBe(true);
    expect(out.golfLegs).toHaveLength(1);
    expect(out.otherLegsCount).toBe(1);
    const leg = out.golfLegs[0];
    expect(leg.market).toEqual({ kind: "top-finish", n: 10 });
    expect(leg.player?.displayName).toBe("Scottie Scheffler");
  });

  it("flags hasUnknownFields when player cannot be resolved", () => {
    const stub: SSBetSlip = {
      ...winnerSlip,
      bets: [
        {
          ...winnerSlip.bets[0],
          position: "Someone Nobody Heard Of",
          positionId: null,
        },
      ],
    };
    const out = parseSlip(stub, { golfers, tournaments });
    expect(out.hasUnknownFields).toBe(true);
  });
});
