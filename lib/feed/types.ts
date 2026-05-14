/**
 * Live shot feed — shared types.
 *
 * A FeedEvent is one thing worth reacting to: a completed hole, a lead
 * change, a player making the turn. Events are generated server-side
 * by diffing PGA Tour scorecard snapshots, stored in a capped Redis
 * list, and streamed to clients.
 */

export type ScoreResult =
  | "albatross"
  | "eagle"
  | "birdie"
  | "par"
  | "bogey"
  | "double"
  | "triple-plus";

export type FeedEventType = "score" | "shot" | "position" | "milestone";

export interface FeedEvent {
  /** Sortable unique id: `${ts}-${rand}`. */
  id: string;
  tournamentId: string;
  /** epoch ms — when our poller detected it (not when it happened on course). */
  ts: number;
  type: FeedEventType;
  playerId: string;
  playerName: string;
  round: number;

  // ── score events ──
  hole?: number;
  par?: number;
  strokes?: number;
  result?: ScoreResult;
  /** True when the hole was scored with one stroke — a hole-in-one. */
  ace?: boolean;

  // ── shot events (stuffed approaches) ──
  /** Distance to the hole after the shot, in inches. */
  proximityInches?: number;
  /** Distance of the approach, in yards. */
  shotYards?: number;

  // ── position / milestone events ──
  position?: string; // e.g. "1" | "T2"
  toPar?: string; // overall total to par, display string

  /** Pre-rendered one-line headline for the feed row. */
  headline: string;
  /** Emoji shown on the row. */
  emoji: string;
  /** True when this belongs in the "Shots of the Day" highlights reel. */
  highlight?: boolean;
  /** True when this belongs in the "Worst of the Day" blow-up reel. */
  lowlight?: boolean;
}

/** Reaction tallies — stored separately so they update without rewriting the event. */
export interface ReactionCounts {
  up: number;
  down: number;
}

export interface FeedComment {
  id: string;
  eventId: string;
  ts: number;
  /** Display name — cookie-stored, no auth required. */
  authorName: string;
  /** Anonymous author key (hashed cookie id) for rate-limiting / dedup. */
  authorKey: string;
  text: string;
}

/** What the /live page renders per row: event + its current social state. */
export interface FeedRow {
  event: FeedEvent;
  reactions: ReactionCounts;
  commentCount: number;
}

export const FEED_MAX_EVENTS = 400; // cap the Redis list — ~a full tournament day
export const COMMENT_MAX_LEN = 280;
export const COMMENTS_PER_EVENT_CAP = 200;

/** Map a (strokes - par) delta to a result label. */
export function resultFor(strokes: number, par: number): ScoreResult {
  const d = strokes - par;
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  if (d === 2) return "double";
  return "triple-plus";
}

export function emojiFor(result: ScoreResult): string {
  switch (result) {
    case "albatross":
      return "🦅";
    case "eagle":
      return "🦅";
    case "birdie":
      return "🐦";
    case "par":
      return "➖";
    case "bogey":
      return "😬";
    case "double":
      return "💥";
    case "triple-plus":
      return "☠️";
  }
}

const ORDINAL = [
  "",
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
  "11th",
  "12th",
  "13th",
  "14th",
  "15th",
  "16th",
  "17th",
  "18th",
];

export function ordinalHole(hole: number): string {
  return ORDINAL[hole] ?? `${hole}th`;
}

/** Build the human headline for a score event. */
export function scoreHeadline(
  playerName: string,
  hole: number,
  result: ScoreResult,
): string {
  const where = `the ${ordinalHole(hole)}`;
  switch (result) {
    case "albatross":
      return `${playerName} ALBATROSS on ${where} 🤯`;
    case "eagle":
      return `${playerName} eagles ${where}`;
    case "birdie":
      return `${playerName} birdies ${where}`;
    case "par":
      return `${playerName} pars ${where}`;
    case "bogey":
      return `${playerName} bogeys ${where}`;
    case "double":
      return `${playerName} doubles ${where}`;
    case "triple-plus":
      return `${playerName} blows up on ${where}`;
  }
}

/** Headline + emoji for a hole-in-one — always the loudest row in the feed. */
export function aceHeadline(playerName: string, hole: number): string {
  return `${playerName} ACES the ${ordinalHole(hole)} 🎯 HOLE IN ONE`;
}

/** Headline + emoji for a stuffed-approach shot event. */
export function shotHeadline(
  playerName: string,
  hole: number,
  par: number,
  proximityText: string,
  stiff: boolean,
): string {
  const where = `the par-${par} ${ordinalHole(hole)}`;
  return stiff
    ? `${playerName} sticks it to ${proximityText} on ${where}`
    : `${playerName}'s approach to ${proximityText} on ${where}`;
}
