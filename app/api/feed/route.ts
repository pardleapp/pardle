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
import { findOddsShift, getOddsBuffers } from "@/lib/feed/odds-store";
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
      bestReel: [],
      worstReel: [],
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
  if (isLive) {
    const gotLock = await acquirePollLock(tournament.id);
    if (gotLock) {
      try {
        await pollAndDiff(tournament.id);
        polled = true;
      } catch (err) {
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

  // The main feed shows the last 80 events; the reels are curated from
  // a much wider window so "shots/worst of the day" stay populated even
  // as the feed rolls.
  const [feedEvents, reelSource, bursts, leaderboard, polls, enrichments] =
    await Promise.all([
      getEvents(tournament.id, 80),
      getEvents(tournament.id, 400),
      getRecentBursts(tournament.id),
      getCachedLeaderboard(tournament.id),
      listPolls(tournament.id),
      getEnrichments(tournament.id),
    ]);

  // Merge the shot-detail enrichment overlay onto an event — gives
  // "3-putts from 40 ft" in place of "doubles the 8th", the shot
  // trace, and the reel flags.
  const mergeEnrichment = (event: FeedRow["event"]) => {
    const enriched = enrichments[event.id];
    return enriched
      ? {
          ...event,
          headline: enriched.headline || event.headline,
          emoji: enriched.emoji || event.emoji,
          reelWorthy: enriched.reelWorthy,
          reelGreat: enriched.reelGreat,
          trace: enriched.trace,
        }
      : event;
  };

  const feedMerged = feedEvents.map(mergeEnrichment);
  // Filter the wide window FIRST (cheap — just enrichment flags) so the
  // reaction/comment lookups only run for events actually returned.
  const bestEvents = reelSource
    .map(mergeEnrichment)
    .filter((e) => e.reelGreat === true)
    .slice(0, 24);
  const worstEvents = reelSource
    .map(mergeEnrichment)
    .filter((e) => e.reelWorthy === true)
    .slice(0, 24);

  // One reaction/comment lookup for the union of everything returned.
  const idSet = new Set<string>();
  for (const e of feedMerged) idSet.add(e.id);
  for (const e of bestEvents) idSet.add(e.id);
  for (const e of worstEvents) idSet.add(e.id);
  const ids = [...idSet];
  const [reactions, commentCounts] = await Promise.all([
    getReactionsBulk(ids),
    getCommentCountsBulk(ids),
  ]);

  // Pull odds buffers for the union of players in this response. We
  // compute the per-event "before / after" shift here at response
  // time, not at event creation, because the post-shot odds movement
  // hasn't necessarily landed in our buffer the moment we detect a
  // shot. Computing here means newer renders show fuller deltas.
  const playerIds = new Set<string>();
  for (const e of feedMerged) playerIds.add(e.playerId);
  for (const e of bestEvents) playerIds.add(e.playerId);
  for (const e of worstEvents) playerIds.add(e.playerId);
  const oddsBuffers = await getOddsBuffers(tournament.id, [...playerIds]);
  const ODDS_MIN_PCT = 0.15; // ≥15% relative move qualifies as a shift
  const attachOdds = (event: FeedRow["event"]): FeedRow["event"] => {
    const buf = oddsBuffers[event.playerId];
    if (!buf || buf.length < 2) return event;
    const shift = findOddsShift(buf, event.ts);
    if (!shift) return event;
    const rel = Math.abs(shift.after - shift.before) / shift.before;
    if (rel < ODDS_MIN_PCT) return event;
    return { ...event, oddsBefore: shift.before, oddsAfter: shift.after };
  };

  const toRow = (event: FeedRow["event"]): FeedRow => ({
    event: attachOdds(event),
    reactions: reactions[event.id] ?? { up: 0, down: 0 },
    commentCount: commentCounts[event.id] ?? 0,
  });

  const rows: FeedRow[] = feedMerged.map(toRow);
  const bestReel: FeedRow[] = bestEvents.map(toRow);
  const worstReel: FeedRow[] = worstEvents.map(toRow);

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

  // Slim shape for the player-search dropdown — just enough to match
  // by name and render a result row with position + total.
  const playerIndex = leaderboard.map((r) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    position: r.position,
    total: r.total,
    thru: r.thru,
    playerState: r.playerState,
  }));

  return NextResponse.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      isLive,
      startDate: tournament.startDate,
    },
    rows,
    bestReel,
    worstReel,
    bursts,
    leaderboard: leaderboard.slice(0, 15),
    playerIndex,
    polls: pollsWithVotes,
    myVotes,
    watching,
    seenToday,
    polled,
  });
}
