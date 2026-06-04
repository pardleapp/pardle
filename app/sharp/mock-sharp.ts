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

// Cold-start defaults — a brand-new user has no calls yet, so we
// render the empty/onboarding state instead of inventing rank +
// streak data. Real wiring (the sharp-score module + putt-iq
// leaderboard) replaces these once a user has built any record.
export const MOCK_SHARP_STATS: MockSharpStats = {
  score: 0,
  rankLabel: "",
  percentileLabel: "",
  delta: "",
  totalCalls: 0,
  correctCalls: 0,
  currentStreak: 0,
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

// Empty open-poll placeholder — the Sharp page now reads the real
// active prediction poll from /api/feed.predictionPolls when one
// exists; until then it shows the empty/onboarding state rather
// than a fictional "Does Henley hold on?" question.
export const MOCK_SHARP_POLL: MockSharpPoll = {
  eyebrow: "",
  question: "",
  options: [],
  postVoteSub: "",
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

// Empty by default — real user calls populate once they vote on a
// putt-poll or settle a tracked bet. SharpClient renders the
// onboarding empty state when both arrays are []. No invented
// Henley / Brennan / Smalley calls in the live experience.
export const MOCK_SHARP_OPEN_CALLS: MockSharpCall[] = [];
export const MOCK_SHARP_SETTLED_CALLS: MockSharpCall[] = [];
