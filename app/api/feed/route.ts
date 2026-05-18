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
  getCachedDgTopFinish,
  getHotTopFinish,
  getTopFinishHistory,
  HISTORY_MIN_GAP_MS,
  pushTopFinishSnapshot,
  setCachedDgTopFinish,
  setHotTopFinish,
  type DgTopFinishMap,
  type TopFinishSnapshot,
} from "@/lib/feed/top-finish-cache";
import { ensurePlayerSkill } from "@/lib/feed/skill-cache";
import { findOddsShift } from "@/lib/feed/odds-store";
import { getInPlayTopFinish } from "@/lib/golf-api/datagolf";
import { eventPolarity, type FeedRow } from "@/lib/feed/types";

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
  const url = new URL(req.url);
  const visitorId = url.searchParams.get("v") ?? "";
  // Past-tournament replay: serve a specific tournament's Redis-cached
  // data without running the resolver or polling fresh. Used by
  // BetDetail to render the same chart a user saw live, for bets from
  // tournaments that have since concluded. All the rolling buffers
  // (Polymarket odds, top-finish history, winning-score CDF history)
  // are LPUSH'd with no TTL — just capped at 720 samples per key —
  // so they remain queryable indefinitely after the event ends.
  const tournamentIdOverride = url.searchParams.get("tournamentId");
  // Bandwidth saver: by default we omit the heavy chart buffers
  // (per-player odds histories, DG win-prob histories, DK/FD book
  // histories, top-finish history, winning-score CDF history, field
  // stats). The home feed doesn't need them; only the bet detail
  // page does, and it opts in with ?include=charts. This drops the
  // /api/feed payload from ~150 KB to ~20 KB per poll.
  const includeChartData = url.searchParams.get("include") === "charts";

  let tournament: { id: string; name: string; startDate: number } | null;
  let isLive: boolean;

  if (tournamentIdOverride) {
    // Look up the tournament metadata in the schedule.
    const { upcoming, completed } = await import("@/lib/golf-api/pgatour").then(
      (m) => m.getSchedule(),
    );
    const t = [...upcoming, ...completed].find(
      (x) => x.id === tournamentIdOverride,
    );
    if (!t) {
      return NextResponse.json(
        { error: "tournament-not-found", id: tournamentIdOverride },
        { status: 404 },
      );
    }
    tournament = t;
    isLive = false; // past replay always serves as "settled"
  } else {
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
    tournament = active.tournament;
    isLive = active.isLive;
  }

  let watching = 0;
  let seenToday = 0;
  if (visitorId) {
    watching = await touchPresence(tournament.id, visitorId);
    seenToday = await markSeenToday(tournament.id, visitorId);
  }

  let polled = false;
  // Skip the live poll when serving a past-tournament replay — we'd
  // be writing fresh data into a concluded tournament's buffers.
  if (isLive && !tournamentIdOverride) {
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
    // Direction sanity. Decimal odds: shorter = lower number. A birdie
    // that's accompanied by the leader's hole-out can show a lengthening
    // shift on the buffer; that move belongs to the leader, not us.
    // If the shift contradicts the event's expected polarity, drop it
    // rather than mislead the user.
    const polarity = eventPolarity(event);
    if (polarity !== 0) {
      const shortened = shift.after < shift.before;
      if (polarity === 1 && !shortened) return event;
      if (polarity === -1 && shortened) return event;
    }
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

  // Live-round drift: how much harder/easier the field has scored in
  // the most recent ~30 events vs the rest of the round. Currently
  // surfaced for diagnostics only — the projection no longer applies
  // it because the "recent events" sample is biased toward the late
  // wave (= the leaders at majors), so a low recent mean reflects
  // skill, not conditions. With the DataGolf top-X blend handling
  // calibration, we don't need this naive bump.
  const fieldDrift = computeFieldDrift(allEvents);

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
      null,
    );

  // Maintain a rolling history of the winning-score CDF for the bet
  // detail chart. Append at most one snapshot per minute regardless
  // of how often /api/feed is hit. We still append even when the
  // caller didn't ask for chart data, so the chart endpoint sees a
  // dense history when it next loads.
  const winningScoreHistory = await maybeAppendWinningScoreSnapshot(
    tournament.id,
    tournamentProjections,
    bundle.winningScoreHistory,
  );

  // Top-finish probabilities (top-5 / top-10 / top-20) via 5K-sim MC
  // on the same per-player projections. Hot cache short-circuits when
  // a recent result is available; otherwise we run the MC inline.
  const ourTopFinish = await getOrComputeTopFinish(
    tournament.id,
    tournamentProjections,
  );
  // Calibration anchor: DataGolf publishes their own in-play top-5 /
  // top-10 probs. Our MC can disagree with them by ~5x for locked-in
  // finishers (the leaders' projected means are too optimistic), so
  // we blend toward DG. Top-20 isn't in their endpoint — that field
  // remains ours.
  const dgTopFinish = await getDgTopFinishMap(tournament.id, leaderboard);
  const topFinish = blendTopFinish(
    ourTopFinish,
    dgTopFinish?.byPlayer ?? {},
    DG_BLEND_WEIGHT,
  );
  // Skip the topFinishHistory Redis read when the caller isn't going
  // to use it (home page) — saves an LRANGE per poll across every
  // viewer.
  const topFinishHistory = includeChartData
    ? await getTopFinishHistory(tournament.id)
    : [];

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
    playerRoundStates,
    /** Per-player N(mean, variance) projection of final 4-round
     *  strokes. Powers the winning-score min-of-normals model. */
    tournamentProjections,
    /** Per-player model probabilities for top-5 / top-10 / top-20.
     *  Source: server-side 5K-sim Monte Carlo with fractional
     *  dead-heat counting. Same projections as the winning-score model. */
    topFinishCurrent: topFinish,
    /** Live-round field-mean drift bump (strokes/hole) applied to
     *  remaining-hole projections — measures how the most recent
     *  ~30 events scored vs the rest of the round. */
    fieldDrift,
    /** Tunable model params surfaced for the /api/debug/projection
     *  endpoint so calibration can be eyeballed without a redeploy. */
    modelParams: {
      perHoleNoiseVariance: 0.3,
      dgBlendWeight: DG_BLEND_WEIGHT,
      driftAppliedToProjections: false,
      dgTopFinishCovered: dgTopFinish
        ? Object.keys(dgTopFinish.byPlayer).length
        : 0,
    },
    watching,
    seenToday,
    polled,
    // Heavy chart buffers — opt-in via ?include=charts. Bet detail
    // page passes it; the home feed doesn't need them and skipping
    // them drops the response by an order of magnitude per poll.
    ...(includeChartData
      ? {
          oddsHistories: oddsBuffers,
          dgWinProbs: bundle.dgWinProbs,
          bookOdds: bundle.bookOdds,
          winningScoreHistory,
          topFinishHistory,
          fieldStats,
          playerSkill,
          tournamentPars: bundle.pars,
        }
      : {}),
  });
}

interface FieldDrift {
  /** Live round the drift was measured against. */
  round: number;
  /** Strokes-per-hole bump to add to projections in `round` (can be
   *  negative if the course is playing easier than earlier today). */
  drift: number;
}

/**
 * Compare how the field has scored in the most recent ~30 hole-events
 * vs the rest of the events for the same round, and return the delta
 * as a per-hole bump. Captures the "conditions got harder this
 * afternoon" / "wind died down" drift that the static per-hole
 * fieldStats mean misses.
 *
 * Caller applies the bump only to remaining holes whose round matches
 * `result.round` — drift doesn't sensibly extrapolate to other rounds.
 *
 * Returns null when the sample is too thin to be useful (early in a
 * round, or post-cut when score events have dried up).
 */
function computeFieldDrift(
  events: FeedRow["event"][] | Array<{
    type: string;
    round?: number;
    par?: number;
    strokes?: number;
    ts: number;
  }>,
): FieldDrift | null {
  const scored = (events as Array<{
    type: string;
    round?: number;
    par?: number;
    strokes?: number;
    ts: number;
  }>).filter(
    (e) =>
      e.type === "score" &&
      typeof e.par === "number" &&
      typeof e.strokes === "number" &&
      e.par >= 3 &&
      e.par <= 5 &&
      typeof e.round === "number",
  );
  if (scored.length < 60) return null;
  // events come from Redis newest-first; defensively re-sort by ts.
  scored.sort((a, b) => b.ts - a.ts);
  const liveRound = scored[0].round as number;
  const sameRound = scored.filter((e) => e.round === liveRound);
  if (sameRound.length < 60) return null;
  const RECENT_N = 30;
  const recent = sameRound.slice(0, RECENT_N);
  const rest = sameRound.slice(RECENT_N);
  if (rest.length < 30) return null;
  const meanDev = (arr: typeof sameRound) =>
    arr.reduce((s, e) => s + ((e.strokes as number) - (e.par as number)), 0) /
    arr.length;
  const raw = meanDev(recent) - meanDev(rest);
  // Sanity-cap so a few outliers can't blow up the projection.
  const CAP = 0.25;
  const drift = Math.max(-CAP, Math.min(CAP, raw));
  return { round: liveRound, drift };
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
  fieldDrift: FieldDrift | null,
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
  // Per-player per-hole noise variance used in the projection sum.
  // 0.30 ≈ 5.4 over 18 holes (per-round SD ≈ 2.3) which is in line
  // with published per-pro round-score dispersion. Decoupled from
  // field-wide variance (which double-counts skill spread); tune
  // here and watch the debug endpoint's currentModel.top10 to
  // calibrate against DataGolf without redeploying the model code.
  const PER_HOLE_NOISE_VARIANCE = 0.3;

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
          // Apply the live-round drift bump only to remaining holes
          // in the round it was measured from — extrapolating today's
          // conditions to tomorrow's tee time isn't justified.
          const driftBump =
            fieldDrift && fieldDrift.round === r ? fieldDrift.drift : 0;
          expectedRemaining += par + stat.mean + driftBump - skillPerHole;
          // Use a constant per-hole player-noise variance instead of
          // the field-wide variance. The field number mixes
          // between-player skill spread with per-shot luck; we've
          // already corrected for skill in the mean, so summing field
          // variance double-counts it and inflates the simulator's
          // tail width. The constant below is sized to a per-round
          // SD ≈ 2.3 strokes (per-tournament SD ≈ 4.6), which lines
          // up with the published per-pro round-score dispersion.
          variance += PER_HOLE_NOISE_VARIANCE;
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

// How heavily to weight DataGolf's published top-X probs vs our own
// MC. 0 = pure ours, 1 = pure DG. Set high enough to dominate but
// not so high that DG outages collapse the bet tracker — when DG
// is missing for a player we silently fall back to our number.
const DG_BLEND_WEIGHT = 0.7;

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Fetch DataGolf's published in-play top-5 / top-10 probabilities
 * and key them to PGA Tour playerIds via name matching against the
 * current leaderboard. Cached for 5 minutes (DG refreshes their
 * /preds/in-play every few minutes).
 *
 * Returns null on any failure — caller falls back to pure MC.
 */
async function getDgTopFinishMap(
  tournamentId: string,
  leaderboard: import("@/lib/feed/store").CachedLeaderboardRow[],
): Promise<DgTopFinishMap | null> {
  try {
    const cached = await getCachedDgTopFinish(tournamentId);
    if (cached) return cached;
  } catch (err) {
    console.error("[feed] DG top-finish cache read failed", err);
  }
  let dgRows;
  try {
    dgRows = await getInPlayTopFinish();
  } catch (err) {
    console.error("[feed] DG top-finish fetch failed", err);
    return null;
  }
  const byNorm = new Map<string, { top5: number; top10: number }>();
  for (const r of dgRows) {
    byNorm.set(normaliseName(r.name), { top5: r.top5, top10: r.top10 });
  }
  const byPlayer: DgTopFinishMap["byPlayer"] = {};
  for (const row of leaderboard) {
    const match = byNorm.get(normaliseName(row.displayName));
    if (match) byPlayer[row.playerId] = match;
  }
  const map: DgTopFinishMap = { ts: Date.now(), byPlayer };
  try {
    await setCachedDgTopFinish(tournamentId, map);
  } catch (err) {
    console.error("[feed] DG top-finish cache write failed", err);
  }
  return map;
}

function blendTopFinish(
  ours: TopFinishSnapshot["byPlayer"],
  dg: DgTopFinishMap["byPlayer"],
  dgWeight: number,
): TopFinishSnapshot["byPlayer"] {
  const a = Math.max(0, Math.min(1, dgWeight));
  const out: TopFinishSnapshot["byPlayer"] = {};
  for (const [pid, oursP] of Object.entries(ours)) {
    const dgP = dg[pid];
    if (dgP) {
      out[pid] = {
        top5: a * dgP.top5 + (1 - a) * oursP.top5,
        top10: a * dgP.top10 + (1 - a) * oursP.top10,
        // DG's /preds/in-play doesn't expose top_20 — keep our MC value.
        top20: oursP.top20,
      };
    } else {
      out[pid] = oursP;
    }
  }
  return out;
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
