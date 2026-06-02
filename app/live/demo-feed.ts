/**
 * Demo feed data — stub shot rows + supporting envelope that the
 * Sweat Feed renders when `?demo=1` is on the URL. Lets us preview
 * hold-to-react, the Shots-of-the-day reel, ShotPost diagrams,
 * filter pills etc. without a live tournament.
 *
 * The shape mirrors the real /api/feed response so the rendering
 * path is identical — only the data source switches. Shots cover
 * a spread of result types (eagle / birdie / blow-up / bogey)
 * plus a couple of highlight/lowlight rows for the reel.
 */

import type { FeedRow, FeedEvent } from "@/lib/feed/types";

const NOW = () => Date.now();

function mk(
  id: string,
  partial: Omit<Partial<FeedEvent>, "id" | "ts" | "tournamentId"> & {
    playerId: string;
    playerName: string;
    headline: string;
    minutesAgo: number;
  },
): FeedRow {
  const { minutesAgo, ...rest } = partial;
  const event: FeedEvent = {
    id,
    tournamentId: "demo",
    ts: NOW() - minutesAgo * 60_000,
    type: "score",
    round: 4,
    emoji: "🐦",
    ...rest,
  };
  return {
    event,
    reactions: { up: Math.floor(Math.random() * 20) + 2, down: 0 },
    commentCount: Math.floor(Math.random() * 5),
  };
}

export const DEMO_ROWS: FeedRow[] = [
  mk("demo-1", {
    playerId: "demo-griffin",
    playerName: "B. Griffin",
    headline: "Pours in a 20-footer to join the lead at −12",
    result: "birdie",
    hole: 18,
    par: 4,
    strokes: 3,
    toPar: "−12",
    emoji: "🐦",
    highlight: true,
    reelGreat: true,
    tags: ["5th birdie of the round"],
    minutesAgo: 1,
  }),
  mk("demo-2", {
    playerId: "demo-cole",
    playerName: "E. Cole",
    headline: "Finds the penalty area off the tee on the 9th",
    result: "double",
    hole: 9,
    par: 4,
    strokes: 6,
    toPar: "−7",
    emoji: "💀",
    lowlight: true,
    reelWorthy: true,
    tags: ["1st blow-up of the round"],
    minutesAgo: 4,
  }),
  mk("demo-3", {
    playerId: "demo-henley",
    playerName: "R. Henley",
    headline: "Approach to 3 ft sets up a tap-in birdie on 17",
    result: "birdie",
    hole: 17,
    par: 4,
    strokes: 3,
    toPar: "−12",
    emoji: "🎯",
    tags: ["Joins the lead"],
    minutesAgo: 8,
  }),
  mk("demo-4", {
    playerId: "demo-aberg",
    playerName: "L. Åberg",
    headline: "Three-putts from 22 ft on the par-5 11th",
    result: "bogey",
    hole: 11,
    par: 5,
    strokes: 6,
    toPar: "−8",
    emoji: "😱",
    lowlight: true,
    reelWorthy: true,
    tags: ["1st 3-putt of the round"],
    minutesAgo: 14,
  }),
  mk("demo-5", {
    playerId: "demo-thorbjornsen",
    playerName: "M. Thorbjornsen",
    headline: "Stuffs a 78-yard wedge to 2 ft for an eagle look",
    result: "eagle",
    hole: 9,
    par: 5,
    strokes: 3,
    toPar: "−6",
    emoji: "⛳",
    highlight: true,
    reelGreat: true,
    tags: ["1st eagle of the season"],
    minutesAgo: 22,
  }),
  mk("demo-6", {
    playerId: "demo-brennan",
    playerName: "M. Brennan",
    headline: "Saves par from the back bunker on the 16th",
    result: "par",
    hole: 16,
    par: 4,
    strokes: 4,
    toPar: "−10",
    emoji: "🛡️",
    tags: ["3 top-5s in 5 starts"],
    minutesAgo: 31,
  }),
  mk("demo-7", {
    playerId: "demo-novak",
    playerName: "A. Novak",
    headline: "Bogeys the 18th to drop out of top 10",
    result: "bogey",
    hole: 18,
    par: 4,
    strokes: 5,
    toPar: "−4",
    emoji: "🤦",
    tags: ["4th bogey of the round"],
    minutesAgo: 42,
  }),
];

/** Pre-seeded emoji reaction clusters for the demo cards — so a
 *  fresh load of /?demo=1 already shows the chips populated and
 *  the user has something to tap-toggle. Maps event id → counts
 *  per emoji + the user's own reactions. */
export const DEMO_EMOJI_REACTIONS: Record<
  string,
  { counts: Record<string, number>; mine: string[] }
> = {
  "shot:demo-1": { counts: { "🔥": 12, "👏": 4, "⛳": 3 }, mine: [] },
  "shot:demo-2": { counts: { "💀": 8, "😱": 3 }, mine: [] },
  "shot:demo-5": {
    counts: { "🔥": 22, "⛳": 7, "👏": 5, "🐐": 3, "😱": 1 },
    mine: ["🔥"],
  },
  "shot:demo-4": { counts: { "😱": 6, "💀": 2 }, mine: [] },
};

/** Whole envelope the FeedClient consumes. Only fields the Sweat
 *  Feed actually reads are populated — everything else is left as
 *  the empty / null shapes the type expects. */
export const DEMO_RESPONSE = {
  tournament: {
    id: "demo",
    name: "Demo Tournament",
    isLive: true,
    startDate: NOW(),
  },
  rows: DEMO_ROWS,
  bestReel: DEMO_ROWS.filter((r) => r.event.highlight),
  worstReel: DEMO_ROWS.filter((r) => r.event.lowlight),
  bursts: [],
  leaderboard: [],
  playerIndex: [],
  currentOdds: {},
  playerRoundStates: {},
  oddsHistories: {},
  watching: 0,
  seenToday: 0,
  polled: false,
};
