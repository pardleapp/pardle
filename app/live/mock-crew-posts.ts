/**
 * Mock "crew" posts — bets, results, tips and poll cards from
 * fictional Pardle members the caller doesn't yet have a real
 * relationship with (Groups backend lands at step 4 of the redesign).
 *
 * These ship into /live so the Sweat Feed reads as a bet-driven
 * stream right now, matching the design-handoff prototype's
 * initPosts. They're labelled internally as crew posts so we can
 * cleanly swap them for real Groups members once that backend
 * exists.
 *
 * Shapes mirror what BetPost / ShotPost / ResultPost / PollPost
 * expect from real data so the rendering path stays unified.
 */

export interface MockBetPost {
  kind: "crew-bet";
  id: string;
  /** Approximate epoch ms — used for timeline sorting. Relative
   *  offsets from "now" so the demo never goes stale. */
  tsOffsetMs: number;
  bettorInitials: string;
  bettorName: string;
  mine: boolean;
  dir: "up" | "down" | "flat";
  probPct: number;
  playerName: string;
  marketLabel: string;
  currency: "£" | "$";
  stake: number;
  oddsLabel: string;
  sparkline: number[];
  thread: Array<{ text: string; delta: string; dir: "up" | "down" | "flat" }>;
  /** Initials of crew members also on this bet (avatar rail). */
  on: string[];
  reactCount: number;
  commentCount: number;
}

export interface MockResultPost {
  kind: "crew-result";
  id: string;
  tsOffsetMs: number;
  bettorInitials: string;
  bettorName: string;
  win: boolean;
  text: string;
  plLabel: string;
}

export interface MockTipPost {
  kind: "crew-tip";
  id: string;
  tsOffsetMs: number;
  channel: string;
  marketLabel: string;
  oddsLabel: string;
  playerName: string;
  rationale: string;
}

export type MockCrewPost = MockBetPost | MockResultPost | MockTipPost;

/**
 * Tightly mirrors `initPosts` from `design-handoff/Pardle Social v2.html`.
 * Time offsets descend so when we add Date.now() the newest post (the
 * "1m ago" one) lands on top of the timeline.
 */
export const MOCK_CREW_POSTS: MockCrewPost[] = [
  {
    kind: "crew-bet",
    id: "crew-bet-jordan-henley",
    tsOffsetMs: -1 * 60 * 1000, // 1m ago
    bettorInitials: "JO",
    bettorName: "Jordan",
    mine: false,
    dir: "up",
    probPct: 71,
    playerName: "R. Henley",
    marketLabel: "OUTRIGHT WIN",
    currency: "£",
    stake: 80,
    oddsLabel: "5/2",
    sparkline: [44, 50, 56, 62, 68, 71],
    thread: [
      { text: "Henley birdies 17 → joins lead at −12", delta: "+5", dir: "up" },
      { text: "Par save on 16", delta: "+1", dir: "up" },
      { text: "Approach on 15 to 8 ft", delta: "+3", dir: "up" },
    ],
    on: ["YO", "MI", "TH"],
    reactCount: 14,
    commentCount: 3,
  },
  {
    kind: "crew-bet",
    id: "crew-bet-sam-brennan",
    tsOffsetMs: -3 * 60 * 1000, // 3m
    bettorInitials: "SA",
    bettorName: "Sam",
    mine: false,
    dir: "down",
    probPct: 31,
    playerName: "M. Brennan",
    marketLabel: "UNDER 69.5 · R4",
    currency: "$",
    stake: 100,
    oddsLabel: "+100",
    sparkline: [62, 58, 50, 44, 36, 31],
    thread: [
      { text: "Brennan bogeys 15 — needs three under coming in", delta: "−9", dir: "down" },
      { text: "Approach 14 short-sided", delta: "−4", dir: "down" },
      { text: "Drove it into the fairway bunker on 13", delta: "−2", dir: "down" },
    ],
    on: [],
    reactCount: 5,
    commentCount: 2,
  },
  {
    kind: "crew-result",
    id: "crew-result-mia-smalley",
    tsOffsetMs: -8 * 60 * 1000, // 8m
    bettorInitials: "MI",
    bettorName: "Mia",
    win: true,
    text: "A. Smalley · TOP 5 · cashed",
    plLabel: "+£72",
  },
  {
    kind: "crew-bet",
    id: "crew-bet-theo-aberg",
    tsOffsetMs: -14 * 60 * 1000, // 14m
    bettorInitials: "TH",
    bettorName: "Theo",
    mine: false,
    dir: "down",
    probPct: 18,
    playerName: "L. Åberg",
    marketLabel: "TOP 5",
    currency: "£",
    stake: 25,
    oddsLabel: "7/4",
    sparkline: [44, 40, 36, 28, 22, 18],
    thread: [
      { text: "Åberg three-putts the par-5 11th", delta: "−12", dir: "down" },
      { text: "Wide-right approach on 10", delta: "−3", dir: "down" },
    ],
    on: ["YO"],
    reactCount: 9,
    commentCount: 4,
  },
  {
    kind: "crew-tip",
    id: "crew-tip-edge-echavarria",
    tsOffsetMs: -22 * 60 * 1000, // 22m
    channel: "@golf-edge",
    marketLabel: "OUTRIGHT",
    oddsLabel: "+1800",
    playerName: "N. Echavarria",
    rationale:
      "Top-25 SG · positive course history · live odds finally drifted out of his fair price.",
  },
];
