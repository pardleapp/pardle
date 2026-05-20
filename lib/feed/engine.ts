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
  type PGAScorecard,
} from "@/lib/golf-api/pgatour";
import { analyzeHighlightHole, analyzeHole } from "./shot-analysis";
import { extractTrace, type TraceFocus } from "./shot-trace";
import {
  cacheLeaderboard,
  cacheTournamentPars,
  type Enrichment,
  getEnrichments,
  getEvents,
  getSnapshot,
  type PollSnapshot,
  type TournamentPars,
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
  type ScoreResult,
} from "./types";
import { classifyShot, parsePlayByPlay } from "./shot-pbp";
import {
  findOpenPollForHole,
  MAX_PUTT_FT,
  MIN_PUTT_FT,
  openPuttPoll,
  settlePuttPoll,
} from "./putt-polls";
import {
  buildContextTags,
  playedInOrderForRound,
} from "./event-context";

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

/**
 * Pack a player's scorecard for one round into the shape the streak
 * tagger expects. Returns null when the scorecard is missing or has
 * no played holes for that round.
 */
function streakInputsFor(
  scorecard: PGAScorecard | undefined,
  round: number,
  thru: string | undefined,
  freshResult: ScoreResult | null,
): {
  playedInOrder: { result: ScoreResult; holeNumber: number }[];
  freshResult: ScoreResult | null;
} | null {
  if (!scorecard) return null;
  const holes = scorecard.rounds[round];
  if (!holes || holes.length === 0) return null;
  const holesScored: Record<number, string> = {};
  const pars: Record<number, number> = {};
  for (const h of holes) {
    holesScored[h.holeNumber] = h.score;
    pars[h.holeNumber] = h.par;
  }
  const playedInOrder = playedInOrderForRound(holesScored, pars, thru);
  if (playedInOrder.length === 0) return null;
  return { playedInOrder, freshResult };
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

  // Cache the FULL leaderboard for /live — the top slice drives the
  // leaderboard panel, the whole list drives the player search box.
  await cacheLeaderboard(
    tournamentId,
    leaderboard.map((r) => ({
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
  const fresh: PollSnapshot = { holes: {}, positions: {}, shots: {} };
  for (const r of leaderboard) {
    fresh.positions[r.playerId] = r.position;
  }
  // Tournament-level hole pars (round → hole → par). Cached separately
  // so the bet-tracker can know remaining par for round-score bets
  // without needing a fresh orchestrator call from the client.
  const pars: TournamentPars = {};
  for (const [pid, sc] of Object.entries(scorecards)) {
    fresh.holes[pid] = {};
    for (const [roundStr, holes] of Object.entries(sc.rounds)) {
      const round = Number(roundStr);
      fresh.holes[pid][round] = {};
      if (!pars[round]) pars[round] = {};
      for (const h of holes) {
        fresh.holes[pid][round][h.holeNumber] = h.score;
        if (pars[round][h.holeNumber] == null) {
          pars[round][h.holeNumber] = h.par;
        }
      }
    }
    // Build the per-player shot signature. The playByPlay updates as
    // each stroke lands, so this changes minutes before the per-hole
    // score does — the source of the speed advantage.
    if (sc.currentHole != null && sc.playByPlay) {
      fresh.shots![pid] =
        `${sc.currentHole}:${sc.currentShotDisplay ?? ""}:${sc.playByPlay}`;
    }
  }
  if (Object.keys(pars).length > 0) {
    await cacheTournamentPars(tournamentId, pars);
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

  // Shot-level diff: the playByPlay field updates as each stroke
  // lands, ahead of the per-hole score. Detect signature changes and
  // surface reaction-worthy shots (long drives, stuffs, penalties).
  // De-dup against this poll's score events for the same hole — a
  // hole-out's last stroke shouldn't double-emit as a shot event
  // alongside the score event.
  // Skip the very first poll after the shots-tracking shipped (when
  // prev.shots is undefined) — every active player's signature would
  // look "new" and we'd flood the feed with retroactive shot events.
  const haveShotBaseline = prev.shots !== undefined;
  const scoredHoleByPlayer = new Set<string>(
    events.map((e) => `${e.playerId}:${e.round}:${e.hole}`),
  );
  for (const [pid, sc] of Object.entries(scorecards)) {
    if (!haveShotBaseline) break;
    const sig = fresh.shots?.[pid];
    if (!sig) continue;
    const prevSig = prev.shots?.[pid];
    if (sig === prevSig) continue;
    if (!sc.playByPlay || sc.currentHole == null) continue;

    const round = leaderboard.find((r) => r.playerId === pid)?.currentRound;
    if (round == null) continue;

    // Don't double-emit on a hole we already scored this poll.
    if (
      scoredHoleByPlayer.has(`${pid}:${round}:${sc.currentHole}`)
    ) {
      continue;
    }

    const parsed = parsePlayByPlay(sc.playByPlay);
    if (!parsed) continue;

    // Look up the par of the current hole (best-effort — falls back
    // to null if missing, which restricts long-drive emit).
    const par =
      sc.rounds[round]?.find((h) => h.holeNumber === sc.currentHole)?.par ??
      null;

    const shotNumber = Number(sc.currentShotDisplay) || 0;

    // ── Putt prediction polls ────────────────────────────────────
    // Whenever an approach (or par-3 tee shot) lands on the green at
    // a "guessable" distance, open a poll asking "will the putt drop?"
    // and emit a putt-poll feed event so the UI can render the vote
    // widget. The actual shot may still also qualify as a "stuffed"
    // event below — that's fine, they're separate rows.
    if (
      parsed.endsAt === "green" &&
      parsed.toHoleFeet !== null &&
      parsed.toHoleFeet >= MIN_PUTT_FT &&
      parsed.toHoleFeet <= MAX_PUTT_FT &&
      shotNumber >= 1
    ) {
      const playerName = nameById.get(pid) ?? "Unknown";
      const distFt = Math.round(parsed.toHoleFeet);
      // "For" label — what's at stake on this putt.
      let puttFor: "birdie" | "eagle" | "par save" | "the hole" = "the hole";
      if (par != null) {
        const next = shotNumber + 1;
        if (next === par - 1) puttFor = "eagle";
        else if (next === par) puttFor = "birdie";
        else if (next === par + 1) puttFor = "par save";
      }
      try {
        const pollId = await openPuttPoll({
          tournamentId,
          playerId: pid,
          playerName,
          round,
          hole: sc.currentHole,
          distanceFt: distFt,
          polledAtStroke: shotNumber,
          holePar: par,
        });
        if (pollId) {
          events.push({
            id: newEventId(now),
            tournamentId,
            ts: now,
            type: "putt-poll",
            playerId: pid,
            playerName,
            round,
            hole: sc.currentHole,
            par: par ?? undefined,
            pollId,
            puttDistanceFt: distFt,
            puttFor,
            headline:
              puttFor === "the hole"
                ? `${playerName} has ${distFt} ft on the ${ordinalHole(sc.currentHole)} — will it drop?`
                : `${playerName} has ${distFt} ft for ${puttFor} on the ${ordinalHole(sc.currentHole)} — will it drop?`,
            emoji: "🎯",
          });
        }
      } catch (err) {
        console.error("[feed] openPuttPoll failed", err);
      }
    }

    const verdict = classifyShot(parsed, shotNumber, par);
    if (!verdict) continue;

    const playerName = nameById.get(pid) ?? "Unknown";
    events.push({
      id: newEventId(now),
      tournamentId,
      ts: now,
      type: "shot",
      playerId: pid,
      playerName,
      round,
      hole: sc.currentHole,
      par: par ?? undefined,
      shotYards: parsed.shotYards ?? undefined,
      proximityInches:
        parsed.toHoleFeet != null
          ? Math.round(parsed.toHoleFeet * 12)
          : undefined,
      highlight: verdict.highlight,
      lowlight: verdict.lowlight,
      // Shot events live in the main feed only — they're often
      // followed minutes later by a score event for the same hole, so
      // putting them in reels would duplicate the moment. The reels
      // stay reserved for confirmed final outcomes (birdies, eagles,
      // disasters) decided once the hole completes.
      headline: `${playerName} ${verdict.verdict} on the ${ordinalHole(sc.currentHole)}`,
      emoji: verdict.emoji,
    });
  }

  // ── Context tags ────────────────────────────────────────────────
  // Annotate each event with the data-first chips that make routine
  // moments read as moments — "Now solo leader", "5 of last 7 in red",
  // "3 bogeys in a row". Stateless: derived from the same snapshot +
  // leaderboard we already have in hand.
  const positionByPid = new Map(
    leaderboard.map((r) => [r.playerId, r.position]),
  );
  const thruByPid = new Map(leaderboard.map((r) => [r.playerId, r.thru]));
  for (const ev of events) {
    const freshPos = positionByPid.get(ev.playerId);
    const prevPos = prev.positions[ev.playerId];
    let streak: ReturnType<typeof streakInputsFor> = null;
    if (ev.type === "score" && ev.round != null) {
      streak = streakInputsFor(
        scorecards[ev.playerId],
        ev.round,
        thruByPid.get(ev.playerId),
        ev.result ?? null,
      );
    }
    const tags = buildContextTags({
      prevPosition: prevPos,
      freshPosition: freshPos,
      streak,
    });
    if (tags.length > 0) ev.tags = tags;
  }

  // Order events so the "most interesting" land last (= top of feed
  // after LPUSH). Aces loudest, then albatross/eagle, blow-ups,
  // stuffed approaches, penalties, birdies, drives.
  const interestOf = (e: FeedEvent): number => {
    if (e.ace) return 10;
    if (e.result === "albatross") return 9;
    if (e.result === "eagle") return 8;
    if (e.type === "shot") {
      if (e.highlight) return 6; // stuffed approach
      if (e.lowlight) return 5; // penalty
      return 2; // long drive
    }
    if (e.result === "triple-plus") return 4;
    if (e.result === "double") return 3;
    if (e.result === "birdie") return 2;
    if (e.result === "bogey") return 1;
    return 0;
  };
  events.sort((a, b) => interestOf(a) - interestOf(b));

  // ── Settle any open putt polls whose hole just completed ──────
  // Score events tell us the final strokes for a hole; if there was
  // an open poll waiting on that hole, we know whether the putt
  // dropped (finalStrokes === polledAtStroke + 1).
  const scoreEventsThisPoll = events.filter(
    (e) => e.type === "score" && e.hole != null && e.strokes != null,
  );
  if (scoreEventsThisPoll.length > 0) {
    await Promise.all(
      scoreEventsThisPoll.map(async (e) => {
        try {
          const pollId = await findOpenPollForHole(
            tournamentId,
            e.playerId,
            e.round,
            e.hole!,
          );
          if (pollId) await settlePuttPoll(pollId, e.strokes!);
        } catch (err) {
          console.error("[feed] settlePuttPoll failed", err);
        }
      }),
    );
  }

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
      const autoGreat =
        e.result === "albatross" || e.result === "eagle";
      const g = analyzeHighlightHole(hole.strokes);
      reelGreat = autoGreat || g.great;
      // Long putts and short chip-ins zoom to the green; longer
      // hole-outs (yards) show the whole hole so the distance reads.
      focus =
        g.kind === "longputt" || g.kind === "chipin" ? "putt" : "holeout";
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
    let trace = extractTrace(
      hole.strokes,
      focus,
      hole.holeImage,
      hole.greenImage,
    );
    // Chip-ins occasionally start outside the green-diagram bounds —
    // when the green-zoom can't draw the key stroke, fall back to the
    // whole-hole view so we still show something accurate.
    if (trace.segments.length === 0 && focus === "putt") {
      trace = extractTrace(
        hole.strokes,
        "holeout",
        hole.holeImage,
        hole.greenImage,
      );
    }
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
