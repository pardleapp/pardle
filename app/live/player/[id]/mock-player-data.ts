/**
 * Mock player data — verbatim from the design-handoff prototype's
 * PLAYER_DATA / SEASON / PAR / HOLE_AVG / SC_DELTAS / SEASON_SG
 * constants in Pardle Social v2.html.
 *
 * Used for the first cut of the redesigned player page so the
 * layout is exact end-to-end. Real wiring (orchestrator scorecards
 * + DataGolf SG) lands in a follow-up; the shapes here are the
 * contract the real data layer will populate.
 */

export interface PlayerHoleChip {
  /** Hole number (display string — "13", "14", …). */
  hole: string;
  /** Result code — B birdie, E eagle, P par, Bo bogey. */
  code: "B" | "E" | "P" | "Bo";
}

export interface PlayerLiveSgRound {
  label: string; // R1 / R2 / R3 / R4
  value: string; // signed Plex Mono ("+0.4", "−0.6")
}

export interface PlayerLiveSg {
  num: string;
  meta: string;
  rounds: PlayerLiveSgRound[];
}

export interface PlayerSgRow {
  label: string;
  value: string;
  rank: string;
  tier: "elite" | "good" | "mid" | "poor";
}

export interface PlayerAdvancedRow {
  label: string;
  value: string;
  rank: string;
  tier: "elite" | "good" | "mid" | "poor";
}

export interface PlayerFormEvent {
  t: string;
  season: number;
  fin: string;
  /** Numeric finish position for the bar chart; 0 = missed cut. */
  pos: number;
  /** Round scores. */
  rds: number[];
  sgTotal: string;
  keystat: string;
  note: string;
}

export interface PlayerGroupBet {
  initials: string;
  name: string;
  description: string;
}

export interface PlayerMockEntry {
  init: string;
  pos: string;
  total: string;
  thru: string;
  today: string;
  hand: "hot" | "cold" | null;
  backing: number | null;
  holes: PlayerHoleChip[];
  liveSg: PlayerLiveSg | null;
  sg: PlayerSgRow[];
  advanced: PlayerAdvancedRow[];
  form: PlayerFormEvent[];
  groupBets: PlayerGroupBet[];
}

export interface PlayerSeasonStats {
  events: number;
  wins: number;
  top10: number;
  cuts: string;
  avg: string;
  sg: string;
}

/**
 * Unicode-minus aware parseFloat — the prototype's labels use U+2212
 * "−" for negative SG / score values; raw parseFloat returns NaN.
 * Normalises U+2212 and U+2013 (en-dash) to ASCII "-" before parsing.
 */
export function pf(s: string | number): number {
  if (typeof s === "number") return s;
  return parseFloat(String(s).replace(/[−–]/g, "-"));
}

export const PLAYER_DATA: Record<string, PlayerMockEntry> = {
  "R. Henley": {
    init: "RH",
    pos: "1",
    total: "−12",
    thru: "F",
    today: "−4",
    hand: "hot",
    backing: 62,
    holes: [
      { hole: "13", code: "Bo" },
      { hole: "14", code: "P" },
      { hole: "15", code: "B" },
      { hole: "16", code: "P" },
      { hole: "17", code: "B" },
      { hole: "18", code: "B" },
    ],
    liveSg: {
      num: "+3.1",
      meta: "across 18 holes · 2nd of 71",
      rounds: [
        { label: "R1", value: "+0.4" },
        { label: "R2", value: "+1.2" },
        { label: "R3", value: "+0.7" },
        { label: "R4", value: "+0.8" },
      ],
    },
    sg: [
      { label: "Off the tee", value: "+0.9", rank: "12th", tier: "good" },
      { label: "Approach", value: "+1.8", rank: "2nd", tier: "elite" },
      { label: "Around green", value: "+0.4", rank: "24th", tier: "mid" },
      { label: "Putting", value: "+1.1", rank: "6th", tier: "good" },
    ],
    advanced: [
      { label: "Driving dist", value: "305 yds", rank: "8th", tier: "good" },
      { label: "Driving acc", value: "64%", rank: "22nd", tier: "mid" },
      { label: "GIR", value: "78%", rank: "5th", tier: "good" },
      { label: "Scrambling", value: "61%", rank: "15th", tier: "good" },
      { label: "Prox · fairway", value: "33 ft", rank: "9th", tier: "good" },
      { label: "Prox · rough", value: "48 ft", rank: "19th", tier: "mid" },
    ],
    form: [
      {
        t: "Travelers",
        season: 2025,
        fin: "T4",
        pos: 4,
        rds: [66, 68, 67, 69],
        sgTotal: "+6.2",
        keystat: "Approach +3.1 · Putting +1.8",
        note: "In the mix all week; a closing 69 left him a shot outside the playoff.",
      },
      {
        t: "the Memorial",
        season: 2025,
        fin: "1",
        pos: 1,
        rds: [67, 66, 70, 68],
        sgTotal: "+9.4",
        keystat: "Tee-to-green +7.0",
        note: "Elite ball-striking carried him to a one-shot win.",
      },
      {
        t: "PGA Championship",
        season: 2025,
        fin: "T12",
        pos: 12,
        rds: [71, 70, 72, 69],
        sgTotal: "+3.1",
        keystat: "Putting −0.6",
        note: "Solid, but the putter never warmed up on slow major greens.",
      },
      {
        t: "Wells Fargo",
        season: 2025,
        fin: "T8",
        pos: 8,
        rds: [69, 71, 68, 70],
        sgTotal: "+4.0",
        keystat: "Off the tee +2.2",
        note: "Drove it beautifully; a Sunday three-putt stretch cost a top 5.",
      },
      {
        t: "Masters",
        season: 2025,
        fin: "MC",
        pos: 0,
        rds: [75, 74],
        sgTotal: "−2.3",
        keystat: "Around green −1.9",
        note: "Short game let him down at Augusta — missed the cut by two.",
      },
      {
        t: "Houston Open",
        season: 2025,
        fin: "2",
        pos: 2,
        rds: [65, 68, 67, 66],
        sgTotal: "+8.1",
        keystat: "Putting +3.4",
        note: "Hot putter all week; lost in a playoff.",
      },
    ],
    groupBets: [
      { initials: "JO", name: "Jordan", description: "Outright · £50" },
      { initials: "MI", name: "Mia", description: "—" },
    ],
  },
  "A. Smalley": {
    init: "AS",
    pos: "T3",
    total: "−11",
    thru: "F",
    today: "−6",
    hand: "hot",
    backing: 41,
    holes: [
      { hole: "13", code: "P" },
      { hole: "14", code: "B" },
      { hole: "15", code: "P" },
      { hole: "16", code: "P" },
      { hole: "17", code: "B" },
      { hole: "18", code: "B" },
    ],
    liveSg: {
      num: "+2.6",
      meta: "across 18 holes · 5th of 71",
      rounds: [
        { label: "R1", value: "+0.2" },
        { label: "R2", value: "+0.5" },
        { label: "R3", value: "+0.7" },
        { label: "R4", value: "+1.2" },
      ],
    },
    sg: [
      { label: "Off the tee", value: "+0.5", rank: "28th", tier: "mid" },
      { label: "Approach", value: "+1.2", rank: "9th", tier: "good" },
      { label: "Around green", value: "+0.7", rank: "11th", tier: "good" },
      { label: "Putting", value: "+0.6", rank: "17th", tier: "mid" },
    ],
    advanced: [
      { label: "Driving dist", value: "292 yds", rank: "40th", tier: "mid" },
      { label: "Driving acc", value: "71%", rank: "6th", tier: "good" },
      { label: "GIR", value: "74%", rank: "12th", tier: "good" },
      { label: "Scrambling", value: "66%", rank: "7th", tier: "good" },
      { label: "Prox · fairway", value: "34 ft", rank: "14th", tier: "mid" },
      { label: "Prox · rough", value: "50 ft", rank: "24th", tier: "mid" },
    ],
    form: [
      {
        t: "Travelers",
        season: 2025,
        fin: "T22",
        pos: 22,
        rds: [70, 71, 69, 72],
        sgTotal: "+1.1",
        keystat: "Approach +1.4",
        note: "Steady but never threatened the lead.",
      },
      {
        t: "the Memorial",
        season: 2025,
        fin: "MC",
        pos: 0,
        rds: [74, 73],
        sgTotal: "−1.8",
        keystat: "Off the tee −1.2",
        note: "Wayward driving cost him the weekend.",
      },
      {
        t: "PGA Championship",
        season: 2025,
        fin: "T40",
        pos: 40,
        rds: [72, 71, 74, 71],
        sgTotal: "+0.3",
        keystat: "Putting +0.9",
        note: "Quietly made the cut on the number.",
      },
      {
        t: "Wells Fargo",
        season: 2025,
        fin: "T15",
        pos: 15,
        rds: [69, 70, 70, 68],
        sgTotal: "+2.4",
        keystat: "Around green +1.1",
        note: "Strong scrambling week kept him in it.",
      },
      {
        t: "Masters",
        season: 2025,
        fin: "MC",
        pos: 0,
        rds: [76, 73],
        sgTotal: "−2.6",
        keystat: "Putting −1.7",
        note: "Putter ice-cold at Augusta.",
      },
      {
        t: "Houston Open",
        season: 2025,
        fin: "T8",
        pos: 8,
        rds: [68, 69, 70, 67],
        sgTotal: "+4.3",
        keystat: "Tee-to-green +3.2",
        note: "Best ball-striking week of his season.",
      },
    ],
    groupBets: [
      { initials: "YO", name: "You", description: "Top 5 · £40" },
      { initials: "MI", name: "Mia", description: "Top 5 (tail)" },
    ],
  },
};

export const SEASON: Record<string, PlayerSeasonStats> = {
  "R. Henley": {
    events: 24,
    wins: 1,
    top10: 7,
    cuts: "83%",
    avg: "69.7",
    sg: "+1.6",
  },
  "A. Smalley": {
    events: 26,
    wins: 0,
    top10: 3,
    cuts: "69%",
    avg: "70.6",
    sg: "+0.7",
  },
};

export const SEASON_SG: Record<string, Array<[string, string]>> = {
  "R. Henley": [
    ["SG total", "+1.6"],
    ["Off the tee", "+0.4"],
    ["Approach", "+0.7"],
    ["Around green", "+0.1"],
    ["Putting", "+0.4"],
  ],
  "A. Smalley": [
    ["SG total", "+0.7"],
    ["Off the tee", "−0.1"],
    ["Approach", "+0.5"],
    ["Around green", "+0.2"],
    ["Putting", "+0.1"],
  ],
};

/** Par per hole (1-indexed in display, 0-indexed here). */
export const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4, 5, 4, 4, 3, 4];

/** Field scoring average per hole — drives the SG-row colouring in
 *  the scorecard (cell green when player score is below avg, red
 *  when above). */
export const HOLE_AVG = [
  4.05, 4.18, 3.08, 4.62, 4.22, 3.95, 3.12, 4.3, 4.71, 4.1, 3.05, 4.15, 4.25,
  4.55, 4.08, 4.34, 3.1, 4.02,
];

/** Each row is one round's 18-hole deltas-from-par, as a
 *  whitespace-separated string. Round 0 is R1. */
const SC_DELTAS = [
  "0 -1 0 0 1 0 0 -1 0 -1 0 0 0 0 -1 0 1 -1",
  "-1 0 0 -1 0 1 0 0 -1 0 0 0 1 -1 0 0 0 -1",
  "0 0 -1 0 0 -1 0 0 0 1 0 -1 0 0 -1 0 0 0",
  "-1 -1 0 -1 0 0 0 -1 0 0 0 0 -1 0 0 1 0 -1",
];

export const SC_ROUNDS: number[][] = SC_DELTAS.map((d) =>
  d.split(" ").map((x, i) => PAR[i] + parseInt(x, 10)),
);

/** Resolve a player by either explicit prototype key ("R. Henley")
 *  or a route playerId — when the route id matches one of the live
 *  outright/top-finish bets in mock-bets.ts we return Henley as a
 *  default so any feed link lands on a populated page. */
export function resolvePlayerKey(input: string): keyof typeof PLAYER_DATA {
  if (input in PLAYER_DATA) return input;
  return "R. Henley";
}
