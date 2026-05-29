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
  getCachedPlayerSkill,
  getCachedTournamentPars,
  getEnrichments,
  getEvents,
  getSnapshot,
  type PollSnapshot,
  type TournamentPars,
  pushEvents,
  putEnrichments,
  putSnapshot,
} from "./store";
import { bustLiveStatsCacheIfFresh } from "./live-stats-cache";
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
import { seasonFormTag } from "./season-form";
import { samplePositions } from "./position-trajectory";
import { openPredictionPoll } from "./prediction-polls";

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

/** Parse the orchestrator's to-par display string ("-3" / "E" / "+5")
 *  into a signed number. Returns null when the string isn't parseable. */
function parseTotalToParNum(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  if (t === "E" || t === "0") return 0;
  // Handles both "-3" and "+5"; Number("+5") === 5.
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Inverse of parseTotalToParNum — "-3" / "E" / "+5". */
function formatToParNum(n: number): string {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return String(n);
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
  // Player → overall to-par display string ("-7" / "E" / "+3"). Baked
  // onto score events so the feed row can show the player's running
  // tournament total alongside the per-hole result.
  const totalById = new Map(leaderboard.map((r) => [r.playerId, r.total]));
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

  // Sample every active player's current rank into the trajectory
  // store — feeds the rank sparkline in the inline scorecard panel.
  // Throttled per-player to one sample every 5 min, so this no-ops
  // when pollAndDiff runs more frequently than that.
  await samplePositions(
    tournamentId,
    leaderboard
      .filter((r) => !INACTIVE_STATES.has(r.playerState))
      .map((r) => ({ playerId: r.playerId, position: r.position })),
  ).catch((err) => {
    console.error("[engine] samplePositions failed", err);
  });

  // Open prediction polls when their triggers fire. Each call is
  // idempotent via a per-tournament dedup flag, so calling on
  // every pollAndDiff tick is cheap.
  await maybeOpenPredictionPolls(tournamentId, leaderboard).catch((err) => {
    console.error("[engine] maybeOpenPredictionPolls failed", err);
  });

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
  // Every hole completion this poll, including pars. Pars don't get
  // a feed event (they're not reaction-worthy), but they still close
  // out any open putt poll on that hole — a "putt for birdie" that
  // misses + taps in for par needs to settle the same as one that
  // drops.
  const holeCompletions: {
    playerId: string;
    round: number;
    hole: number;
    strokes: number;
  }[] = [];

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

        holeCompletions.push({
          playerId: pid,
          round,
          hole: h.holeNumber,
          strokes,
        });

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
          toPar: totalById.get(pid),
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
      // "For" label — what's at stake on this putt. The just-landed
      // shot is #shotNumber; the upcoming putt is shot #(shotNumber+1)
      // and its drop closes the hole at that stroke count. So a putt
      // for eagle on a par 4 = score 2 = putt is shot #2 = next===par−2.
      // The previous version was off by one — labelling regulation
      // birdie putts as eagle.
      let puttFor: "birdie" | "eagle" | "par save" | "the hole" = "the hole";
      if (par != null) {
        const next = shotNumber + 1;
        if (next === par - 2) puttFor = "eagle";
        else if (next === par - 1) puttFor = "birdie";
        else if (next === par) puttFor = "par save";
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

  // Field-rank pre-pass. For each (result, round) combo referenced by
  // any score event in this poll, build a `playerId → count` map by
  // sweeping every player's scorecard once. Lets us tag "most birdies
  // in field today" / "2nd-most" etc. without a per-event re-scan.
  const interestingResults = new Set<string>();
  const interestingRounds = new Set<number>();
  for (const ev of events) {
    if (ev.type === "score" && ev.result != null && ev.round != null) {
      interestingResults.add(ev.result);
      interestingRounds.add(ev.round);
    }
  }
  const fieldCounts: Record<string, Record<number, Map<string, number>>> = {};
  if (interestingResults.size > 0 && interestingRounds.size > 0) {
    for (const r of interestingResults) {
      fieldCounts[r] = {};
      for (const round of interestingRounds) {
        fieldCounts[r][round] = new Map();
      }
    }
    for (const [pid, sc] of Object.entries(scorecards)) {
      for (const [roundStr, holes] of Object.entries(sc.rounds)) {
        const round = Number(roundStr);
        if (!interestingRounds.has(round)) continue;
        for (const h of holes) {
          const score = Number(h.score);
          if (!Number.isFinite(score) || score <= 0) continue;
          const r = resultFor(score, h.par);
          if (!interestingResults.has(r)) continue;
          const cur = fieldCounts[r][round].get(pid) ?? 0;
          fieldCounts[r][round].set(pid, cur + 1);
        }
      }
    }
  }
  function rankForEvent(ev: FeedEvent):
    | { count: number; strictlyMore: number; tiedWith: number }
    | null {
    if (
      ev.type !== "score" ||
      ev.result == null ||
      ev.round == null
    ) {
      return null;
    }
    const byRound = fieldCounts[ev.result];
    if (!byRound) return null;
    const counts = byRound[ev.round];
    if (!counts) return null;
    const myCount = counts.get(ev.playerId) ?? 0;
    if (myCount === 0) return null;
    let strictlyMore = 0;
    let tiedWith = 0;
    for (const [pid, c] of counts.entries()) {
      if (pid === ev.playerId) continue;
      if (c > myCount) strictlyMore++;
      else if (c === myCount) tiedWith++;
    }
    return { count: myCount, strictlyMore, tiedWith };
  }

  // Pre-compute the per-player+round play-order with strokes/par detail
  // so each event can have its tags + toPar baked AS OF that event's
  // hole, not as of the final scorecard state. Without this, multiple
  // birdies detected in a single poll cycle all read "Nth birdie of
  // the round" with the same N (the final count) and the same
  // tournament-total to-par.
  interface PlayedEntry {
    holeNumber: number;
    result: ScoreResult;
    strokes: number;
    par: number;
  }
  const orderByKey = new Map<string, PlayedEntry[]>();
  const buildOrderFor = (pid: string, round: number): PlayedEntry[] => {
    const sc = scorecards[pid];
    if (!sc) return [];
    const holes = sc.rounds[round];
    if (!holes) return [];
    const holesScored: Record<number, string> = {};
    const pars: Record<number, number> = {};
    for (const h of holes) {
      holesScored[h.holeNumber] = h.score;
      pars[h.holeNumber] = h.par;
    }
    const order = playedInOrderForRound(
      holesScored,
      pars,
      thruByPid.get(pid),
    );
    return order
      .map((h) => {
        const strokes = Number(holesScored[h.holeNumber]);
        const par = pars[h.holeNumber];
        if (!Number.isFinite(strokes) || !par) return null;
        return { ...h, strokes, par };
      })
      .filter((x): x is PlayedEntry => x !== null);
  };

  for (const ev of events) {
    const freshPos = positionByPid.get(ev.playerId);
    const prevPos = prev.positions[ev.playerId];
    let streak: ReturnType<typeof streakInputsFor> = null;
    if (ev.type === "score" && ev.round != null && ev.hole != null) {
      const key = `${ev.playerId}:${ev.round}`;
      let order = orderByKey.get(key);
      if (!order) {
        order = buildOrderFor(ev.playerId, ev.round);
        orderByKey.set(key, order);
      }
      const idx = order.findIndex((h) => h.holeNumber === ev.hole);
      if (idx >= 0) {
        // Streak input only sees holes played up to and including this
        // event's hole — so withinRoundTag emits "3rd birdie" for the
        // 3rd, "4th" for the 4th, even when both landed in the same poll.
        streak = {
          playedInOrder: order.slice(0, idx + 1),
          freshResult: ev.result ?? null,
        };
        // Adjust the baked toPar to subtract the score contributions of
        // any later-in-play-order holes that also landed this poll cycle.
        // (totalById is the current cumulative; later strokes-vs-par
        // would still be "in" that number, so we unwind them.)
        const currentTotalStr = totalById.get(ev.playerId);
        const currentTotal = parseTotalToParNum(currentTotalStr);
        if (currentTotal != null) {
          let laterDiff = 0;
          for (let i = idx + 1; i < order.length; i++) {
            laterDiff += order[i].strokes - order[i].par;
          }
          ev.toPar = formatToParNum(currentTotal - laterDiff);
        }
      } else {
        // Fallback when the hole isn't yet visible in the scorecard
        // (defensive — shouldn't happen because the event was created
        // from the same diff that updated the snapshot).
        streak = streakInputsFor(
          scorecards[ev.playerId],
          ev.round,
          thruByPid.get(ev.playerId),
          ev.result ?? null,
        );
      }
    }
    const tags = buildContextTags({
      prevPosition: prevPos,
      freshPosition: freshPos,
      streak,
      fieldRank: rankForEvent(ev),
    });
    // Season-form chip is the editorial layer: "Coming off T-3" /
    // "3 top-10s in 5 starts" / "Bouncing back from MC". Sits behind
    // the position/streak chips on priority since those describe
    // *this* moment, but rounds out the row when only one immediate
    // tag has fired.
    const seasonTag = seasonFormTag(ev.playerName);
    if (seasonTag && !tags.includes(seasonTag)) tags.push(seasonTag);
    if (tags.length > 0) ev.tags = tags.slice(0, 3);
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
  // Hole completions tell us the final strokes; if there was an
  // open poll waiting on that hole, we know whether the putt
  // dropped (finalStrokes === polledAtStroke + 1). Pars are part of
  // this loop too — a missed birdie putt + tap-in for par needs to
  // settle the open poll just like a dropped one.
  if (holeCompletions.length > 0) {
    await Promise.all(
      holeCompletions.map(async (c) => {
        try {
          const pollId = await findOpenPollForHole(
            tournamentId,
            c.playerId,
            c.round,
            c.hole,
          );
          if (pollId) await settlePuttPoll(pollId, c.strokes);
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

  // Force-refresh the in-tournament SG stats cache when a top-skill
  // player drops a stroke this poll. The default 5-min TTL means the
  // player page can show "SG #1 in field" for a top player who just
  // went bogey-bogey — the exact moment users zoom in. Busting the
  // cache lets the next view fetch fresh from DataGolf (which itself
  // lags ~2 min, but that's the irreducible floor).
  try {
    const lowlightPids = new Set<string>();
    for (const e of events) {
      if (
        e.type === "score" &&
        (e.result === "bogey" ||
          e.result === "double" ||
          e.result === "triple-plus")
      ) {
        lowlightPids.add(e.playerId);
      }
    }
    if (lowlightPids.size > 0) {
      const skill = await getCachedPlayerSkill(tournamentId);
      if (skill) {
        // DataGolf sg_total: higher = better player. Top-20 covers
        // the names users actually have on their bet slips.
        const topIds = new Set(
          Object.entries(skill)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 20)
            .map(([id]) => id),
        );
        const busted = [...lowlightPids].some((id) => topIds.has(id));
        if (busted) await bustLiveStatsCacheIfFresh(tournamentId);
      }
    }
  } catch (err) {
    console.error("[feed] livestats force-refresh failed", err);
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
/** Strip "T" prefix from a leaderboard position string, return
 *  numeric rank or null for non-numeric (CUT/WD/--). */
function rankOf(position: string): number | null {
  if (!position) return null;
  const m = position.match(/^T?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** True when two players' `thru` values indicate they're at the
 *  same point in the round — same starting nine, same holes
 *  completed, both ≤ 2 holes in. Used to constrain the marquee
 *  head-to-head to pairings/tee-mates so the poll doesn't ask a
 *  user to call Player A (thru 8) vs Player B (thru 0). */
function sameTeePoint(a: string | null, b: string | null): boolean {
  const norm = (t: string | null): { holes: number; back: boolean } | null => {
    if (!t) return null;
    const s = t.trim();
    if (s === "" || s === "-" || s === "—") return { holes: 0, back: false };
    if (s === "F" || s === "F*") return null; // round done — never a "tee" point
    const m = /^(\d+)(\*?)$/.exec(s);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    return { holes: n, back: m[2] === "*" };
  };
  const aa = norm(a);
  const bb = norm(b);
  if (!aa || !bb) return false;
  // Both players must have NOT YET teed off. Once either has played
  // a hole the question loses its pre-game tension — we don't want
  // a Sunday call to ask "who shoots lower" when one of them is
  // already 1-2 strokes into the round.
  return aa.holes === 0 && bb.holes === 0;
}

/** Parse `thru` field ("9", "9*", "F", "-", "") into a count of
 *  holes completed this round. F → 18, blank/- → 0. */
function parseThruHoles(thru: string | null | undefined): number {
  if (!thru) return 0;
  const t = thru.trim();
  if (t === "" || t === "-" || t === "—") return 0;
  if (t === "F" || t === "F*") return 18;
  const m = /^(\d+)\*?$/.exec(t);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(18, n)) : 0;
}

/** Sum a {hole → par} map for the round; null if the map's missing
 *  or doesn't cover the full 18 holes. */
function sumRoundPars(
  pr: Record<number, number> | undefined,
): number | null {
  if (!pr) return null;
  let sum = 0;
  let n = 0;
  for (let h = 1; h <= 18; h++) {
    const p = pr[h];
    if (typeof p === "number" && Number.isFinite(p)) {
      sum += p;
      n++;
    }
  }
  return n === 18 ? sum : null;
}

/** Round a stroke expectation to the nearest .5, biasing toward the
 *  "under" side so settlement can never push. e.g. 67.4 → 67.5,
 *  68.0 → 67.5, 68.4 → 68.5. */
function roundToHalfStrokeUnder(x: number): number {
  const nearest = Math.round(x * 2) / 2;
  return Number.isInteger(nearest) ? nearest - 0.5 : nearest;
}

/** Parse total-to-par like "-12", "+3", "E" into a numeric stroke
 *  diff for hold-the-lead margin checks. Null for non-numeric. */
function toParOf(total: string): number | null {
  if (!total) return null;
  if (total === "E") return 0;
  const n = Number(total);
  return Number.isFinite(n) ? n : null;
}

/**
 * Trigger logic for prediction polls. Called on every pollAndDiff
 * tick; openPredictionPoll's dedup flag means we never double-open
 * the same trigger.
 *
 *  - Head-to-head (leaderboard): open one per round on R3 and R4,
 *    between the top 2 by current leaderboard position. Closes 8h
 *    later (round-completion window).
 *  - Head-to-head (marquee): R1/R2 only — between the top 2 still-
 *    active players by DataGolf pre-tournament SG, so users get
 *    something to vote on before the leaderboard is meaningful.
 *  - Hold-the-lead: open on R4 once the leader has reached the
 *    back 9 with a 2+ stroke lead. Closes 6h later (tournament-end
 *    window).
 *  - Round over/under: per top-6 skill player, open as soon as
 *    they tee off in any round. Line is roundPar − SG, rounded to
 *    nearest .5 with whole numbers nudged down so there's no push.
 */
async function maybeOpenPredictionPolls(
  tournamentId: string,
  leaderboard: Array<{
    playerId: string;
    displayName: string;
    position: string;
    total: string;
    thru: string;
    currentRound: number | null;
    playerState: string;
  }>,
): Promise<void> {
  const active = leaderboard.filter((r) => !INACTIVE_STATES.has(r.playerState));
  if (active.length < 2) return;

  // Top 2 by current rank (skipping unranked).
  const ranked = active
    .map((r) => ({ row: r, rank: rankOf(r.position) }))
    .filter((x): x is { row: typeof active[number]; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank);
  if (ranked.length < 2) return;

  const leader = ranked[0];
  const chaser = ranked[1];
  const rounds = active
    .map((r) => r.currentRound)
    .filter((n): n is number => typeof n === "number" && n >= 1 && n <= 4);
  if (rounds.length === 0) return;
  const maxRound = Math.max(...rounds);

  const HOUR = 60 * 60 * 1000;

  // ── Head-to-head ───────────────────────────────────────────────
  // Fire only on R3 and R4 — early rounds have too much top-of-
  // leaderboard volatility to make a meaningful 2-player call.
  if (maxRound === 3 || maxRound === 4) {
    if (leader.row.playerId !== chaser.row.playerId) {
      await openPredictionPoll({
        type: "head-to-head",
        tournamentId,
        dedupKey: `h2h:r${maxRound}`,
        question: `Who shoots lower in R${maxRound}?`,
        options: [
          {
            key: leader.row.playerId,
            label: leader.row.displayName,
            playerId: leader.row.playerId,
          },
          {
            key: chaser.row.playerId,
            label: chaser.row.displayName,
            playerId: chaser.row.playerId,
          },
          { key: "tie", label: "Tied" },
        ],
        closesAt: Date.now() + 8 * HOUR,
        settle: {
          round: maxRound,
          playerA: { id: leader.row.playerId, name: leader.row.displayName },
          playerB: { id: chaser.row.playerId, name: chaser.row.displayName },
        },
      }).catch((err) => {
        console.error("[engine] open h2h failed", err);
      });
    }
  }

  // ── Marquee head-to-head (R1/R2) ───────────────────────────────
  // Pick the best PAIRING by DataGolf pre-tournament SG, where
  // "pairing" means two players who are at the same point in their
  // round right now (same starting nine, same thru count, both ≤ 2
  // holes in). Without this guard we'd happily match a Scheffler
  // who's already thru 8 against a Rahm at thru 0 — one of them
  // would be 4 holes ahead before the poll even opened.
  if (maxRound === 1 || maxRound === 2) {
    const skill = await getCachedPlayerSkill(tournamentId).catch(() => null);
    if (skill) {
      // Sort all active players with a known skill by skill desc.
      const skilled = active
        .map((r) => ({ row: r, sg: skill[r.playerId] }))
        .filter(
          (x): x is { row: typeof active[number]; sg: number } =>
            typeof x.sg === "number" && Number.isFinite(x.sg),
        )
        .sort((a, b) => b.sg - a.sg);
      // Find the strongest skill-sum pair sharing a tee point. Cap
      // the search at the top 16 so a long field doesn't push us
      // toward N² work on every tick.
      const candidates = skilled.slice(0, 16);
      let bestPair: { a: typeof candidates[number]; b: typeof candidates[number] } | null = null;
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          if (sameTeePoint(candidates[i].row.thru, candidates[j].row.thru)) {
            bestPair = { a: candidates[i], b: candidates[j] };
            i = candidates.length; // break outer
            break;
          }
        }
      }
      if (bestPair && bestPair.a.row.playerId !== bestPair.b.row.playerId) {
        const a = bestPair.a.row;
        const b = bestPair.b.row;
        await openPredictionPoll({
          type: "head-to-head",
          tournamentId,
          dedupKey: `h2h:marquee:r${maxRound}`,
          question: `Who shoots lower in R${maxRound}?`,
          options: [
            { key: a.playerId, label: a.displayName, playerId: a.playerId },
            { key: b.playerId, label: b.displayName, playerId: b.playerId },
            { key: "tie", label: "Tied" },
          ],
          closesAt: Date.now() + 10 * HOUR,
          settle: {
            round: maxRound,
            playerA: { id: a.playerId, name: a.displayName },
            playerB: { id: b.playerId, name: b.displayName },
          },
        }).catch((err) => {
          console.error("[engine] open marquee h2h failed", err);
        });
      }
    }
  }

  // ── Round over/under ───────────────────────────────────────────
  // Per top-6 skill player, once they've teed off this round. Line
  // is roundPar − SG, half-stroke (always a non-integer) so settles
  // can't push.
  {
    const [skill, pars] = await Promise.all([
      getCachedPlayerSkill(tournamentId).catch(() => null),
      getCachedTournamentPars(tournamentId).catch(() => ({}) as TournamentPars),
    ]);
    if (skill) {
      const topSkill = Object.entries(skill)
        .map(([id, sg]) => ({ id, sg }))
        .filter(
          (x): x is { id: string; sg: number } =>
            typeof x.sg === "number" && Number.isFinite(x.sg),
        )
        .sort((a, b) => b.sg - a.sg)
        .slice(0, 6);
      for (const { id, sg } of topSkill) {
        const row = active.find((r) => r.playerId === id);
        if (!row || row.currentRound == null) continue;
        const round = row.currentRound;
        const holesPlayed = parseThruHoles(row.thru);
        // Pre-tee-off only: voting on "will X shoot under 67.5?"
        // makes sense BEFORE they hit their first shot, not after.
        // Once thru ≥ 1 we already know the first hole's score and
        // the question is no longer a pure prediction. The /api/feed
        // filter also drops these on read; this stops the engine
        // from opening polls that would immediately be filtered.
        if (holesPlayed !== 0) continue;
        const parsForRound = pars?.[round];
        if (!parsForRound) continue;
        const roundPar = sumRoundPars(parsForRound);
        if (roundPar == null) continue;
        const expected = roundPar - sg;
        const line = roundToHalfStrokeUnder(expected);
        await openPredictionPoll({
          type: "round-over-under",
          tournamentId,
          dedupKey: `round-ou:p${id}:r${round}`,
          question: `Will ${row.displayName} shoot under ${line} in R${round}?`,
          options: [
            { key: "yes", label: `Yes — under ${line}` },
            { key: "no", label: `No — ${line} or worse` },
          ],
          closesAt: Date.now() + 10 * HOUR,
          settle: {
            round,
            player: { id, name: row.displayName },
            line,
          },
        }).catch((err) => {
          console.error("[engine] open round-ou failed", err);
        });
      }
    }
  }

  // ── Hold-the-lead ──────────────────────────────────────────────
  // R4 only, leader has reached the back 9 with at least a 2-stroke
  // cushion. By the time we open the poll the user has ~2-3 hours
  // to call it and the resolution is genuinely uncertain.
  if (maxRound === 4) {
    const leaderRow = leader.row;
    const leaderThru = leaderRow.thru;
    const thruNum = Number(leaderThru);
    // "Through" can be "F", "1*", "9", etc. Numeric through-hole
    // counter falls back to 0 when non-numeric.
    const holesPlayed = Number.isFinite(thruNum) ? thruNum : 0;
    if (holesPlayed >= 9 && holesPlayed < 15) {
      const leaderToPar = toParOf(leaderRow.total);
      const chaserToPar = toParOf(chaser.row.total);
      const lead =
        leaderToPar != null && chaserToPar != null
          ? chaserToPar - leaderToPar
          : 0;
      if (lead >= 2) {
        await openPredictionPoll({
          type: "hold-the-lead",
          tournamentId,
          dedupKey: "hold-the-lead:r4",
          question: `Will ${leaderRow.displayName} still be leading at the 72nd?`,
          options: [
            { key: "yes", label: `Yes — ${leaderRow.displayName} holds on` },
            { key: "no", label: "No — someone catches him" },
          ],
          closesAt: Date.now() + 6 * HOUR,
          settle: {
            leader: { id: leaderRow.playerId, name: leaderRow.displayName },
          },
        }).catch((err) => {
          console.error("[engine] open hold-the-lead failed", err);
        });
      }
    }
  }
}

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
