/**
 * Mock Sharp data — verbatim from the design-handoff prototype's
 * <Sharp> component in Pardle Social v2.html, plus an open / settled
 * calls list that mirrors the shape /api/feed would populate.
 *
 * Drives the first cut of the redesigned /sharp; real wiring (the
 * existing sharp-score module + putt-iq leaderboard) lands in a
 * follow-up. Shapes here are the contract real data will populate.
 */

export interface MockSharpStats {
  score: number;
  rankLabel: string;
  percentileLabel: string;
  /** Signed rank-change delta — "+4" / "−2" / "0" — drives the ▲ / ▼
   *  glyph next to the gauge label. */
  delta: string;
  totalCalls: number;
  correctCalls: number;
  currentStreak: number;
}

export const MOCK_SHARP_STATS: MockSharpStats = {
  score: 72,
  rankLabel: "#3 in The Lads",
  percentileLabel: "top 9% on Pardle",
  delta: "+4",
  totalCalls: 31,
  correctCalls: 22,
  currentStreak: 5,
};

export interface MockSharpPollOption {
  label: string;
  pct: number;
}

export interface MockSharpPoll {
  /** Eyebrow ("Putt-IQ · The Lads vote"). */
  eyebrow: string;
  question: string;
  options: MockSharpPollOption[];
  /** Post-vote sub line ("6 of your crew voted Yes"). */
  postVoteSub: string;
  /** Pre-vote sub line ("Tap to lock your read"). */
  preVoteSub: string;
}

export const MOCK_SHARP_POLL: MockSharpPoll = {
  eyebrow: "Putt-IQ · The Lads vote",
  question: "Does Henley hold on for the win?",
  options: [
    { label: "Yes — Henley closes it out", pct: 61 },
    { label: "No — the field reels him in", pct: 39 },
  ],
  postVoteSub: "6 of your crew voted Yes",
  preVoteSub: "Tap to lock your read",
};

export interface MockSharpCall {
  id: string;
  /** Free-form question text the user voted on. */
  question: string;
  /** User's pick ("Yes — Henley closes it out"). */
  myPick: string;
  /** Result label — "PENDING" while live, "RIGHT" / "WRONG" once
   *  settled. */
  status: "pending" | "right" | "wrong";
  /** Short relative timestamp — "8m" / "2h" / "yesterday". */
  time: string;
  /** Light context line ("R4 · 17th hole", "Outright @ +250"). */
  context: string;
}

export const MOCK_SHARP_OPEN_CALLS: MockSharpCall[] = [
  {
    id: "c-open-1",
    question: "Does Henley hold on for the win?",
    myPick: "Yes — Henley closes it out",
    status: "pending",
    time: "now",
    context: "R4 · final 3 holes",
  },
  {
    id: "c-open-2",
    question: "Will Brennan break 68 in R4?",
    myPick: "No — bombers don't break 68 here",
    status: "pending",
    time: "1h",
    context: "Round-score · UNDER 67.5",
  },
];

export const MOCK_SHARP_SETTLED_CALLS: MockSharpCall[] = [
  {
    id: "c-set-1",
    question: "Smalley birdies 17?",
    myPick: "Yes — 8 ft uphill",
    status: "right",
    time: "12m",
    context: "Putt poll · made for birdie",
  },
  {
    id: "c-set-2",
    question: "Åberg keeps the lead after 16?",
    myPick: "No — three-putt brewing",
    status: "right",
    time: "38m",
    context: "Hold-the-lead · lost it",
  },
  {
    id: "c-set-3",
    question: "Will Echavarria's drop find dry land?",
    myPick: "Yes — easy carry",
    status: "wrong",
    time: "2h",
    context: "R3 · 12th hole",
  },
  {
    id: "c-set-4",
    question: "Top 5 lock by Friday?",
    myPick: "Yes — Smalley shoots 67",
    status: "right",
    time: "yesterday",
    context: "Pre-round pick",
  },
];
