import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PGALeaderboardRow,
  PGAScorecard,
} from "@/lib/golf-api/pgatour";
import type {
  OutrightBet,
  RoundScoreBet,
  TopFinishBet,
  WinningScoreBet,
  WithoutBet,
} from "@/app/live/bet-shared";

// Mock Redis to a bump-and-return in-memory shim — the module reads
// from Redis.fromEnv() at import time, so we intercept before the
// SUT loads. The shared store is cleared in beforeEach so each test
// sees the mock's fresh return value rather than a cached hit from a
// prior test's write.
const _redisStore = new Map<string, unknown>();
vi.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: () => ({
        async get(k: string) {
          return _redisStore.get(k) ?? null;
        },
        async set(k: string, v: unknown) {
          _redisStore.set(k, v);
          return "OK";
        },
      }),
    },
  };
});

const mockLb = vi.fn<(id: string) => Promise<PGALeaderboardRow[]>>();
const mockScorecards = vi.fn<
  (id: string, ids: string[]) => Promise<Record<string, PGAScorecard>>
>();

vi.mock("@/lib/golf-api/pgatour", () => ({
  getLeaderboard: (id: string) => mockLb(id),
  getScorecards: (id: string, ids: string[]) => mockScorecards(id, ids),
}));

const { settleBetFromOrchestrator } = await import("./orchestrator-settlement");

function lbRow(
  overrides: Partial<PGALeaderboardRow>,
): PGALeaderboardRow {
  return {
    playerId: "p",
    displayName: "P",
    position: "T50",
    total: "E",
    thru: "F",
    score: "E",
    currentRound: 4,
    playerState: "COMPLETE",
    ...overrides,
  };
}

function finalOpenLeaderboard(): PGALeaderboardRow[] {
  // Mirrors the actual R2026100 shape three days after the finish:
  // winner + runners-up = COMPLETE/F/R4, cut players = COMPLETE/-/R2.
  return [
    lbRow({ playerId: "fox", position: "1", thru: "F", currentRound: 4 }),
    lbRow({ playerId: "young", position: "2", thru: "F", currentRound: 4 }),
    lbRow({ playerId: "burns", position: "3", thru: "F", currentRound: 4 }),
    lbRow({ playerId: "scheffler", position: "T4", thru: "F", currentRound: 4 }),
    // Cut player — thru="-" is the post-tournament marker
    lbRow({ playerId: "cutguy", position: "T85", thru: "-", currentRound: 2 }),
    lbRow({
      playerId: "wdguy",
      position: "T156",
      thru: "-",
      currentRound: -1,
      playerState: "WITHDRAWN",
    }),
  ];
}

function baseBet<T extends { tournamentId?: string }>(fields: T): T {
  return { tournamentId: "R2026100", ...fields };
}

describe("settleBetFromOrchestrator", () => {
  beforeEach(() => {
    mockLb.mockReset();
    mockScorecards.mockReset();
    _redisStore.clear();
  });

  it("returns settled:false without tournamentId", async () => {
    const bet = baseBet<OutrightBet>({
      id: "b",
      kind: "outright",
      playerId: "fox",
      playerName: "Ryan Fox",
      oddsTaken: 40,
      oddsTakenLabel: "+3900",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    delete (bet as { tournamentId?: string }).tournamentId;
    const res = await settleBetFromOrchestrator(bet);
    expect(res.settled).toBe(false);
    expect(res.reason).toBe("orch:no-tournament-id");
  });

  it("settles outright winner as won", async () => {
    mockLb.mockResolvedValue(finalOpenLeaderboard());
    const bet = baseBet<OutrightBet>({
      id: "b",
      kind: "outright",
      playerId: "fox",
      playerName: "Ryan Fox",
      oddsTaken: 40,
      oddsTakenLabel: "+3900",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const res = await settleBetFromOrchestrator(bet);
    expect(res).toEqual({ settled: true, won: true, reason: "orch:outright" });
  });

  it("settles outright non-winner as lost", async () => {
    mockLb.mockResolvedValue(finalOpenLeaderboard());
    const bet = baseBet<OutrightBet>({
      id: "b",
      kind: "outright",
      playerId: "scheffler",
      playerName: "Scottie Scheffler",
      oddsTaken: 6,
      oddsTakenLabel: "+500",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const res = await settleBetFromOrchestrator(bet);
    expect(res).toEqual({ settled: true, won: false, reason: "orch:outright" });
  });

  it("settles tied co-winners (dead heat) as won for either backer", async () => {
    mockLb.mockResolvedValue([
      lbRow({ playerId: "fox", position: "T1", thru: "F", currentRound: 4 }),
      lbRow({ playerId: "young", position: "T1", thru: "F", currentRound: 4 }),
      lbRow({ playerId: "burns", position: "3", thru: "F", currentRound: 4 }),
    ]);
    const foxBet = baseBet<OutrightBet>({
      id: "b1",
      kind: "outright",
      playerId: "fox",
      playerName: "Ryan Fox",
      oddsTaken: 40,
      oddsTakenLabel: "+3900",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const youngBet = { ...foxBet, id: "b2", playerId: "young" };
    expect((await settleBetFromOrchestrator(foxBet)).won).toBe(true);
    expect((await settleBetFromOrchestrator(youngBet)).won).toBe(true);
  });

  it("top-finish settles won when position ≤ cutoff", async () => {
    mockLb.mockResolvedValue(finalOpenLeaderboard());
    const bet = baseBet<TopFinishBet>({
      id: "b",
      kind: "top-finish",
      playerId: "scheffler",
      playerName: "Scottie Scheffler",
      cutoff: 5,
      oddsTaken: 2.5,
      oddsTakenLabel: "+150",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const res = await settleBetFromOrchestrator(bet);
    expect(res).toEqual({
      settled: true,
      won: true,
      reason: "orch:top-finish",
    });
  });

  it("top-finish settles lost when position > cutoff", async () => {
    mockLb.mockResolvedValue(finalOpenLeaderboard());
    const bet = baseBet<TopFinishBet>({
      id: "b",
      kind: "top-finish",
      playerId: "cutguy",
      playerName: "Cut Guy",
      cutoff: 20,
      oddsTaken: 3,
      oddsTakenLabel: "+200",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const res = await settleBetFromOrchestrator(bet);
    // cutguy is T85 → parsed to 85 > 20 → lost
    expect(res).toEqual({
      settled: true,
      won: false,
      reason: "orch:top-finish",
    });
  });

  it("top-finish for a WD player (position CUT/WD/etc.) settles lost", async () => {
    mockLb.mockResolvedValue([
      lbRow({ playerId: "fox", position: "1", thru: "F", currentRound: 4 }),
      lbRow({ playerId: "young", position: "T2", thru: "F", currentRound: 4 }),
      lbRow({
        playerId: "wdguy",
        position: "WD",
        thru: "-",
        currentRound: -1,
        playerState: "WITHDRAWN",
      }),
    ]);
    const bet = baseBet<TopFinishBet>({
      id: "b",
      kind: "top-finish",
      playerId: "wdguy",
      playerName: "WD Guy",
      cutoff: 10,
      oddsTaken: 3,
      oddsTakenLabel: "+200",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const res = await settleBetFromOrchestrator(bet);
    expect(res).toEqual({
      settled: true,
      won: false,
      reason: "orch:cut-or-wd",
    });
  });

  it("winning-score reads winner's scorecard and grades under/over", async () => {
    mockLb.mockResolvedValue(finalOpenLeaderboard());
    // Fox shot 68+70+72+70 = 280
    mockScorecards.mockResolvedValue({
      fox: {
        playerId: "fox",
        currentHole: null,
        currentShotDisplay: null,
        playByPlay: null,
        playerState: "COMPLETE",
        rounds: {
          1: Array.from({ length: 18 }, (_, i) => ({
            holeNumber: i + 1,
            score: "3.7", // won't index; use ints below
            par: 4,
          })).map((h, i) => ({ ...h, score: i === 0 ? "4" : "4" })),
          2: Array.from({ length: 18 }, (_, i) => ({
            holeNumber: i + 1,
            score: i === 0 ? "4" : "4",
            par: 4,
          })),
          3: Array.from({ length: 18 }, (_, i) => ({
            holeNumber: i + 1,
            score: i === 0 ? "4" : "4",
            par: 4,
          })),
          4: Array.from({ length: 18 }, (_, i) => ({
            holeNumber: i + 1,
            score: i === 0 ? "4" : "4",
            par: 4,
          })),
        },
      },
    });
    // Total is 18*4 = 72 per round × 4 = 288
    const under: WinningScoreBet = baseBet<WinningScoreBet>({
      id: "b",
      kind: "winning-score",
      side: "under",
      line: 290,
      oddsTaken: 2,
      oddsTakenLabel: "+100",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const over: WinningScoreBet = { ...under, id: "b2", side: "over", line: 290 };
    const under270: WinningScoreBet = { ...under, id: "b3", line: 270 };

    expect((await settleBetFromOrchestrator(under)).won).toBe(true); // 288 < 290
    expect((await settleBetFromOrchestrator(over)).won).toBe(false); // 288 < 290, not >=
    expect((await settleBetFromOrchestrator(under270)).won).toBe(false); // 288 not < 270
  });

  it("round-score settles from bet.round scorecard", async () => {
    mockLb.mockResolvedValue(finalOpenLeaderboard());
    mockScorecards.mockResolvedValue({
      fox: {
        playerId: "fox",
        currentHole: null,
        currentShotDisplay: null,
        playByPlay: null,
        playerState: "COMPLETE",
        rounds: {
          1: [
            { holeNumber: 1, score: "4", par: 4 },
            { holeNumber: 2, score: "4", par: 4 },
            { holeNumber: 3, score: "3", par: 4 },
            { holeNumber: 4, score: "5", par: 5 },
            { holeNumber: 5, score: "4", par: 4 },
            { holeNumber: 6, score: "3", par: 3 },
            { holeNumber: 7, score: "4", par: 4 },
            { holeNumber: 8, score: "3", par: 3 },
            { holeNumber: 9, score: "5", par: 5 },
            { holeNumber: 10, score: "4", par: 4 },
            { holeNumber: 11, score: "4", par: 4 },
            { holeNumber: 12, score: "3", par: 3 },
            { holeNumber: 13, score: "4", par: 4 },
            { holeNumber: 14, score: "4", par: 4 },
            { holeNumber: 15, score: "5", par: 5 },
            { holeNumber: 16, score: "3", par: 3 },
            { holeNumber: 17, score: "4", par: 4 },
            { holeNumber: 18, score: "3", par: 4 },
          ],
        },
      },
    });
    // R1 total = 68
    const under70: RoundScoreBet = baseBet<RoundScoreBet>({
      id: "b1",
      kind: "round-score",
      playerId: "fox",
      playerName: "Ryan Fox",
      round: 1,
      side: "under",
      line: 70,
      oddsTaken: 2,
      oddsTakenLabel: "+100",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const over70: RoundScoreBet = { ...under70, id: "b2", side: "over" };
    const under65: RoundScoreBet = { ...under70, id: "b3", line: 65 };

    expect((await settleBetFromOrchestrator(under70)).won).toBe(true); // 68 < 70
    expect((await settleBetFromOrchestrator(over70)).won).toBe(false); // 68 !> 70
    expect((await settleBetFromOrchestrator(under65)).won).toBe(false); // 68 !< 65
  });

  it("returns settled:false when the leaderboard hasn't landed as final yet", async () => {
    // Mid-tournament state — some players still in-progress.
    mockLb.mockResolvedValue([
      lbRow({ playerId: "fox", position: "1", thru: "12", currentRound: 4, playerState: "ACTIVE" }),
      lbRow({ playerId: "young", position: "T2", thru: "F", currentRound: 4, playerState: "ACTIVE" }),
    ]);
    const bet = baseBet<OutrightBet>({
      id: "b",
      kind: "outright",
      playerId: "fox",
      playerName: "Ryan Fox",
      oddsTaken: 40,
      oddsTakenLabel: "+3900",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const res = await settleBetFromOrchestrator(bet);
    expect(res.settled).toBe(false);
    expect(res.reason).toBe("orch:not-yet-final");
  });

  it("returns settled:false when the leaderboard is empty", async () => {
    mockLb.mockResolvedValue([]);
    const bet = baseBet<OutrightBet>({
      id: "b",
      kind: "outright",
      playerId: "fox",
      playerName: "Ryan Fox",
      oddsTaken: 40,
      oddsTakenLabel: "+3900",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const res = await settleBetFromOrchestrator(bet);
    expect(res.settled).toBe(false);
    expect(res.reason).toBe("orch:no-leaderboard");
  });

  it("settles 'without X' as won when Y has lowest total excluding X", async () => {
    // Scheffler wins outright at -20; Rory 2nd at -16. Rory-without-Scheffler wins.
    mockLb.mockResolvedValue([
      lbRow({ playerId: "scheffler", position: "1", total: "-20" }),
      lbRow({ playerId: "rory", position: "2", total: "-16" }),
      lbRow({ playerId: "young", position: "T3", total: "-14" }),
      lbRow({ playerId: "burns", position: "T3", total: "-14" }),
      lbRow({ playerId: "cutguy", position: "T85", total: "+8", thru: "-", currentRound: 2 }),
    ]);
    const bet = baseBet<WithoutBet>({
      id: "b",
      kind: "without",
      playerId: "rory",
      playerName: "Rory McIlroy",
      withoutPlayerId: "scheffler",
      withoutPlayerName: "Scottie Scheffler",
      oddsTaken: 5,
      oddsTakenLabel: "+400",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    expect(await settleBetFromOrchestrator(bet)).toEqual({
      settled: true,
      won: true,
      reason: "orch:without",
    });
  });

  it("settles 'without X' dead-heat correctly (both tied non-X players win)", async () => {
    // Scheffler solo 1st; Rory + Young tie at -18
    mockLb.mockResolvedValue([
      lbRow({ playerId: "scheffler", position: "1", total: "-20" }),
      lbRow({ playerId: "rory", position: "T2", total: "-18" }),
      lbRow({ playerId: "young", position: "T2", total: "-18" }),
    ]);
    const rory = baseBet<WithoutBet>({
      id: "b1",
      kind: "without",
      playerId: "rory",
      playerName: "Rory",
      withoutPlayerId: "scheffler",
      withoutPlayerName: "Scheffler",
      oddsTaken: 5,
      oddsTakenLabel: "+400",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    const young = { ...rory, id: "b2", playerId: "young" };
    const scheffler = { ...rory, id: "b3", playerId: "scheffler" }; // absurd but should lose
    expect((await settleBetFromOrchestrator(rory)).won).toBe(true);
    expect((await settleBetFromOrchestrator(young)).won).toBe(true);
    expect((await settleBetFromOrchestrator(scheffler)).won).toBe(false);
  });

  it("settles 'without X' when Y wins outright (X irrelevant)", async () => {
    // Rory wins the tournament, Scheffler is 2nd. Rory-without-Scheffler still wins.
    mockLb.mockResolvedValue([
      lbRow({ playerId: "rory", position: "1", total: "-20" }),
      lbRow({ playerId: "scheffler", position: "2", total: "-18" }),
    ]);
    const bet = baseBet<WithoutBet>({
      id: "b",
      kind: "without",
      playerId: "rory",
      playerName: "Rory",
      withoutPlayerId: "scheffler",
      withoutPlayerName: "Scheffler",
      oddsTaken: 5,
      oddsTakenLabel: "+400",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    expect((await settleBetFromOrchestrator(bet)).won).toBe(true);
  });

  it("'without X' Y outside top of the non-X pool loses", async () => {
    mockLb.mockResolvedValue([
      lbRow({ playerId: "scheffler", position: "1", total: "-20" }),
      lbRow({ playerId: "rory", position: "2", total: "-16" }),
      lbRow({ playerId: "young", position: "3", total: "-14" }),
    ]);
    const bet = baseBet<WithoutBet>({
      id: "b",
      kind: "without",
      playerId: "young",
      playerName: "Young",
      withoutPlayerId: "scheffler",
      withoutPlayerName: "Scheffler",
      oddsTaken: 20,
      oddsTakenLabel: "+1900",
      stake: 10,
      placedAt: 0,
      settledAt: null,
      settledWon: null,
    });
    expect((await settleBetFromOrchestrator(bet)).won).toBe(false);
  });
});
