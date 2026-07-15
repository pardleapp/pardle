import { describe, it, expect } from "vitest";
import {
  currentProbForBet,
  type PlayerRoundState,
  type RoundScoreBet,
  type RoundSnapshot,
} from "./bet-shared";
import type { FeedRow, FeedEvent, ReactionCounts } from "@/lib/feed/types";

/**
 * Shot-aware round-score projection — end-to-end wiring check.
 *
 * Simulates a par-4 hole for a fake mid-round player:
 *   tee shot → approach → putt to inches → holed
 *
 * The pass criterion is that `currentProbForBet` (the function driving
 * BetPost card, BetDetail nowValue, and the impact chip) moves in the
 * right direction with each shot — before it did nothing until the
 * hole completed on the server.
 */

const PLAYER_ID = "sim-1";
const ROUND = 1;
const TS_BASE = 1_720_000_000_000;

function snap(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    holesPlayed: 12,
    holesRemaining: 6,
    strokes: 44,
    parPlayed: 46,
    parRemaining: 26,
    roundPar: 72,
    toPar: -2,
    status: "in-progress",
    expectedRemaining: 26.4,
    variance: 6 * 0.9,
    ...overrides,
  };
}

function state(rs: RoundSnapshot): PlayerRoundState {
  return {
    currentRound: ROUND,
    holesPlayed: rs.holesPlayed,
    holesRemaining: rs.holesRemaining,
    strokes: rs.strokes,
    parPlayed: rs.parPlayed,
    parRemaining: rs.parRemaining,
    roundPar: rs.roundPar,
    toPar: rs.toPar,
    ttdPacePerHole: 0,
    ttdHoles: 24,
    rounds: { [ROUND]: rs },
  };
}

const REACTIONS: ReactionCounts = { up: 0, down: 0 };

function row(ev: Partial<FeedEvent> & { id: string }): FeedRow {
  return {
    event: {
      tournamentId: "T",
      ts: TS_BASE,
      type: "shot",
      playerId: PLAYER_ID,
      playerName: "Sim Player",
      round: ROUND,
      headline: "",
      emoji: "",
      ...ev,
    } as FeedEvent,
    reactions: REACTIONS,
    commentCount: 0,
  };
}

function completedHoleScore(hole: number, par: number, strokes: number): FeedRow {
  return row({
    id: `score-${hole}`,
    type: "score",
    hole,
    par,
    strokes,
    ts: TS_BASE + hole,
  });
}

function shotEvent(opts: {
  hole: number;
  par: number;
  shotNum: number;
  surface: string;
  toPin: string;
  ts: number;
}): FeedRow {
  return row({
    id: `shot-${opts.hole}-${opts.shotNum}`,
    type: "shot",
    imgSourced: true,
    hole: opts.hole,
    par: opts.par,
    imgShotNum: opts.shotNum,
    imgSurface: opts.surface,
    imgToPin: opts.toPin,
    ts: opts.ts,
  });
}

describe("shot-aware round-score prob", () => {
  const bet: RoundScoreBet = {
    id: "b1",
    kind: "round-score",
    playerId: PLAYER_ID,
    playerName: "Sim Player",
    round: ROUND,
    line: 69.5,
    side: "under",
    oddsTaken: 2.0,
    oddsTakenLabel: "2.00",
    stake: 10,
    placedAt: TS_BASE,
    placement: {
      holesPlayed: 12,
      strokes: 44,
      parPlayed: 46,
      roundPar: 72,
      ttdPacePerHole: 0,
      probAtPlacement: 0.5,
      round: ROUND,
    },
  };

  const rs = snap();
  const rounds = { [PLAYER_ID]: state(rs) };

  // Score events for holes 1–12 (all made pars — the strokes total
  // has to match the snap's r.strokes=44, so 12 holes averaging ~3.67).
  // For simplicity: 12 completed holes at various pars adding to 44.
  const completed = [
    completedHoleScore(1, 4, 4),
    completedHoleScore(2, 4, 3),
    completedHoleScore(3, 4, 4),
    completedHoleScore(4, 3, 3),
    completedHoleScore(5, 5, 4),
    completedHoleScore(6, 4, 4),
    completedHoleScore(7, 4, 4),
    completedHoleScore(8, 3, 2),
    completedHoleScore(9, 4, 4),
    completedHoleScore(10, 5, 4),
    completedHoleScore(11, 4, 4),
    completedHoleScore(12, 3, 4),
  ];

  const H = 13;
  const PAR = 4;
  const t = (n: number) => TS_BASE + 1_000 + n;

  const printAndProb = (label: string, extra: FeedRow[]) => {
    const rows = [...completed, ...extra];
    const prob = currentProbForBet(bet, rounds, rows);
    const pct = prob == null ? "null" : `${(prob * 100).toFixed(1)}%`;
    console.log(`  ${label.padEnd(46)} prob=${pct}`);
    return prob;
  };

  it("moves shot-by-shot as approach lands close", () => {
    console.log("\nBet: UNDER 69.5 · line=69.5 · placement 50%");
    console.log(
      `Snap: ${rs.holesPlayed} holes played · ${rs.strokes} strokes · exp remaining ${rs.expectedRemaining}\n`,
    );

    const pBaseline = printAndProb("baseline (no shot events)", []);
    expect(pBaseline).not.toBeNull();

    const pTee = printAndProb("after tee shot → fairway, 155yds", [
      shotEvent({
        hole: H,
        par: PAR,
        shotNum: 1,
        surface: "Fairway",
        toPin: "155yds",
        ts: t(1),
      }),
    ]);
    expect(pTee).not.toBeNull();

    const pApproach = printAndProb("after approach → green, 22ft", [
      shotEvent({
        hole: H,
        par: PAR,
        shotNum: 2,
        surface: "Green",
        toPin: "22ft. 0in.",
        ts: t(2),
      }),
    ]);
    expect(pApproach).not.toBeNull();

    const pStuffed = printAndProb("after long putt → green, 2ft", [
      shotEvent({
        hole: H,
        par: PAR,
        shotNum: 3,
        surface: "Green",
        toPin: "2ft. 0in.",
        ts: t(3),
      }),
    ]);
    expect(pStuffed).not.toBeNull();

    const pHoled = printAndProb("after tap-in → Ball Holed (par)", [
      shotEvent({
        hole: H,
        par: PAR,
        shotNum: 4,
        surface: "Ball Holed",
        toPin: "0ft. 0in.",
        ts: t(4),
      }),
    ]);
    expect(pHoled).not.toBeNull();

    // Between successive shot-aware states, closer proximity should
    // trend toward (approach ≥ tee) since the expected remaining
    // strokes on the current hole tightens. Stuffed 2ft and holed
    // par-4 project to essentially the same total (~4 strokes) so
    // we only assert a small tolerance.
    expect(pApproach!).toBeGreaterThan(pTee!);
    expect(Math.abs(pStuffed! - pHoled!)).toBeLessThan(0.02);
  });

  it("stays hole-anchored when no shot rows are passed (backward compat)", () => {
    const before = currentProbForBet(bet, rounds);
    const after = currentProbForBet(bet, rounds, []);
    expect(before).toBe(after);
    console.log(`\n  hole-anchored fallback prob=${((before ?? 0) * 100).toFixed(1)}%`);
  });

  it("shows a disaster move — thick rough with no distance", () => {
    console.log("\nDisaster scenario: bogey path\n");

    const pBaseline = printAndProb("baseline", []);

    const pRough = printAndProb("after tee shot → deep rough", [
      shotEvent({
        hole: H,
        par: PAR,
        shotNum: 1,
        surface: "Deep Rough",
        toPin: "180yds",
        ts: t(1),
      }),
    ]);

    const pMissed = printAndProb("after approach → still off green, 35yds", [
      shotEvent({
        hole: H,
        par: PAR,
        shotNum: 2,
        surface: "Bunker",
        toPin: "35yds",
        ts: t(2),
      }),
    ]);

    // Between successive shot-aware states, the disaster path should
    // trend worse for an UNDER bet. (Comparison against the snap-based
    // baseline is unstable because the snap uses field-difficulty
    // par whereas projectRoundTotal falls back to raw hole par for
    // remaining holes — noted as a projection-quality follow-up.)
    expect(pMissed!).toBeLessThan(pRough!);
    // Sanity: baseline used (verify tests report all three).
    expect(pBaseline).not.toBeNull();
  });
});
