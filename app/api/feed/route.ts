import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { pollAndDiff } from "@/lib/feed/engine";
import {
  acquirePollLock,
  getCachedLeaderboard,
  getCommentCountsBulk,
  getEvents,
  getReactionsBulk,
  getRecentBursts,
  touchPresence,
} from "@/lib/feed/store";
import {
  createPoll,
  getVoterChoice,
  hasPollOfKind,
  listPolls,
  pollWithVotes,
} from "@/lib/feed/polls";
import type { FeedRow } from "@/lib/feed/types";

export const dynamic = "force-dynamic";

const INACTIVE_STATES = new Set([
  "CUT",
  "WD",
  "DQ",
  "MDF",
  "MC",
  "WITHDRAWN",
]);

/**
 * GET /api/feed?v=<visitorId>
 *
 * The /live page's single data endpoint. On each call:
 *   1. Resolve the active tournament.
 *   2. Register presence, read watcher count.
 *   3. If the poll lock is free: run the diff engine (which also caches
 *      the leaderboard) and seed the "Who wins?" poll if missing.
 *   4. Return feed rows + bursts + leaderboard + polls + watcher count.
 */
export async function GET(req: Request) {
  const visitorId = new URL(req.url).searchParams.get("v") ?? "";

  const active = await getActiveTournament();
  if (!active) {
    return NextResponse.json({
      tournament: null,
      rows: [],
      bursts: [],
      leaderboard: [],
      polls: [],
      myVotes: {},
      watching: 0,
      polled: false,
    });
  }

  const { tournament, isLive } = active;

  let watching = 0;
  if (visitorId) {
    watching = await touchPresence(tournament.id, visitorId);
  }

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
      // Seed the "Who wins?" poll once we have a leaderboard to draw
      // options from. Runs at most once per tournament.
      try {
        const hasWinner = await hasPollOfKind(tournament.id, "winner");
        if (!hasWinner) {
          const lb = await getCachedLeaderboard(tournament.id);
          const contenders = lb
            .filter((r) => !INACTIVE_STATES.has(r.playerState))
            .slice(0, 8);
          if (contenders.length >= 2) {
            await createPoll({
              tournamentId: tournament.id,
              kind: "winner",
              question: `Who wins the ${tournament.name}?`,
              options: contenders.map((r) => ({
                id: r.playerId,
                label: r.displayName,
              })),
              resolvedOptionId: null,
            });
          }
        }
      } catch (err) {
        console.error("[feed] winner-poll seed failed", err);
      }
    }
  }

  const [events, bursts, leaderboard, polls] = await Promise.all([
    getEvents(tournament.id, 80),
    getRecentBursts(tournament.id),
    getCachedLeaderboard(tournament.id),
    listPolls(tournament.id),
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

  // Polls + this visitor's existing choices.
  const pollsWithVotes = await Promise.all(polls.map(pollWithVotes));
  const myVotes: Record<string, string> = {};
  if (visitorId) {
    await Promise.all(
      polls.map(async (p) => {
        const choice = await getVoterChoice(p.id, visitorId);
        if (choice) myVotes[p.id] = choice;
      }),
    );
  }

  return NextResponse.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      isLive,
      startDate: tournament.startDate,
    },
    rows,
    bursts,
    leaderboard: leaderboard.slice(0, 15),
    polls: pollsWithVotes,
    myVotes,
    watching,
    polled,
  });
}
