/**
 * Shared content for the v2 GamesHub — used both by the overlay
 * sheet that opens from the Sweat Feed header (app/live/GamesHub.tsx)
 * and by the standalone /games route that the off-week landing
 * card links to (app/games/page.tsx).
 *
 * The actual game list mirrors STATS_GAMES in lib/stats-backend
 * and the existing app/games/page.tsx — pros / holes / connections
 * / trivia / faces. Clubhouses is intentionally absent.
 */

export interface HubGame {
  key: string;
  href: string;
  ic: string;
  name: string;
  desc: string;
  /** Per-game accent hex — surfaces as a top stripe on each card.
   *  Lifted verbatim from the pre-redesign hub so each game stays
   *  recognisable across surfaces. */
  accent: string;
  multiplayer?: boolean;
}

export const HUB_GAMES: HubGame[] = [
  {
    key: "pros",
    href: "/pros",
    ic: "🏌️",
    name: "Pros",
    desc: "Six guesses to identify today's mystery golfer.",
    accent: "#7BAE3F",
  },
  {
    key: "holes",
    href: "/holes",
    ic: "🛰️",
    name: "Holes",
    desc: "Identify today's golf course from a satellite view.",
    accent: "#5BA0E0",
  },
  {
    key: "connections",
    href: "/connections",
    ic: "🧩",
    name: "Connections",
    desc: "Find four groups of four. Every item has a golf connection.",
    accent: "#B388D6",
  },
  {
    key: "trivia",
    href: "/trivia",
    ic: "❓",
    name: "Trivia",
    desc: "10 golf trivia questions. Easy, medium, or hard.",
    accent: "#E8C547",
    multiplayer: true,
  },
  {
    key: "faces",
    href: "/faces",
    ic: "👥",
    name: "Faces",
    desc: "Six blended-face puzzles. Name both pros in each.",
    accent: "#E07B5B",
    multiplayer: true,
  },
];

export interface HubChallengeRow {
  initials: string;
  name: string;
  score: string;
}

export const HUB_CHALLENGE: HubChallengeRow[] = [
  { initials: "JO", name: "Jordan", score: "3/6" },
  { initials: "MI", name: "Mia", score: "5/6" },
  { initials: "YO", name: "You", score: "4/6" },
  { initials: "TH", name: "Theo", score: "X" },
];

export const HUB_AVATAR_PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
};
