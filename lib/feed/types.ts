/**
 * Live shot feed — shared types.
 *
 * A FeedEvent is one thing worth reacting to: a completed hole, a lead
 * change, a player making the turn. Events are generated server-side
 * by diffing PGA Tour scorecard snapshots, stored in a capped Redis
 * list, and streamed to clients.
 */

import type { ShotTrace } from "./shot-trace";

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
  /**
   * Set by the enrichment overlay once shot detail confirms a genuine
   * reaction-worthy disaster (multi-putt or penalty). Only these make
   * the Worst-of reel — a plain sloppy double does not.
   */
  reelWorthy?: boolean;
  /**
   * Set by the enrichment overlay once shot detail confirms a genuine
   * wow shot — an ace, albatross, eagle, hole-out, or long putt. Only
   * these make the Shots-of-the-day reel; an ordinary birdie does not.
   */
  reelGreat?: boolean;
  /** Normalised shot trace for the hole — rendered as an SVG mini-tracer. */
  trace?: ShotTrace;
  /**
   * Context-tag chips rendered alongside the headline ("Takes the lead",
   * "5 of last 7 in red", etc). Adds the editorial-data layer that
   * makes a routine birdie read as a moment when it actually is one,
   * and stays out of the way when it's not.
   */
  tags?: string[];
  /**
   * Win-market mid-price (decimal odds) just before this event landed,
   * and the latest reading after. Attached at API response time from
   * the rolling Redis odds buffer; meaningful only when the move is
   * big enough (≥15%). Renders as a pill: "odds 20/1 → 5/1".
   */
  oddsBefore?: number;
  oddsAfter?: number;
}

/**
 * Whether an event is a candidate for Shots-of-the-day enrichment —
 * any score worth examining for a wow finish. Birdies are included
 * because a birdie can be a hole-out or a long putt; shot detail
 * decides. This is what the engine *examines*; what actually makes the
 * reel is decided later by `isBestReelEvent`.
 */
export function isHighlightEvent(e: FeedEvent): boolean {
  if (e.ace) return true;
  return (
    e.result === "albatross" ||
    e.result === "eagle" ||
    e.result === "birdie"
  );
}

/**
 * Whether an event actually belongs in the "Shots of the day" reel.
 * Only confirmed wow shots — set by the enrichment overlay once shot
 * detail is in.
 */
export function isBestReelEvent(e: FeedEvent): boolean {
  return e.reelGreat === true;
}

/**
 * Whether an event is a candidate for Worst-of enrichment processing —
 * a double or worse. This decides what the engine *examines*; whether
 * it actually makes the reel is decided later by `isWorstReelEvent`.
 */
export function isLowlightEvent(e: FeedEvent): boolean {
  if (e.lowlight) return true;
  return e.result === "double" || e.result === "triple-plus";
}

/**
 * Whether an event actually belongs in the "Worst of the day" reel.
 * Only confirmed disasters (multi-putts, penalties) — set by the
 * enrichment overlay once shot detail is in.
 */
export function isWorstReelEvent(e: FeedEvent): boolean {
  return e.reelWorthy === true;
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

// Cap the Redis events list. Large enough that the reels (curated from
// a 400-event window) stay populated across a full round of play.
export const FEED_MAX_EVENTS = 1000;
export const COMMENT_MAX_LEN = 280;
export const COMMENTS_PER_EVENT_CAP = 200;

/**
 * Expected direction of the win-market price change for this event.
 *  +1 → market should shorten (birdie, eagle, ace, hole-out, climb)
 *  -1 → market should lengthen (bogey, double, lost ball, drop)
 *   0 → no expectation (par, ambiguous milestone)
 *
 * Used to filter out spurious odds shifts attributed to an event when
 * the move was actually driven by a different player's near-simultaneous
 * action (e.g. the leader's hole-out re-pricing the rest of the field
 * a few seconds after our player's birdie landed).
 */
export function eventPolarity(e: FeedEvent): 1 | -1 | 0 {
  if (e.ace) return 1;
  if (e.reelGreat) return 1;
  if (e.reelWorthy) return -1;
  if (e.result === "albatross" || e.result === "eagle" || e.result === "birdie") {
    return 1;
  }
  if (e.result === "bogey" || e.result === "double" || e.result === "triple-plus") {
    return -1;
  }
  return 0;
}

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
