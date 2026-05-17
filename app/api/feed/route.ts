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
  pushWinningScoreSnapshot,
  touchPresence,
  type FieldHoleStats,
  type PlayerSkillMap,
  type WinningScoreSnapshot,
} from "@/lib/feed/store";
import { simulateTopFinish } from "@/lib/feed/top-finish-model";
import {
  getHotTopFinish,
  getTopFinishHistory,
  HISTORY_MIN_GAP_MS,
  pushTopFinishSnapshot,
  setHotTopFinish,
  type TopFinishSnapshot,
} from "@/lib/feed/top-finish-cache";
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
  // variance for each player+round, plus a tournament-total
  // projection used by the winning-score bet model.
  const { roundStates: playerRoundStates, tournamentProjections } =
    computePlayerRoundStates(
      bundle.snapshot,
      bundle.pars,
      fieldStats,
      playerSkill,
      leaderboard,
    );

  // Maintain a rolling history of the winning-score CDF for the bet
  // detail chart. Append at most one snapshot per minute regardless
  // of how often /api/feed is hit.
  const winningScoreHistory = await maybeAppendWinningScoreSnapshot(
    tournament.id,
    tournamentProjections,
    bundle.winningScoreHistory,
  );

  // Top-finish probabilities (top-5 / top-10 / top-20) via 5K-sim MC
  // on the same per-player projections. Hot cache short-circuits when
  // a recent result is available; otherwise we run the MC inline.
  const topFinish = await getOrComputeTopFinish(
    tournament.id,
    tournamentProjections,
  );
  const topFinishHistory = await getTopFinishHistory(tournament.id);

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
    /** DraftKings top-X decimal odds buffers. cutoff → playerId →
     *  rolling samples. Source of truth for top-finish bet pricing. */
    dkTopOdds: bundle.dkTopOdds,
    playerRoundStates,
    /** Per-player N(mean, variance) projection of final 4-round
     *  strokes. Powers the winning-score min-of-normals model. */
    tournamentProjections,
    winningScoreHistory,
    /** Per-player model probabilities for top-5 / top-10 / top-20.
     *  Source: server-side 5K-sim Monte Carlo with fractional
     *  dead-heat counting. Same projections as the winning-score model. */
    topFinishCurrent: topFinish,
    topFinishHistory,
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
  leaderboard: import("@/lib/feed/store").CachedLeaderboardRow[],
): {
  roundStates: Record<string, PlayerRoundState>;
  tournamentProjections: Record<string, TournamentProjection>;
} {
  if (!snap) return { roundStates: {}, tournamentProjections: {} };
  const result: Record<string, PlayerRoundState> = {};
  const tournamentProjections: Record<string, TournamentProjection> = {};
  const playerStateMap = new Map<string, string>();
  for (const lb of leaderboard) {
    playerStateMap.set(lb.playerId, lb.playerState);
  }
  const INACTIVE_STATES = new Set([
    "CUT",
    "MC",
    "WD",
    "DQ",
    "DNS",
  ]);
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
    // Tournament-total projection: mean of final 4-round strokes
    // (played + projected) and the variance of the remaining holes.
    // Powers the winning-score min-of-normals model.
    let tournamentMean = 0;
    let tournamentVariance = 0;
    let tournamentRoundsCovered = 0;
    // Fall back to round 1's pars for any later round the orchestrator
    // hasn't cached pars for yet (same course, par doesn't change).
    const fallbackPars = pars[1] ?? {};
    for (let r = 1; r <= 4; r++) {
      const ownPars = pars[r];
      const pl =
        ownPars && Object.keys(ownPars).length > 0 ? ownPars : fallbackPars;
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
      tournamentMean += strokes + expectedRemaining;
      tournamentVariance += variance;
      tournamentRoundsCovered++;
      if (anyPlayed && r > currentRound) currentRound = r;
    }

    // Only emit a tournament projection when we have data for all 4
    // rounds (the winning-score model is a 72-hole bet — anything
    // less is misleading).
    if (tournamentRoundsCovered === 4) {
      const status = playerStateMap.get(pid) ?? "ACTIVE";
      tournamentProjections[pid] = {
        mean: tournamentMean,
        variance: tournamentVariance,
        active: !INACTIVE_STATES.has(status),
      };
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
  return { roundStates: result, tournamentProjections };
}

interface TournamentProjection {
  mean: number;
  variance: number;
  active: boolean;
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

// ──────────────────────────────────────────────────────────────────
// Winning-score CDF snapshot helpers
// ──────────────────────────────────────────────────────────────────

const WS_SNAPSHOT_INTERVAL_MS = 55_000;
const WS_LINE_MIN = 250;
const WS_LINE_MAX = 300;

function _erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

function _normalCdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + _erf((x - mean) / (sd * Math.SQRT2)));
}

/**
 * Compute P(winner < line) at half-integer steps across the
 * plausible range of winning scores, using the min-of-normals
 * formula across active projections. Inline to keep this route's
 * import graph server-only.
 */
function computeWinningScoreCdf(
  projections: Record<string, TournamentProjection>,
): WinningScoreSnapshot["points"] {
  const active = Object.values(projections).filter((p) => p.active);
  if (active.length === 0) return [];
  const points: WinningScoreSnapshot["points"] = [];
  for (let line = WS_LINE_MIN; line <= WS_LINE_MAX; line += 0.5) {
    let logProdMissed = 0;
    let probUnder = -1;
    for (const p of active) {
      if (p.variance <= 0) {
        if (p.mean < line) {
          probUnder = 1;
          break;
        }
        continue;
      }
      const sd = Math.sqrt(p.variance);
      const playerUnder = _normalCdf(line, p.mean, sd);
      const playerAtLeast = 1 - playerUnder;
      if (playerAtLeast <= 1e-9) {
        probUnder = 1;
        break;
      }
      logProdMissed += Math.log(playerAtLeast);
    }
    if (probUnder < 0) {
      probUnder = 1 - Math.exp(logProdMissed);
    }
    points.push({ line, probUnder });
  }
  return points;
}

async function getOrComputeTopFinish(
  tournamentId: string,
  projections: Record<string, TournamentProjection>,
): Promise<TopFinishSnapshot["byPlayer"]> {
  const hot = await getHotTopFinish(tournamentId);
  if (hot) return hot.byPlayer;
  const active = Object.values(projections).filter((p) => p.active);
  if (active.length === 0) return {};
  const byPlayer = simulateTopFinish(projections);
  if (Object.keys(byPlayer).length === 0) return {};
  const snapshot: TopFinishSnapshot = { ts: Date.now(), byPlayer };
  try {
    await setHotTopFinish(tournamentId, snapshot);
  } catch (err) {
    console.error("[feed] setHotTopFinish failed", err);
  }
  // Append to the rolling history only when the previous snapshot is
  // old enough — same 1/min dedup as the winning-score CDF.
  try {
    const recent = await getTopFinishHistory(tournamentId);
    const lastTs = recent[0]?.ts ?? 0;
    if (Date.now() - lastTs >= HISTORY_MIN_GAP_MS) {
      await pushTopFinishSnapshot(tournamentId, snapshot);
    }
  } catch (err) {
    console.error("[feed] pushTopFinishSnapshot failed", err);
  }
  return byPlayer;
}

async function maybeAppendWinningScoreSnapshot(
  tournamentId: string,
  projections: Record<string, TournamentProjection>,
  existing: WinningScoreSnapshot[],
): Promise<WinningScoreSnapshot[]> {
  const lastTs = existing[0]?.ts ?? 0;
  if (Date.now() - lastTs < WS_SNAPSHOT_INTERVAL_MS) return existing;
  const points = computeWinningScoreCdf(projections);
  if (points.length === 0) return existing;
  const snapshot: WinningScoreSnapshot = { ts: Date.now(), points };
  try {
    await pushWinningScoreSnapshot(tournamentId, snapshot);
  } catch (err) {
    console.error("[feed] pushWinningScoreSnapshot failed", err);
  }
  return [snapshot, ...existing].slice(0, 720);
}
