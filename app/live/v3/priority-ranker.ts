/**
 * Priority ranker for the v3 feed.
 *
 * Assigns each incoming FeedEvent a visual TIER — "hero" (tournament-
 * altering, hero-card treatment), "standard" (notable, standard card),
 * or "ticker" (routine, one-line row).
 *
 * IMPORTANT: this is a pure function of (event, viewer context). It
 * runs at render time in the browser, NOT server-side. Events are
 * NEVER delayed by ranking — v3 uses the same /api/feed polling
 * pipeline v1 does, ranking happens purely after the poll returns.
 *
 * The tier of a given event depends on WHO'S LOOKING:
 *   - Ace / eagle / albatross                → hero for everyone
 *   - Lead change / new solo leader          → hero for everyone
 *   - Big odds swing (implicit via topN)     → hero for everyone
 *   - Top-10 birdie/bogey                    → standard
 *   - Anything on a Mine player              → auto-promote one tier
 *     (ticker → standard, standard → hero)
 *   - Everything else                        → ticker
 *
 * Personalization means Kim's routine bunker shot is a ticker for a
 * stranger but a hero for the follower — same event, different visual
 * weight, no server-side branching required.
 */

import type { FeedEvent } from "@/lib/feed/types";

export type Tier = "hero" | "standard" | "ticker";

export interface RankerContext {
  /** Player IDs on the viewer's Mine list (follows OR open bets on).
   *  Any event on one of these players is auto-promoted one tier. */
  minePlayerIds: Set<string>;
  /** Player IDs currently in the top 10 of the leaderboard. Used to
   *  gate the birdie/bogey → standard promotion. */
  topTenPlayerIds: Set<string>;
  /** Player IDs currently in the top 3. Used to auto-hero a leader-
   *  adjacent double-bogey / late-round trouble. */
  topThreePlayerIds: Set<string>;
}

/** Bump the tier up one step (unless already hero). */
function promote(t: Tier): Tier {
  if (t === "ticker") return "standard";
  if (t === "standard") return "hero";
  return "hero";
}

/** Base tier for the event, before any Mine promotion. */
function baseTier(ev: FeedEvent, ctx: RankerContext): Tier {
  // Aces / eagles / albatrosses are always hero.
  if (ev.ace) return "hero";
  if (ev.result === "eagle" || ev.result === "albatross") return "hero";

  // Confirmed wow-shots / disasters (set by the enrichment overlay
  // once shot detail comes in — a hole-out, tap-in eagle, dunked
  // bunker escape, penalty stroke). These are the moments the reel
  // system curates and they deserve a hero stripe live too.
  if (ev.reelGreat === true || ev.reelWorthy === true) return "hero";

  // The engine tags material shots with `highlight` / `lowlight`;
  // treat those as hero-worthy if from a top-10 player, otherwise
  // standard.
  const inTop10 = ctx.topTenPlayerIds.has(ev.playerId);
  const inTop3 = ctx.topThreePlayerIds.has(ev.playerId);

  // Big odds swings — the feed engine caches oddsBefore/oddsAfter on
  // material events. A big move for a top-10 player = hero.
  if (
    typeof ev.oddsBefore === "number" &&
    typeof ev.oddsAfter === "number"
  ) {
    // Positive delta = odds got shorter (more likely to win). Bigger
    // absolute jumps = bigger stories.
    const move = Math.abs(ev.oddsAfter - ev.oddsBefore);
    if (move >= 15 && inTop10) return "hero";
    if (move >= 8 && inTop10) return "standard";
  }

  // Top-3 doubles/triples = hero (leader stumbling).
  if (
    inTop3 &&
    (ev.result === "double" || ev.result === "triple-plus")
  ) {
    return "hero";
  }

  // Top-10 birdies / bogeys = standard.
  if (
    inTop10 &&
    (ev.result === "birdie" ||
      ev.result === "bogey" ||
      ev.result === "double")
  ) {
    return "standard";
  }

  // Notable shots (highlight/lowlight from the engine) from anyone
  // else default to standard.
  if (ev.highlight === true || ev.lowlight === true) return "standard";

  // Prediction poll widgets attach to a shot row — always standard so
  // they're voteable at a glance.
  if (ev.type === "putt-poll") return "standard";

  // Everything else — routine par, distant bogey, position update from
  // a nobody — falls to the ticker.
  return "ticker";
}

/** Public ranker. Returns { tier, mine } — mine is truthy when the
 *  viewer follows this player or has a bet on them, so the caller
 *  can add a Mine accent even when the tier itself hasn't promoted. */
export function rank(
  ev: FeedEvent,
  ctx: RankerContext,
): { tier: Tier; mine: boolean } {
  const isMine = ctx.minePlayerIds.has(ev.playerId);
  const base = baseTier(ev, ctx);
  const tier = isMine ? promote(base) : base;
  return { tier, mine: isMine };
}
