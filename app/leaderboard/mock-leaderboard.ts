/**
 * Mock leaderboard — verbatim from the design-handoff prototype's
 * LEADERBOARD constant in Pardle Social v2.html. Drives the first
 * cut of the redesigned /leaderboard surface; real wiring (live
 * orchestrator leaderboard via /api/feed) lands in a follow-up
 * along with the rest of the player-data integration.
 */

export interface LeaderboardRow {
  /** "1" | "T3" | "T9" — display string. */
  pos: string;
  /** Player display name — used for the row's avatar initials + as
   *  the URL slot when tapping through to /live/player/[name]. */
  name: string;
  /** To-par for the tournament — "−12" / "E" / "+3". Always carries
   *  the Unicode minus (U+2212). */
  total: string;
  /** Holes through — "F" / "17" / "14". */
  thru: string;
  /** Today's to-par — "−4" / "E" / "+1". */
  today: string;
  /** Direction of today's score vs field — drives the today colour. */
  dir: "up" | "down" | "flat";
  /** Caller follows this player (drives the orange .fdot). */
  following: boolean;
  /** Bet market the caller has on this player — empty when none.
   *  Drives the row's "mine" highlight + the OUTRIGHT / TOP 5 tag. */
  bet: "" | "OUTRIGHT" | "TOP 5" | "TOP 10" | "UNDER 69.5 · R4";
}

export const LEADERBOARD: LeaderboardRow[] = [
  { pos: "1", name: "R. Henley", total: "−12", thru: "F", today: "−4", dir: "up", following: true, bet: "OUTRIGHT" },
  { pos: "2", name: "E. Cole", total: "−12", thru: "F", today: "−6", dir: "up", following: false, bet: "" },
  { pos: "T3", name: "B. Griffin", total: "−11", thru: "17", today: "−3", dir: "up", following: true, bet: "" },
  { pos: "T3", name: "A. Smalley", total: "−11", thru: "F", today: "−6", dir: "up", following: false, bet: "TOP 5" },
  { pos: "T3", name: "M. Meissner", total: "−11", thru: "F", today: "−5", dir: "up", following: false, bet: "" },
  { pos: "T6", name: "G. Woodland", total: "−10", thru: "16", today: "−2", dir: "up", following: true, bet: "" },
  { pos: "T6", name: "M. Brennan", total: "−10", thru: "F", today: "−1", dir: "flat", following: false, bet: "" },
  { pos: "T6", name: "N. Echavarria", total: "−10", thru: "F", today: "−5", dir: "up", following: false, bet: "" },
  { pos: "T9", name: "L. Åberg", total: "−9", thru: "15", today: "+1", dir: "down", following: false, bet: "" },
  { pos: "T9", name: "C. Morikawa", total: "−9", thru: "F", today: "−4", dir: "up", following: false, bet: "" },
  { pos: "11", name: "A. Novak", total: "−8", thru: "F", today: "−2", dir: "up", following: false, bet: "" },
  { pos: "12", name: "R. Fowler", total: "−7", thru: "F", today: "+2", dir: "down", following: false, bet: "" },
  { pos: "T13", name: "M. Thorbjornsen", total: "−6", thru: "F", today: "E", dir: "flat", following: false, bet: "" },
  { pos: "T13", name: "S. Burns", total: "−6", thru: "14", today: "−1", dir: "up", following: false, bet: "" },
];

export const EVENT_LINE = "Round 4 · Final";
export const TOURNAMENT_NAME = "Charles Schwab Challenge";
