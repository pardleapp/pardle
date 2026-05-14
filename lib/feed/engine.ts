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
import { analyzeHole } from "./shot-analysis";
import {
  cacheLeaderboard,
  getSnapshot,
  type PollSnapshot,
  pushEvents,
  putSnapshot,
} from "./store";
import {
  aceHeadline,
  emojiFor,
  type FeedEvent,
  ordinalHole,
  resultFor,
  scoreHeadline,
  shotHeadline,
} from "./types";
import {
  formatProximity,
  parsePlayByPlay,
  STIFF_THRESHOLD_INCHES,
  STUFFED_THRESHOLD_INCHES,
} from "./playbyplay";

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
  const fresh: PollSnapshot = { holes: {}, positions: {}, proximityEmitted: [] };
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
        // Highlights reel = aces, albatrosses, eagles.
        const highlight =
          ace || result === "albatross" || result === "eagle";
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
          highlight,
          lowlight,
          headline: ace
            ? aceHeadline(playerName, h.holeNumber)
            : scoreHeadline(playerName, h.holeNumber, result),
          emoji: ace ? "🎯" : emojiFor(result),
        });
      }
    }
  }

  // ── Stuffed-approach "shot" events ──────────────────────────────
  // Parse each active player's playByPlay; a full-swing approach that
  // finished on the green inside the threshold is a highlight. Dedup
  // per (player, round, hole) so it fires once, not every poll.
  const prevProx = new Set(prev.proximityEmitted ?? []);
  const freshProx = new Set(prevProx);
  for (const [pid, sc] of Object.entries(scorecards)) {
    const parsed = parsePlayByPlay(sc.playByPlay);
    if (
      !parsed ||
      !parsed.fullSwing ||
      !parsed.onGreen ||
      parsed.proximityInches == null ||
      parsed.proximityInches > STUFFED_THRESHOLD_INCHES ||
      sc.currentHole == null
    ) {
      continue;
    }
    const round =
      leaderboard.find((r) => r.playerId === pid)?.currentRound ?? 1;
    const dedupKey = `${pid}:${round}:${sc.currentHole}`;
    if (prevProx.has(dedupKey)) continue;
    freshProx.add(dedupKey);

    const playerName = nameById.get(pid) ?? "Unknown";
    const holes = sc.rounds[round] ?? [];
    const par = holes.find((h) => h.holeNumber === sc.currentHole)?.par ?? 4;
    const stiff = parsed.proximityInches <= STIFF_THRESHOLD_INCHES;
    const proxText = formatProximity(parsed.proximityInches);

    events.push({
      id: newEventId(now),
      tournamentId,
      ts: now,
      type: "shot",
      playerId: pid,
      playerName,
      round,
      hole: sc.currentHole,
      par,
      proximityInches: parsed.proximityInches,
      shotYards: parsed.shotYards ?? undefined,
      highlight: true,
      headline: shotHeadline(playerName, sc.currentHole, par, proxText, stiff),
      emoji: stiff ? "🎯" : "🏌️",
    });
  }
  fresh.proximityEmitted = Array.from(freshProx).slice(-2000);

  // ── Enrich blow-ups with shot-level detail ──────────────────────
  // For each double-or-worse this poll, pull the player's shot-by-shot
  // data and rewrite the headline with what actually went wrong — a
  // 3-putt, a 4-putt, a penalty — instead of a flat "doubles the 8th".
  const lowlightEvents = events.filter((e) => e.lowlight);
  if (lowlightEvents.length > 0) {
    const reqs = Array.from(
      new Map(
        lowlightEvents.map((e) => [
          `${e.playerId}:${e.round}`,
          { playerId: e.playerId, round: e.round },
        ]),
      ).values(),
    );
    try {
      const shotDetails = await getShotDetailsBatch(tournamentId, reqs);
      for (const e of lowlightEvents) {
        if (e.hole == null) continue;
        const holes = shotDetails[`${e.playerId}:${e.round}`];
        const hole = holes?.find((h) => h.holeNumber === e.hole);
        if (!hole) continue;
        const d = analyzeHole(hole.strokes);
        if (d.verdict) {
          e.headline = `${e.playerName} ${d.verdict} on the ${ordinalHole(e.hole)}`;
          e.emoji = d.emoji;
        }
      }
    } catch (err) {
      console.error("[feed] shot-detail enrichment failed", err);
    }
  }

  // Order events so the "most interesting" land last (= top of feed
  // after LPUSH). Aces loudest, then albatross/eagle, stuffed shots,
  // blow-ups, birdies, the rest.
  const interestOf = (e: FeedEvent): number => {
    if (e.ace) return 10;
    if (e.result === "albatross") return 9;
    if (e.result === "eagle") return 8;
    if (e.type === "shot") {
      return (e.proximityInches ?? 99) <= 24 ? 7 : 6;
    }
    if (e.result === "triple-plus") return 4;
    if (e.result === "double") return 3;
    if (e.result === "birdie") return 2;
    if (e.result === "bogey") return 1;
    return 0;
  };
  events.sort((a, b) => interestOf(a) - interestOf(b));

  await putSnapshot(tournamentId, fresh);
  await pushEvents(tournamentId, events);

  return {
    newEvents: events,
    seeded: false,
    activePlayers: activeIds.length,
  };
}
