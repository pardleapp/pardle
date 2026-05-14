import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { pollAndDiff } from "@/lib/feed/engine";
import {
  acquirePollLock,
  getCommentCountsBulk,
  getEvents,
  getReactionsBulk,
  getRecentBursts,
  touchPresence,
} from "@/lib/feed/store";
import type { FeedRow } from "@/lib/feed/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/feed?v=<visitorId>
 *
 * The /live page's single data endpoint. On each call:
 *   1. Resolve the active tournament (or the next upcoming one).
 *   2. Register the caller's presence + read the live watcher count.
 *   3. If the poll lock is free, run the diff engine — concurrent
 *      viewers share one poll (25s lock).
 *   4. Return feed rows + recent bursts + watcher count.
 */
export async function GET(req: Request) {
  const visitorId = new URL(req.url).searchParams.get("v") ?? "";

  const active = await getActiveTournament();
  if (!active) {
    return NextResponse.json({
      tournament: null,
      rows: [],
      bursts: [],
      watching: 0,
      polled: false,
    });
  }

  const { tournament, isLive } = active;

  // Presence — count this visitor, get the live watcher tally.
  let watching = 0;
  if (visitorId) {
    watching = await touchPresence(tournament.id, visitorId);
  }

  // Advance the feed if it's our turn to poll and the event is live.
  let polled = false;
  if (isLive) {
    const gotLock = await acquirePollLock(tournament.id);
    if (gotLock) {
      try {
        await pollAndDiff(tournament.id);
        polled = true;
      } catch (err) {
        console.error("[feed] pollAndDiff failed", err);
      }
    }
  }

  const [events, bursts] = await Promise.all([
    getEvents(tournament.id, 80),
    getRecentBursts(tournament.id),
  ]);
  const ids = events.map((e) => e.id);
  const [reactions, commentCounts] = await Promise.all([
    getReactionsBulk(ids),
    getCommentCountsBulk(ids),
  ]);

  const rows: FeedRow[] = events.map((event) => ({
    event,
    reactions: reactions[event.id] ?? { up: 0, down: 0 },
    commentCount: commentCounts[event.id] ?? 0,
  }));

  return NextResponse.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      isLive,
      startDate: tournament.startDate,
    },
    rows,
    bursts,
    watching,
    polled,
  });
}
