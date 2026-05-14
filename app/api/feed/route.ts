import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getLiveContenders } from "@/lib/golf-api/datagolf";
import { pollAndDiff } from "@/lib/feed/engine";
import {
  acquirePollLock,
  getCachedLeaderboard,
  getCommentCountsBulk,
  getEnrichments,
  getEvents,
  getReactionsBulk,
  getRecentBursts,
  markSeenToday,
  touchPresence,
} from "@/lib/feed/store";
import {
  createPoll,
  deletePoll,
  getVoterChoice,
  listPolls,
  pollWithVotes,
} from "@/lib/feed/polls";
import type { FeedRow } from "@/lib/feed/types";

export const dynamic = "force-dynamic";

/** Marks the current winner-poll seeding strategy; bump to force a re-seed. */
const WINNER_POLL_SEED = "win-prob-v1";

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
      seenToday: 0,
      polled: false,
    });
  }

  const { tournament, isLive } = active;

  let watching = 0;
  let seenToday = 0;
  if (visitorId) {
    watching = await touchPresence(tournament.id, visitorId);
    seenToday = await markSeenToday(tournament.id, visitorId);
  }

  let polled = false;
  let enrichDebug = "no-lock";
  if (isLive) {
    const gotLock = await acquirePollLock(tournament.id);
    if (gotLock) {
      try {
        const r = await pollAndDiff(tournament.id);
        polled = true;
        enrichDebug = r.enrichDebug ?? "undefined";
      } catch (err) {
        enrichDebug = `threw:${err instanceof Error ? err.message : String(err)}`;
        console.error("[feed] pollAndDiff failed", err);
      }
      // Seed (or re-seed) the "Who wins?" poll from live win
      // probability — the genuine "most likely to win", not whoever
      // teed off early and went low. Replaces any poll seeded by an
      // older strategy.
      try {
        const polls = await listPolls(tournament.id);
        const winnerPolls = polls.filter((p) => p.kind === "winner");
        const current = winnerPolls.find(
          (p) => p.seededFrom === WINNER_POLL_SEED,
        );
        if (!current) {
          const contenders = await getLiveContenders();
          const top = contenders.slice(0, 8);
          if (top.length >= 2) {
            for (const stale of winnerPolls) {
              await deletePoll(tournament.id, stale.id);
            }
            await createPoll({
              tournamentId: tournament.id,
              kind: "winner",
              question: `Who wins the ${tournament.name}?`,
              options: top.map((c) => ({ id: c.dgId, label: c.name })),
              resolvedOptionId: null,
              seededFrom: WINNER_POLL_SEED,
            });
          }
        }
      } catch (err) {
        console.error("[feed] winner-poll seed failed", err);
      }
    }
  }

  const [events, bursts, leaderboard, polls, enrichments] =
    await Promise.all([
      getEvents(tournament.id, 80),
      getRecentBursts(tournament.id),
      getCachedLeaderboard(tournament.id),
      listPolls(tournament.id),
      getEnrichments(tournament.id),
    ]);

  const ids = events.map((e) => e.id);
  const [reactions, commentCounts] = await Promise.all([
    getReactionsBulk(ids),
    getCommentCountsBulk(ids),
  ]);

  const rows: FeedRow[] = events.map((event) => {
    // Apply the shot-detail enrichment overlay if one exists for this
    // event — gives "3-putts from 40 ft" in place of "doubles the 8th",
    // and flags whether it's a genuine Worst-of-reel disaster.
    const enriched = enrichments[event.id];
    const merged = enriched
      ? {
          ...event,
          headline: enriched.headline || event.headline,
          emoji: enriched.emoji || event.emoji,
          reelWorthy: enriched.reelWorthy,
          trace: enriched.trace,
        }
      : event;
    return {
      event: merged,
      reactions: reactions[event.id] ?? { up: 0, down: 0 },
      commentCount: commentCounts[event.id] ?? 0,
    };
  });

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
    seenToday,
    polled,
    enrichDebug,
  });
}
