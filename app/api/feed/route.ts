import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
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
import { deletePoll, listPolls } from "@/lib/feed/polls";
import type { FeedRow } from "@/lib/feed/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/feed?v=<visitorId>
 *
 * The /live page's single data endpoint. On each call:
 *   1. Resolve the active tournament.
 *   2. Register presence, read watcher count.
 *   3. If the poll lock is free: run the diff engine (which also
 *      caches the leaderboard) and clean up any leftover winner polls.
 *   4. Return feed rows + bursts + leaderboard + watcher count.
 */
export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[feed] route handler failed", err);
    return NextResponse.json(
      {
        error: "feed-failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

async function handle(req: Request) {
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
      // One-off cleanup: the winner-prediction poll has been removed
      // from the UI. Delete any leftover poll rows from previous
      // seeding so the API doesn't keep returning them.
      try {
        const existing = await listPolls(tournament.id);
        for (const stale of existing.filter((p) => p.kind === "winner")) {
          await deletePoll(tournament.id, stale.id);
        }
      } catch (err) {
        console.error("[feed] winner-poll cleanup failed", err);
      }
    }
  }

  // The main feed shows the last 80 events; the reels are curated from
  // a much wider window so "shots/worst of the day" stay populated even
  // as the feed rolls.
  const [feedEvents, reelSource, bursts, leaderboard, enrichments] =
    await Promise.all([
      getEvents(tournament.id, 80),
      getEvents(tournament.id, 400),
      getRecentBursts(tournament.id),
      getCachedLeaderboard(tournament.id),
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
  // Also: pull the current-odds-per-player map (latest sample from
  // each buffer) so the client can live-value tracked bets.
  const playerIds = new Set<string>();
  for (const e of feedMerged) playerIds.add(e.playerId);
  for (const e of bestEvents) playerIds.add(e.playerId);
  for (const e of worstEvents) playerIds.add(e.playerId);
  // Also include every player in the leaderboard so bet-tracker
  // lookups work even for players whose events have aged out.
  for (const r of leaderboard) playerIds.add(r.playerId);
  const oddsBuffers = await getOddsBuffers(tournament.id, [...playerIds]);
  const currentOdds: Record<string, number> = {};
  for (const [pid, buf] of Object.entries(oddsBuffers)) {
    // hmget returns null for missing fields — guard before reading length.
    if (!Array.isArray(buf) || buf.length === 0) continue;
    const last = buf[buf.length - 1];
    if (last) currentOdds[pid] = last.p;
  }
  const ODDS_MIN_PCT = 0.15; // ≥15% relative move qualifies as a shift
  const attachOdds = (event: FeedRow["event"]): FeedRow["event"] => {
    const buf = oddsBuffers[event.playerId];
    if (!Array.isArray(buf) || buf.length < 2) return event;
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
    leaderboard: leaderboard.slice(0, 30),
    playerIndex,
    currentOdds,
    watching,
    seenToday,
    polled,
  });
}
