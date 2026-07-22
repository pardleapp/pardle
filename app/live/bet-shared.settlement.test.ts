import { describe, expect, it } from "vitest";
import {
  findOutrightWinner,
  detectBetSettlement,
  type PlayerForSettlement,
  type PlayerRoundState,
} from "./bet-shared";
import type { OutrightBet } from "./bet-shared";

function rs(currentRound: number, holesRemaining: number): PlayerRoundState {
  return {
    currentRound,
    holesPlayed: 18 - holesRemaining,
    holesRemaining,
    strokes: 0,
    parPlayed: 0,
    parRemaining: 0,
    roundPar: 72,
    toPar: 0,
    ttdPacePerHole: 0,
    ttdHoles: 0,
    rounds: {},
  };
}

function p(playerId: string, position: string, thru: string): PlayerForSettlement {
  return { playerId, position, thru };
}

const outrightBet: OutrightBet = {
  id: "bet-1",
  kind: "outright",
  playerId: "scheffler",
  playerName: "Scottie Scheffler",
  oddsTaken: 6,
  oddsTakenLabel: "+500",
  stake: 10,
  placedAt: 0,
  settledAt: null,
  settledWon: null,
};

describe("findOutrightWinner — round-aware leaderboard finality", () => {
  it("does NOT settle when every player finished R1 only (the Memorial bug)", () => {
    // End of R1: everyone shows thru="F" but currentRound is 1.
    const players: PlayerForSettlement[] = [
      p("scheffler", "T1", "F"),
      p("morikawa", "T1", "F"),
      p("rory", "T3", "F"),
    ];
    const states: Record<string, PlayerRoundState> = {
      scheffler: rs(1, 0),
      morikawa: rs(1, 0),
      rory: rs(1, 0),
    };
    expect(findOutrightWinner(players, states)).toBeNull();
    expect(detectBetSettlement(outrightBet, players, states, {})).toBeNull();
  });

  it("does NOT settle at the end of R2", () => {
    const players = [
      p("scheffler", "1", "F"),
      p("morikawa", "T2", "F"),
    ];
    const states = {
      scheffler: rs(2, 0),
      morikawa: rs(2, 0),
    };
    expect(findOutrightWinner(players, states)).toBeNull();
  });

  it("does NOT settle mid-R4 when the leader is sole '1' thru F but another player still has holes", () => {
    const players = [
      p("scheffler", "1", "F"),
      p("rory", "T2", "16"),
    ];
    const states = {
      scheffler: rs(4, 0),
      rory: rs(4, 2),
    };
    expect(findOutrightWinner(players, states)).toBeNull();
  });

  it("settles at the end of R4 when every active player is done with the final round", () => {
    const players = [
      p("scheffler", "1", "F"),
      p("morikawa", "T2", "F"),
      p("rory", "T2", "F"),
    ];
    const states = {
      scheffler: rs(4, 0),
      morikawa: rs(4, 0),
      rory: rs(4, 0),
    };
    expect(findOutrightWinner(players, states)).toBe("scheffler");
    const decision = detectBetSettlement(outrightBet, players, states, {});
    expect(decision).toEqual({ won: true });
  });

  it("settles a tied 1st co-winner backer as won (dead-heat)", () => {
    const players = [
      p("scheffler", "T1", "F"),
      p("morikawa", "T1", "F"),
      p("rory", "T3", "F"),
    ];
    const states = {
      scheffler: rs(4, 0),
      morikawa: rs(4, 0),
      rory: rs(4, 0),
    };
    const decision = detectBetSettlement(outrightBet, players, states, {});
    expect(decision).toEqual({ won: true });
  });

  it("settles a non-winner as lost once the leaderboard is final", () => {
    const players = [
      p("scheffler", "T7", "F"),
      p("morikawa", "1", "F"),
    ];
    const states = {
      scheffler: rs(4, 0),
      morikawa: rs(4, 0),
    };
    const decision = detectBetSettlement(outrightBet, players, states, {});
    expect(decision).toEqual({ won: false });
  });

  it("ignores inactive (CUT/WD) players when checking finality", () => {
    const players: PlayerForSettlement[] = [
      { playerId: "scheffler", position: "1", thru: "F" },
      { playerId: "morikawa", position: "T2", thru: "F" },
      { playerId: "cuthim", position: "—", thru: "—", playerState: "CUT" },
    ];
    const states = {
      scheffler: rs(4, 0),
      morikawa: rs(4, 0),
    };
    expect(findOutrightWinner(players, states)).toBe("scheffler");
  });

  // Post-tournament state: some hours after the winner's final putt
  // the PGA Tour orchestrator flips every player's playerState to
  // "COMPLETE" (winners AND cut players alike) and shifts cut/WD
  // players' thru from "F"/"—" to plain "-". The Open 2026 bets sat
  // unsettled all week because the pre-fix isLeaderboardFinal
  // required INACTIVE playerState to skip a row, and "COMPLETE" was
  // treated as active + non-"F" thru → false forever.
  it("settles when every player is post-tournament COMPLETE (winner=F, cuts='-')", () => {
    const players: PlayerForSettlement[] = [
      { playerId: "fox", position: "1", thru: "F", playerState: "COMPLETE" },
      { playerId: "young", position: "2", thru: "F", playerState: "COMPLETE" },
      { playerId: "cutguy1", position: "—", thru: "-", playerState: "COMPLETE" },
      { playerId: "cutguy2", position: "—", thru: "-", playerState: "COMPLETE" },
      { playerId: "wdguy", position: "—", thru: "-", playerState: "WITHDRAWN" },
    ];
    const states = {
      fox: rs(4, 0),
      young: rs(4, 0),
      // Cut / WD players don't need R4 state — they're skipped by the
      // thru="-" check.
    };
    expect(findOutrightWinner(players, states)).toBe("fox");
    const foxBet: OutrightBet = { ...outrightBet, playerId: "fox" };
    expect(detectBetSettlement(foxBet, players, states, {})).toEqual({ won: true });
    const youngBet: OutrightBet = { ...outrightBet, playerId: "young" };
    expect(detectBetSettlement(youngBet, players, states, {})).toEqual({ won: false });
  });

  it("still guards R1 finality when playerState='COMPLETE' is bogus early", () => {
    // Defensive: if the orchestrator ever emitted COMPLETE at end of
    // R1 (it doesn't, but this pins the invariant), thru="F" alone
    // must not flip settlement — the currentRound gate is what stops
    // it.
    const players: PlayerForSettlement[] = [
      { playerId: "scheffler", position: "T1", thru: "F", playerState: "COMPLETE" },
      { playerId: "morikawa", position: "T1", thru: "F", playerState: "COMPLETE" },
    ];
    const states = {
      scheffler: rs(1, 0),
      morikawa: rs(1, 0),
    };
    expect(findOutrightWinner(players, states)).toBeNull();
  });

  it("returns false while any leaderboard row has missing round-state (bundle race)", () => {
    // Two players thru F, but only one has a round-state entry. We
    // conservatively return false so the next cron tick re-runs; a
    // false positive here would settle an outright at the end of R1.
    const players: PlayerForSettlement[] = [
      { playerId: "fox", position: "1", thru: "F", playerState: "COMPLETE" },
      { playerId: "young", position: "2", thru: "F", playerState: "COMPLETE" },
    ];
    const states = { fox: rs(4, 0) };
    expect(findOutrightWinner(players, states)).toBeNull();
  });
});
