/**
 * Live feed diff engine.
 *
 * One run = one poll cycle:
 *   1. Pull the live leaderboard + scorecards from the PGA Tour orchestrator.
 *   2. Build a fresh snapshot of every active player's per-hole scores.
 *   3. Diff against the previous snapshot — any hole that flipped from
 *      unplayed ("-") to a real score becomes a FeedEvent.
 *   4. Persist the new snapshot + push the events to Redis.
 *
 * The first poll for a tournament records the snapshot but emits
 * nothing — otherwise we'd flood the feed with every hole already
 * completed before we started watching.
 *
 * Server-only.
 */

import "server-only";
import {
  getLeaderboard,
  getScorecards,
  getShotDetailsBatch,
} from "@/lib/golf-api/pgatour";
import { analyzeHighlightHole, analyzeHole } from "./shot-analysis";
import { extractTrace, type TraceFocus } from "./shot-trace";
import {
  cacheLeaderboard,
  type Enrichment,
  getEnrichments,
  getEvents,
  getSnapshot,
  type PollSnapshot,
  pushEvents,
  putEnrichments,
  putSnapshot,
} from "./store";
import {
  aceHeadline,
  emojiFor,
  type FeedEvent,
  isHighlightEvent,
  isLowlightEvent,
  ordinalHole,
  resultFor,
  scoreHeadline,
} from "./types";

/** Player states we don't poll scorecards for. */
const INACTIVE_STATES = new Set([
  "CUT",
  "WD",
  "DQ",
  "MDF",
  "MC",
  "WITHDRAWN",
]);

function isUnplayed(score: string | undefined | null): boolean {
  return score === undefined || score === null || score === "" || score === "-";
}

let eventCounter = 0;
function newEventId(ts: number): string {
  eventCounter = (eventCounter + 1) % 100000;
  return `${ts}-${eventCounter.toString(36)}`;
}

export interface PollResult {
  newEvents: FeedEvent[];
  /** True when this was the first poll (snapshot seeded, no events). */
  seeded: boolean;
  activePlayers: number;
}

export async function pollAndDiff(
  tournamentId: string,
): Promise<PollResult> {
  const leaderboard = await getLeaderboard(tournamentId);
  if (leaderboard.length === 0) {
    return { newEvents: [], seeded: false, activePlayers: 0 };
  }

  const nameById = new Map(
    leaderboard.map((r) => [r.playerId, r.displayName]),
  );
  const activeIds = leaderboard
    .filter((r) => !INACTIVE_STATES.has(r.playerState))
    .map((r) => r.playerId);

  // Cache the leaderboard for /live's leaderboard panel — served from
  // Redis so viewers don't each hit the PGA Tour API.
  await cacheLeaderboard(
    tournamentId,
    leaderboard.slice(0, 30).map((r) => ({
      playerId: r.playerId,
      displayName: r.displayName,
      position: r.position,
      total: r.total,
      thru: r.thru,
      playerState: r.playerState,
    })),
  );

  const scorecards = await getScorecards(tournamentId, activeIds);

  // Build the fresh snapshot.
  const fresh: PollSnapshot = { holes: {}, positions: {} };
  for (const r of leaderboard) {
    fresh.positions[r.playerId] = r.position;
  }
  for (const [pid, sc] of Object.entries(scorecards)) {
    fresh.holes[pid] = {};
    for (const [roundStr, holes] of Object.entries(sc.rounds)) {
      const round = Number(roundStr);
      fresh.holes[pid][round] = {};
      for (const h of holes) {
        fresh.holes[pid][round][h.holeNumber] = h.score;
      }
    }
  }

  const prev = await getSnapshot(tournamentId);

  // First poll — seed only.
  if (!prev) {
    await putSnapshot(tournamentId, fresh);
    return {
      newEvents: [],
      seeded: true,
      activePlayers: activeIds.length,
    };
  }

  // Diff: every hole that went from unplayed → played is an event.
  const now = Date.now();
  const events: FeedEvent[] = [];

  for (const [pid, sc] of Object.entries(scorecards)) {
    const playerName = nameById.get(pid) ?? "Unknown";
    for (const [roundStr, holes] of Object.entries(sc.rounds)) {
      const round = Number(roundStr);
      for (const h of holes) {
        const before = prev.holes[pid]?.[round]?.[h.holeNumber];
        const after = h.score;
        if (!isUnplayed(before) || isUnplayed(after)) continue;

        const strokes = Number(after);
        if (!Number.isFinite(strokes) || strokes <= 0) continue;

        const result = resultFor(strokes, h.par);
        // Pars are noise in a reaction feed — nobody shouts "what a par".
        // The feed is highlights only: birdies, eagles, bogeys, blow-ups.
        if (result === "par") continue;

        const ace = strokes === 1;
        // Worst-of reel = doubles and worse (the blow-ups).
        const lowlight = result === "double" || result === "triple-plus";

        events.push({
          id: newEventId(now),
          tournamentId,
          ts: now,
          type: "score",
          playerId: pid,
          playerName,
          round,
          hole: h.holeNumber,
          par: h.par,
          strokes,
          result,
          ace,
          lowlight,
          headline: ace
            ? aceHeadline(playerName, h.holeNumber)
            : scoreHeadline(playerName, h.holeNumber, result),
          emoji: ace ? "🎯" : emojiFor(result),
        });
      }
    }
  }

  // Order events so the "most interesting" land last (= top of feed
  // after LPUSH). Aces loudest, then albatross/eagle, blow-ups, birdies.
  const interestOf = (e: FeedEvent): number => {
    if (e.ace) return 10;
    if (e.result === "albatross") return 9;
    if (e.result === "eagle") return 8;
    if (e.result === "triple-plus") return 4;
    if (e.result === "double") return 3;
    if (e.result === "birdie") return 2;
    if (e.result === "bogey") return 1;
    return 0;
  };
  events.sort((a, b) => interestOf(a) - interestOf(b));

  await putSnapshot(tournamentId, fresh);
  await pushEvents(tournamentId, events);

  // Backfill shot-level detail onto recent events (this poll's + any
  // still-generic backlog). Runs as an overlay so a transient fetch
  // failure just retries next poll instead of leaving a permanently
  // generic headline.
  try {
    await enrichRecentEvents(tournamentId);
  } catch (err) {
    console.error("[feed] enrichRecentEvents failed", err);
  }

  return {
    newEvents: events,
    seeded: false,
    activePlayers: activeIds.length,
  };
}

/**
 * Re-scan recent events and write shot-level headline rewrites into the
 * enrichment overlay. Picks up events created before this code shipped
 * and any whose enrichment previously failed. Bounded to 40 events per
 * poll so the extra orchestrator calls stay small.
 */
async function enrichRecentEvents(tournamentId: string): Promise<void> {
  const [events, done] = await Promise.all([
    getEvents(tournamentId, 150),
    getEnrichments(tournamentId),
  ]);

  // Eligibility is derived from the event's own fields. Birdies are
  // included because a birdie can be a genuine wow shot (a hole-out or
  // a long putt) — shot detail tells us which.
  const candidates = events.filter(
    (e) =>
      e.hole != null &&
      !done[e.id] &&
      (isLowlightEvent(e) || isHighlightEvent(e)),
  );
  if (candidates.length === 0) return;

  // Prioritise the high-value events so they're examined first when
  // there's a backlog — aces/blow-ups/eagles before plain birdies.
  const priority = (e: FeedEvent): number => {
    if (e.ace || e.result === "albatross") return 0;
    if (e.result === "eagle" || e.result === "triple-plus") return 1;
    if (e.result === "double") return 2;
    return 3; // birdies
  };
  candidates.sort((a, b) => priority(a) - priority(b));

  const batch = candidates.slice(0, 40);
  const reqs = Array.from(
    new Map(
      batch.map((e) => [
        `${e.playerId}:${e.round}`,
        { playerId: e.playerId, round: e.round },
      ]),
    ).values(),
  );
  const shotDetails = await getShotDetailsBatch(tournamentId, reqs);

  const enrichments: Record<string, Enrichment> = {};
  for (const e of batch) {
    const hole = shotDetails[`${e.playerId}:${e.round}`]?.find(
      (h) => h.holeNumber === e.hole,
    );
    // No shot data yet — leave un-enriched so we retry next poll.
    if (!hole) continue;

    let headline = e.headline;
    let emoji = e.emoji;
    // reelWorthy: confirmed disasters (multi-putt / penalty) make the
    // Worst-of reel. reelGreat: genuine wow shots (ace / albatross /
    // eagle / hole-out / long putt) make the Shots-of-the-day reel.
    let reelWorthy = false;
    let reelGreat = false;
    // `focus` tells the tracer which shot to frame and highlight.
    let focus: TraceFocus = "auto";
    if (isLowlightEvent(e)) {
      const d = analyzeHole(hole.strokes);
      if (d.verdict) {
        headline = `${e.playerName} ${d.verdict} on the ${ordinalHole(e.hole!)}`;
        emoji = d.emoji;
        reelWorthy = true;
      }
      if (d.puttCount >= 3) focus = "putt";
    } else if (e.ace) {
      focus = "holeout";
      reelGreat = true;
      const teeDist = hole.strokes[0]?.distance;
      if (teeDist) {
        headline = `${e.playerName} ACES the ${ordinalHole(e.hole!)} from ${teeDist} 🎯`;
      }
    } else {
      // albatross / eagle / birdie — eagles & albatrosses are auto-great;
      // a birdie only counts as a "shot of the day" when shot detail
      // shows it was a hole-out or a long putt.
      focus = "holeout";
      const autoGreat =
        e.result === "albatross" || e.result === "eagle";
      const g = analyzeHighlightHole(hole.strokes);
      reelGreat = autoGreat || g.great;
      if (g.verdict) {
        const label =
          e.result === "albatross"
            ? "ALBATROSS"
            : e.result === "eagle"
            ? "eagle"
            : "birdie";
        headline = `${e.playerName} ${g.verdict} for ${label} on the ${ordinalHole(e.hole!)}`;
        emoji = g.emoji;
      }
    }
    const trace = extractTrace(
      hole.strokes,
      focus,
      hole.holeImage,
      hole.greenImage,
    );
    // Store even when nothing changed — marks the event processed so we
    // don't re-fetch its shot detail every poll.
    enrichments[e.id] = {
      headline,
      emoji,
      reelWorthy,
      reelGreat,
      ...(trace.segments.length > 0 ? { trace } : {}),
    };
  }
  await putEnrichments(tournamentId, enrichments);
}
