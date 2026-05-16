import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { pollAndDiff } from "@/lib/feed/engine";
import {
  acquirePollLock,
  computeFieldStats,
  getCommentCountsBulk,
  getFeedBundle,
  getReactionsBulk,
  markSeenToday,
  touchPresence,
  type FieldHoleStats,
  type PlayerSkillMap,
} from "@/lib/feed/store";
import { ensurePlayerSkill } from "@/lib/feed/skill-cache";
import { findOddsShift } from "@/lib/feed/odds-store";
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
    }
  }

  // Pipelined single-HTTP-request fetch of every read this endpoint
  // needs except per-event reaction/comment lookups (those depend on
  // which event ids ended up visible). Drops the request count to
  // Upstash from ~10/request down to 2/request.
  const bundle = await getFeedBundle(tournament.id);
  const allEvents = bundle.events;
  const feedEvents = allEvents.slice(0, 80);
  const reelSource = allEvents.slice(0, 400);
  const bursts = bundle.bursts;
  const leaderboard = bundle.leaderboard;
  const enrichments = bundle.enrichments;

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
  // Odds buffers come from the pipelined bundle — no extra HTTP call.
  const oddsBuffers = bundle.oddsBuffers;
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

  // Field hole-by-hole stats — aggregate of (strokes − par) across
  // every player who's completed each hole this tournament. Powers
  // the round-score bet model's "expected remaining" projection. Free
  // because the snapshot is already loaded from the bundle.
  const fieldStats = computeFieldStats(bundle.snapshot, bundle.pars);

  // Per-player DataGolf SG_total (strokes-gained per round). 24h
  // cache; fetches lazily on miss. Returns {} on DataGolf failure so
  // the model degrades to "no skill adjustment" rather than blowing
  // up the route.
  const playerSkill = await ensurePlayerSkill(tournament.id, leaderboard);

  // Per-player round state from the (already-fetched) snapshot + par
  // map. Also bakes in the round-score model's expectedRemaining +
  // variance for each player+round so the client just plugs into a
  // CDF — no per-bet model evaluation server work.
  const playerRoundStates = computePlayerRoundStates(
    bundle.snapshot,
    bundle.pars,
    fieldStats,
    playerSkill,
  );

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
    // Per-player rolling odds buffer (~last few hours of mid-price
    // samples). Used by the bet tracker to reconstruct PnL history
    // server-driven, so charts cover the period a user was off-page.
    oddsHistories: oddsBuffers,
    /** DataGolf in-play win-prob buffer per player — outright chart's
     *  fallback when Polymarket is thin (longshots, illiquid markets). */
    dgWinProbs: bundle.dgWinProbs,
    playerRoundStates,
    fieldStats,
    playerSkill,
    tournamentPars: bundle.pars,
    watching,
    seenToday,
    polled,
  });
}

/**
 * Build per-player current-round state for the bet-tracker's
 * round-score bets. Reads the existing snapshot (scores per round)
 * and the tournament pars cache (par per round per hole).
 *
 * Each entry tells the client:
 *   - which round to bet on (currentRound)
 *   - what the player has scored so far + what par they've played
 *   - how many holes + par remain
 *   - their tournament-to-date pace (to-par per hole) — used as a
 *     skill prior when projecting the rest of the round
 */
function computePlayerRoundStates(
  snap: import("@/lib/feed/store").FeedBundle["snapshot"],
  pars: import("@/lib/feed/store").FeedBundle["pars"],
  fieldStats: FieldHoleStats,
  playerSkill: PlayerSkillMap,
): Record<string, PlayerRoundState> {
  if (!snap) return {};
  const result: Record<string, PlayerRoundState> = {};
  const MIN_SAMPLE = 10;
  const FALLBACK_VAR = 0.65;

  /** Per-hole (mean, variance). Walks fall-back hierarchy if the
   *  current-round sample for this hole is too thin: try every prior
   *  round of the same hole; fail over to par + constant variance. */
  function holeStat(
    round: number,
    hole: number,
  ): { mean: number; variance: number } {
    const s = fieldStats[round]?.[hole];
    if (s && s.count >= MIN_SAMPLE) return { mean: s.mean, variance: s.variance };
    for (let r = round - 1; r >= 1; r--) {
      const prior = fieldStats[r]?.[hole];
      if (prior && prior.count >= MIN_SAMPLE) {
        return { mean: prior.mean, variance: prior.variance };
      }
    }
    return { mean: 0, variance: FALLBACK_VAR };
  }

  for (const [pid, byRound] of Object.entries(snap.holes)) {
    // Tournament-to-date pace — kept for legacy clients on this
    // payload; the new round-score model uses skillPerHole instead.
    let ttdStrokes = 0;
    let ttdPar = 0;
    let ttdHoles = 0;
    for (const [rStr, holes] of Object.entries(byRound)) {
      const r = Number(rStr);
      const pr = pars[r] ?? {};
      for (const [holeStr, scoreStr] of Object.entries(holes)) {
        const p = pr[Number(holeStr)];
        if (p == null) continue;
        const played =
          scoreStr !== "" &&
          scoreStr !== "-" &&
          Number.isFinite(Number(scoreStr));
        if (!played) continue;
        ttdStrokes += Number(scoreStr);
        ttdPar += p;
        ttdHoles++;
      }
    }
    const ttdPacePerHole = ttdHoles > 0 ? (ttdStrokes - ttdPar) / ttdHoles : 0;

    const skillPerHole = (playerSkill[pid] ?? 0) / 18;

    // Per-round snapshot for ALL four rounds the orchestrator knows
    // about — round-score bets can target any round, not just the
    // currently-live one.
    const rounds: Record<number, RoundSnapshot> = {};
    let currentRound = 0;
    for (let r = 1; r <= 4; r++) {
      const pl = pars[r];
      const holes = byRound[r];
      if (!pl || Object.keys(pl).length === 0) continue;
      let strokes = 0;
      let parPlayed = 0;
      let holesPlayed = 0;
      let roundPar = 0;
      let parRemaining = 0;
      let holesRemaining = 0;
      let anyPlayed = false;
      // Round-score model running totals: walk the remaining holes
      // and sum (par + fieldMean - skillPerHole) for the projection
      // mean, sum fieldVar for the projection variance.
      let expectedRemaining = 0;
      let variance = 0;
      for (const [holeStr, par] of Object.entries(pl)) {
        const hole = Number(holeStr);
        roundPar += par;
        const scoreStr = holes?.[hole];
        const played =
          scoreStr != null &&
          scoreStr !== "" &&
          scoreStr !== "-" &&
          Number.isFinite(Number(scoreStr));
        if (played) {
          strokes += Number(scoreStr);
          parPlayed += par;
          holesPlayed++;
          anyPlayed = true;
        } else {
          parRemaining += par;
          holesRemaining++;
          const stat = holeStat(r, hole);
          expectedRemaining += par + stat.mean - skillPerHole;
          variance += stat.variance;
        }
      }
      rounds[r] = {
        holesPlayed,
        holesRemaining,
        strokes,
        parPlayed,
        parRemaining,
        roundPar,
        toPar: strokes - parPlayed,
        status:
          holesRemaining === 0 && anyPlayed
            ? "complete"
            : anyPlayed
            ? "in-progress"
            : "not-started",
        expectedRemaining,
        variance,
      };
      if (anyPlayed && r > currentRound) currentRound = r;
    }

    // "currentRound" semantics for callers that want a single number:
    // - mid-round → that round
    // - between rounds (just finished R2, R3 not started) → R3 if it
    //   exists as a known-par round, else the last played round
    let liveOrNextRound = currentRound;
    if (currentRound > 0 && rounds[currentRound]?.status === "complete") {
      const next = currentRound + 1;
      if (rounds[next]) liveOrNextRound = next;
    }

    const top = liveOrNextRound > 0 ? rounds[liveOrNextRound] : null;
    if (!top) continue;

    result[pid] = {
      currentRound: liveOrNextRound,
      holesPlayed: top.holesPlayed,
      holesRemaining: top.holesRemaining,
      strokes: top.strokes,
      parPlayed: top.parPlayed,
      parRemaining: top.parRemaining,
      roundPar: top.roundPar,
      toPar: top.toPar,
      ttdPacePerHole,
      ttdHoles,
      rounds,
    };
  }
  return result;
}

interface RoundSnapshot {
  holesPlayed: number;
  holesRemaining: number;
  strokes: number;
  parPlayed: number;
  parRemaining: number;
  roundPar: number;
  toPar: number;
  status: "not-started" | "in-progress" | "complete";
  /** Round-score model projection of remaining strokes (field-anchored,
   *  skill-adjusted). 0 when the round is complete. */
  expectedRemaining: number;
  /** Variance of the projection (sum of per-hole variance for remaining). */
  variance: number;
}

interface PlayerRoundState {
  /** The round that's live OR the next one to start if between rounds. */
  currentRound: number;
  holesPlayed: number;
  holesRemaining: number;
  strokes: number;
  parPlayed: number;
  parRemaining: number;
  roundPar: number;
  toPar: number;
  /** Tournament-to-date pace, in strokes-vs-par per hole. */
  ttdPacePerHole: number;
  ttdHoles: number;
  /** Per-round breakdown (1..4) — used by bets targeting a specific round. */
  rounds: Record<number, RoundSnapshot>;
}
