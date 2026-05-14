import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { pollAndDiff } from "@/lib/feed/engine";
import {
  acquirePollLock,
  getCommentCountsBulk,
  getEvents,
  getReactionsBulk,
} from "@/lib/feed/store";
import type { FeedRow } from "@/lib/feed/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/feed
 *
 * The /live page's single data endpoint. On each call:
 *   1. Resolve the active tournament (or the next upcoming one).
 *   2. If the poll lock is free, run the diff engine — this is how the
 *      feed advances. Concurrent viewers share one poll (45s lock).
 *   3. Return the latest feed rows (events + reactions + comment counts).
 *
 * Response:
 *   { tournament: {id,name,isLive}, rows: FeedRow[], polled: boolean }
 */
export async function GET() {
  const active = await getActiveTournament();
  if (!active) {
    return NextResponse.json({
      tournament: null,
      rows: [],
      polled: false,
    });
  }

  const { tournament, isLive } = active;

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

  const events = await getEvents(tournament.id, 80);
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
    polled,
  });
}
