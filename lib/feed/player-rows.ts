/**
 * Server-side helper: gather a single player's reel-worthy moments from
 * the feed, with the same shot-detail enrichment + reaction/comment
 * counts the main /live API attaches. Used by the player card page to
 * show their highlights from the round.
 */

import "server-only";
import {
  getCommentCountsBulk,
  getEnrichments,
  getEvents,
  getReactionsBulk,
} from "./store";
import type { FeedEvent, FeedRow } from "./types";

export interface PlayerRowBuckets {
  best: FeedRow[];
  worst: FeedRow[];
}

export async function getPlayerReelRows(
  tournamentId: string,
  playerId: string,
): Promise<PlayerRowBuckets> {
  const [events, enrichments] = await Promise.all([
    // Pull the whole retained list so we don't miss earlier-round
    // moments that have aged out of the 80-event main-feed window.
    getEvents(tournamentId, 1000),
    getEnrichments(tournamentId),
  ]);

  const merged = events
    .filter((e) => e.playerId === playerId)
    .map((event): FeedEvent => {
      const en = enrichments[event.id];
      return en
        ? {
            ...event,
            headline: en.headline || event.headline,
            emoji: en.emoji || event.emoji,
            reelWorthy: en.reelWorthy,
            reelGreat: en.reelGreat,
            trace: en.trace,
          }
        : event;
    });

  const best = merged.filter((e) => e.reelGreat === true);
  const worst = merged.filter((e) => e.reelWorthy === true);

  // One reaction/comment lookup for the union of both buckets.
  const idSet = new Set<string>();
  for (const e of best) idSet.add(e.id);
  for (const e of worst) idSet.add(e.id);
  const ids = [...idSet];
  if (ids.length === 0) return { best: [], worst: [] };
  const [reactions, commentCounts] = await Promise.all([
    getReactionsBulk(ids),
    getCommentCountsBulk(ids),
  ]);

  const toRow = (event: FeedEvent): FeedRow => ({
    event,
    reactions: reactions[event.id] ?? { up: 0, down: 0 },
    commentCount: commentCounts[event.id] ?? 0,
  });

  return { best: best.map(toRow), worst: worst.map(toRow) };
}
