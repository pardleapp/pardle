/**
 * /demo/insights — Fixture-driven showcase of the "What needs to
 * happen" bet-insight card across every bet kind and every status.
 *
 * No live data, no saved bets, no auth — pure server render against
 * hand-crafted leaderboard / round-state / projection fixtures that
 * exercise each branch of computeBetInsight().
 *
 * Lives outside /live on purpose so it can't accidentally ship into
 * the production nav. Delete the directory once we've eyeballed the
 * copy with real mid-round data (Charles Schwab, Thu morning).
 */

import {
  computeBetInsight,
  type BetInsight,
  type SgBreakdown,
} from "@/lib/feed/bet-insights";
import type {
  OutrightBet,
  PlayerRoundState,
  RoundScoreBet,
  RoundSnapshot,
  TopFinishBet,
  TournamentProjection,
  TrackedBet,
  WinningScoreBet,
} from "@/app/live/bet-shared";

interface LeaderboardRow {
  playerId: string;
  displayName: string;
  position: string;
  total: string;
  thru: string;
  playerState?: string;
}

interface Scenario {
  title: string;
  bet: TrackedBet;
  leaderboard: LeaderboardRow[];
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
  playerSgBreakdown?: Record<string, SgBreakdown>;
  fieldHoleStats?: Record<
    number,
    Record<number, { mean: number; count: number }>
  >;
  tournamentPars?: Record<number, Record<number, number>>;
}

/** Build a fake Charles Schwab-ish par layout (18 holes, par 70). */
function fakeParLayout(): Record<number, number> {
  // par-3s at 4, 8, 13, 16 (total -4 from par 4); par-5s at 1, 11 (+2)
  const pars: Record<number, number> = {};
  for (let h = 1; h <= 18; h++) {
    if (h === 1 || h === 11) pars[h] = 5;
    else if (h === 4 || h === 8 || h === 13 || h === 16) pars[h] = 3;
    else pars[h] = 4;
  }
  return pars;
}

/** Build a fake field-stats map for one round.
 *  `easyHoles` get a -0.3 mean (playing well under par),
 *  `hardHoles` get a +0.25 mean,
 *  the rest float around 0. */
function fakeFieldStats(args: {
  easyHoles?: number[];
  hardHoles?: number[];
  count?: number;
}): Record<number, { mean: number; count: number }> {
  const count = args.count ?? 60;
  const easy = new Set(args.easyHoles ?? []);
  const hard = new Set(args.hardHoles ?? []);
  const out: Record<number, { mean: number; count: number }> = {};
  for (let h = 1; h <= 18; h++) {
    let mean = 0.02 + (h % 5) * 0.01 - 0.04; // jitter near zero
    if (easy.has(h)) mean = -0.32;
    if (hard.has(h)) mean = 0.28;
    out[h] = { mean, count };
  }
  return out;
}

function sg(args: Partial<SgBreakdown> & { total?: number | null }): SgBreakdown {
  return {
    total: args.total ?? null,
    ott: args.ott ?? null,
    app: args.app ?? null,
    arg: args.arg ?? null,
    putt: args.putt ?? null,
  };
}

// ── Fixture helpers ───────────────────────────────────────────────

const NOW = Date.UTC(2026, 4, 21, 14, 30); // pretend it's Thu PM at Colonial

/** Synth a RoundSnapshot in-progress mid-round. */
function inProgress(args: {
  holesPlayed: number;
  strokes: number;
  parPlayed: number;
  parRemaining: number;
  roundPar?: number;
}): RoundSnapshot {
  const roundPar = args.roundPar ?? 70;
  return {
    holesPlayed: args.holesPlayed,
    holesRemaining: 18 - args.holesPlayed,
    strokes: args.strokes,
    parPlayed: args.parPlayed,
    parRemaining: args.parRemaining,
    roundPar,
    toPar: args.strokes - args.parPlayed,
    status: "in-progress",
  };
}

function notStarted(roundPar = 70): RoundSnapshot {
  return {
    holesPlayed: 0,
    holesRemaining: 18,
    strokes: 0,
    parPlayed: 0,
    parRemaining: roundPar,
    roundPar,
    toPar: 0,
    status: "not-started",
  };
}

function completeR(strokes: number, roundPar = 70): RoundSnapshot {
  return {
    holesPlayed: 18,
    holesRemaining: 0,
    strokes,
    parPlayed: roundPar,
    parRemaining: 0,
    roundPar,
    toPar: strokes - roundPar,
    status: "complete",
  };
}

function playerState(args: {
  currentRound: number;
  rounds: Partial<Record<number, RoundSnapshot>>;
}): PlayerRoundState {
  const r = args.rounds[args.currentRound] ?? inProgress({
    holesPlayed: 0,
    strokes: 0,
    parPlayed: 0,
    parRemaining: 70,
  });
  return {
    currentRound: args.currentRound,
    holesPlayed: r.holesPlayed,
    holesRemaining: r.holesRemaining,
    strokes: r.strokes,
    parPlayed: r.parPlayed,
    parRemaining: r.parRemaining,
    roundPar: r.roundPar,
    toPar: r.toPar,
    ttdPacePerHole: r.holesPlayed > 0 ? r.toPar / r.holesPlayed : 0,
    ttdHoles: r.holesPlayed,
    rounds: args.rounds as Record<number, RoundSnapshot>,
  };
}

function outrightBet(args: {
  playerId: string;
  playerName: string;
  odds?: number;
  stake?: number;
}): OutrightBet {
  return {
    id: `demo-${args.playerId}`,
    kind: "outright",
    playerId: args.playerId,
    playerName: args.playerName,
    oddsTaken: args.odds ?? 16,
    oddsTakenLabel: `+${Math.round(((args.odds ?? 16) - 1) * 100)}`,
    stake: args.stake ?? 50,
    placedAt: NOW - 36 * 3600 * 1000,
  };
}

function topFinishBet(args: {
  playerId: string;
  playerName: string;
  cutoff: 5 | 10 | 20;
}): TopFinishBet {
  return {
    id: `demo-tf-${args.playerId}-${args.cutoff}`,
    kind: "top-finish",
    playerId: args.playerId,
    playerName: args.playerName,
    cutoff: args.cutoff,
    oddsTaken: 4.5,
    oddsTakenLabel: "+350",
    stake: 25,
    placedAt: NOW - 36 * 3600 * 1000,
  };
}

function roundScoreBet(args: {
  playerId: string;
  playerName: string;
  round: number | null;
  line: number;
  side: "under" | "over";
}): RoundScoreBet {
  return {
    id: `demo-rs-${args.playerId}-${args.line}-${args.side}`,
    kind: "round-score",
    playerId: args.playerId,
    playerName: args.playerName,
    round: args.round,
    line: args.line,
    side: args.side,
    oddsTaken: 1.91,
    oddsTakenLabel: "-110",
    stake: 20,
    placedAt: NOW - 6 * 3600 * 1000,
  };
}

function winningScoreBet(args: {
  line: number;
  side: "under" | "over";
}): WinningScoreBet {
  return {
    id: `demo-ws-${args.line}-${args.side}`,
    kind: "winning-score",
    line: args.line,
    side: args.side,
    oddsTaken: 1.91,
    oddsTakenLabel: "-110",
    stake: 30,
    placedAt: NOW - 36 * 3600 * 1000,
  };
}

// ── Scenarios ─────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  // ── Outright ──
  {
    title: "Outright · leading by 2",
    bet: outrightBet({ playerId: "p1", playerName: "Rory McIlroy", odds: 16 }),
    leaderboard: [
      { playerId: "p1", displayName: "Rory McIlroy", position: "1", total: "-10", thru: "5" },
      { playerId: "p2", displayName: "Scottie Scheffler", position: "T2", total: "-8", thru: "6" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 3,
        rounds: {
          1: completeR(67),
          2: completeR(68),
          3: inProgress({ holesPlayed: 5, strokes: 18, parPlayed: 19, parRemaining: 49 }),
        },
      }),
    },
    playerSgBreakdown: {
      p1: sg({ total: 2.8, ott: 1.4, app: 0.6, arg: 0.1, putt: 0.7 }),
      p2: sg({ total: 2.1, ott: 0.5, app: 1.2, arg: 0.2, putt: 0.2 }),
    },
  },
  {
    title: "Outright · 1 stroke back",
    bet: outrightBet({ playerId: "p1", playerName: "Jon Rahm", odds: 9 }),
    leaderboard: [
      { playerId: "p0", displayName: "Sahith Theegala", position: "1", total: "-9", thru: "14" },
      { playerId: "p1", displayName: "Jon Rahm", position: "T2", total: "-8", thru: "12" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 3,
        rounds: {
          1: completeR(66),
          2: completeR(69),
          3: inProgress({ holesPlayed: 12, strokes: 42, parPlayed: 43, parRemaining: 28 }),
        },
      }),
    },
    playerSgBreakdown: {
      p0: sg({ total: 2.2, ott: 0.4, app: 2.1, arg: 0.1, putt: -0.4 }),
      p1: sg({ total: 1.8, ott: 0.9, app: 0.3, arg: 0.2, putt: 0.4 }),
    },
  },
  {
    title: "Outright · 3 strokes back, 14 holes left",
    bet: outrightBet({ playerId: "p1", playerName: "Tommy Fleetwood", odds: 26 }),
    leaderboard: [
      { playerId: "p0", displayName: "Xander Schauffele", position: "1", total: "-7", thru: "8" },
      { playerId: "p1", displayName: "Tommy Fleetwood", position: "T9", total: "-4", thru: "4" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 3,
        rounds: {
          1: completeR(68),
          2: completeR(70),
          3: inProgress({ holesPlayed: 4, strokes: 14, parPlayed: 16, parRemaining: 54 }),
        },
      }),
    },
    playerSgBreakdown: {
      p0: sg({ total: 1.7, ott: 0.3, app: 0.6, arg: 0.2, putt: 0.6 }),
      p1: sg({ total: 0.8, ott: 0.5, app: 0.6, arg: 0.2, putt: -0.5 }),
    },
  },
  {
    title: "Outright · 6 back, R4 charge",
    bet: outrightBet({ playerId: "p1", playerName: "Wyndham Clark", odds: 41 }),
    leaderboard: [
      { playerId: "p0", displayName: "Collin Morikawa", position: "1", total: "-12", thru: "F" },
      { playerId: "p1", displayName: "Wyndham Clark", position: "T18", total: "-6", thru: "9" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 4,
        rounds: {
          1: completeR(70),
          2: completeR(68),
          3: completeR(67),
          4: inProgress({ holesPlayed: 9, strokes: 31, parPlayed: 32, parRemaining: 38 }),
        },
      }),
    },
  },

  // ── Top-finish ──
  {
    title: "Top 10 · inside with 4-stroke cushion",
    bet: topFinishBet({ playerId: "p1", playerName: "Patrick Cantlay", cutoff: 10 }),
    leaderboard: [
      { playerId: "p0", displayName: "Leader", position: "1", total: "-11", thru: "F" },
      { playerId: "p1", displayName: "Patrick Cantlay", position: "T5", total: "-8", thru: "F" },
      { playerId: "p2", displayName: "Tyrrell Hatton", position: "T11", total: "-4", thru: "F" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 4,
        rounds: {
          1: completeR(68),
          2: completeR(70),
          3: completeR(69),
          4: inProgress({ holesPlayed: 12, strokes: 41, parPlayed: 42, parRemaining: 28 }),
        },
      }),
    },
  },
  {
    title: "Top 5 · 1 stroke off cut",
    bet: topFinishBet({ playerId: "p1", playerName: "Justin Thomas", cutoff: 5 }),
    leaderboard: [
      { playerId: "p0", displayName: "Leader", position: "1", total: "-10", thru: "F" },
      { playerId: "p_cut", displayName: "Akshay Bhatia", position: "T5", total: "-6", thru: "F" },
      { playerId: "p1", displayName: "Justin Thomas", position: "T7", total: "-5", thru: "F" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 4,
        rounds: {
          1: completeR(70),
          2: completeR(68),
          3: completeR(69),
          4: inProgress({ holesPlayed: 10, strokes: 35, parPlayed: 36, parRemaining: 34 }),
        },
      }),
    },
    playerSgBreakdown: {
      p_cut: sg({ total: 1.6, ott: 0.5, app: 0.4, arg: 0.3, putt: 0.4 }),
      p1: sg({ total: 1.1, ott: 0.6, app: 0.3, arg: 0.4, putt: -0.2 }),
    },
  },
  {
    title: "Top 10 · 4 strokes off, R4 fight",
    bet: topFinishBet({ playerId: "p1", playerName: "Brian Harman", cutoff: 10 }),
    leaderboard: [
      { playerId: "p0", displayName: "Leader", position: "1", total: "-13", thru: "F" },
      { playerId: "p_cut", displayName: "Sungjae Im", position: "T10", total: "-7", thru: "F" },
      { playerId: "p1", displayName: "Brian Harman", position: "T22", total: "-3", thru: "12" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 4,
        rounds: {
          1: completeR(72),
          2: completeR(68),
          3: completeR(71),
          4: inProgress({ holesPlayed: 12, strokes: 42, parPlayed: 43, parRemaining: 28 }),
        },
      }),
    },
    playerSgBreakdown: {
      p_cut: sg({ total: 1.4, ott: 0.4, app: 0.7, arg: 0.2, putt: 0.1 }),
      p1: sg({ total: 0.3, ott: 0.7, app: -0.6, arg: 0.4, putt: -0.2 }),
    },
  },

  // ── Round-score ──
  {
    title: "Round-score · Under 70.5, R3 not started",
    bet: roundScoreBet({
      playerId: "p1",
      playerName: "Hideki Matsuyama",
      round: 3,
      line: 70.5,
      side: "under",
    }),
    leaderboard: [
      { playerId: "p1", displayName: "Hideki Matsuyama", position: "T8", total: "-5", thru: "—" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 3,
        rounds: { 1: completeR(67), 2: completeR(70), 3: notStarted() },
      }),
    },
    fieldHoleStats: {
      3: fakeFieldStats({ easyHoles: [1, 11, 18], hardHoles: [12, 17] }),
    },
    tournamentPars: { 3: fakeParLayout() },
  },
  {
    title: "Round-score · Under 68, thru 12 — needs 1 birdie",
    bet: roundScoreBet({
      playerId: "p1",
      playerName: "Joaquin Niemann",
      round: 3,
      line: 68,
      side: "under",
    }),
    leaderboard: [
      { playerId: "p1", displayName: "Joaquin Niemann", position: "T4", total: "-7", thru: "12" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 3,
        rounds: {
          1: completeR(67),
          2: completeR(68),
          // Thru 12 at 44 strokes (par 48 thru → -4 thru); needs 23 more on 6 holes
          // (one under par avg) to come in under 68. One birdie + pars does it.
          3: inProgress({ holesPlayed: 12, strokes: 44, parPlayed: 48, parRemaining: 22 }),
        },
      }),
    },
    // Easiest remaining: par-5 13... wait, hole 13 is a par-3. Easiest
    // remaining are 14 (par 4 playing easy) and 18 (par 4 playing easy).
    fieldHoleStats: {
      3: fakeFieldStats({ easyHoles: [14, 18], hardHoles: [17] }),
    },
    tournamentPars: { 3: fakeParLayout() },
  },
  {
    title: "Round-score · Under 67, already over budget",
    bet: roundScoreBet({
      playerId: "p1",
      playerName: "Shane Lowry",
      round: 3,
      line: 67,
      side: "under",
    }),
    leaderboard: [
      { playerId: "p1", displayName: "Shane Lowry", position: "T15", total: "-2", thru: "14" },
    ],
    playerRoundStates: {
      p1: playerState({
        currentRound: 3,
        rounds: {
          1: completeR(68),
          2: completeR(69),
          // Already 67 strokes thru 14 → can't finish under 67 (would need 4 holes in -1 total
          // which is impossible if already at par on remaining).
          3: inProgress({ holesPlayed: 14, strokes: 67, parPlayed: 56, parRemaining: 14 }),
        },
      }),
    },
    fieldHoleStats: {
      3: fakeFieldStats({ easyHoles: [18], hardHoles: [15, 17] }),
    },
    tournamentPars: { 3: fakeParLayout() },
  },

  // ── Winning-score ──
  {
    title: "Winning score · Under 270.5, projection 268",
    bet: winningScoreBet({ line: 270.5, side: "under" }),
    leaderboard: [
      { playerId: "leader", displayName: "Scottie Scheffler", position: "1", total: "-12", thru: "11" },
    ],
    playerRoundStates: {
      leader: playerState({
        currentRound: 4,
        rounds: { 4: inProgress({ holesPlayed: 11, strokes: 38, parPlayed: 40, parRemaining: 29 }) },
      }),
    },
    tournamentProjections: { leader: { mean: 268.2, variance: 5, active: true } },
  },
  {
    title: "Winning score · Over 270.5, projection 268 (long shot)",
    bet: winningScoreBet({ line: 270.5, side: "over" }),
    leaderboard: [
      { playerId: "leader", displayName: "Ludvig Aberg", position: "1", total: "-12", thru: "11" },
    ],
    playerRoundStates: {
      leader: playerState({
        currentRound: 4,
        rounds: { 4: inProgress({ holesPlayed: 11, strokes: 38, parPlayed: 40, parRemaining: 29 }) },
      }),
    },
    tournamentProjections: { leader: { mean: 268.2, variance: 5, active: true } },
  },
];

function InsightCard({ insight }: { insight: BetInsight }) {
  return (
    <div className={`bd-insight bd-insight-${insight.status}`}>
      <p className="bd-insight-label">What needs to happen</p>
      <p className="bd-insight-headline">{insight.headline}</p>
      {insight.hint && <p className="bd-insight-hint">{insight.hint}</p>}
    </div>
  );
}

export default function InsightsDemoPage() {
  const results = SCENARIOS.map((s) => ({
    scenario: s,
    insight: computeBetInsight({
      bet: s.bet,
      leaderboard: s.leaderboard,
      playerRoundStates: s.playerRoundStates,
      tournamentProjections: s.tournamentProjections,
      playerSgBreakdown: s.playerSgBreakdown,
      fieldHoleStats: s.fieldHoleStats,
      tournamentPars: s.tournamentPars,
    }),
  }));

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 60px" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>
        Insight card · fixture showcase
      </h1>
      <p style={{ margin: "0 0 24px", color: "var(--muted)", fontSize: 13 }}>
        Hand-crafted leaderboard / round-state fixtures so we can eyeball the
        "what needs to happen" copy without a live tournament. Delete this
        route once Charles Schwab is over and we've checked it against real
        mid-round data.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {results.map(({ scenario, insight }, i) => (
          <section key={i}>
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 13,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--muted)",
              }}
            >
              {scenario.title}
            </h2>
            {insight ? (
              <InsightCard insight={insight} />
            ) : (
              <div
                style={{
                  padding: 14,
                  border: "1px dashed var(--border)",
                  borderRadius: 10,
                  fontSize: 13,
                  color: "var(--muted)",
                  fontStyle: "italic",
                }}
              >
                computeBetInsight returned null — check fixture.
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
