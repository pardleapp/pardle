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
import { getLiveStatsCached } from "@/lib/feed/live-stats-cache";
import { computeCommunityBacking } from "@/lib/feed/community-backing";
import { eventPolarity, type FeedRow } from "@/lib/feed/types";
import {
  getMyVotesBulk,
  getPuttPollBulk,
  type PuttPoll,
  type PuttPollCounts,
} from "@/lib/feed/putt-polls";
import {
  crowdConsensusWasWrong,
  getUserStats,
  type PuttIqStats,
} from "@/lib/feed/putt-iq";
import { getRecentFormBulk, type RecentForm } from "@/lib/feed/recent-form";

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

  // Putt-poll IDs from any putt-poll event in the response — used to
  // attach current counts + the caller's own vote in one bulk read.
  const pollIds: string[] = [];
  for (const e of feedMerged) {
    if (e.type === "putt-poll" && e.pollId) pollIds.push(e.pollId);
  }

  const [
    reactions,
    commentCounts,
    topFinishHistoryFull,
    communityBacking,
    puttPollBulk,
    puttPollMyVotes,
    myPuttIq,
  ] = await Promise.all([
    getReactionsBulk(ids),
    getCommentCountsBulk(ids),
    // Read here (early) so the top-10 shift attachment has the recent
    // snapshot list ready by the time toRow runs. Full list is also
    // what we'll conditionally include in the response further down.
    getTopFinishHistory(tournament.id),
    // "X% of Pardle bettors back him this week" — aggregated from
    // the bets table for this tournament window. Returns {} when
    // the population's too small to be meaningful.
    computeCommunityBacking(tournament.startDate),
    // Putt poll state for the rows in this response — counts + close
    // status + outcome. Skipped when there are no putt-poll events.
    pollIds.length > 0
      ? getPuttPollBulk(pollIds)
      : Promise.resolve(
          {} as Record<string, { poll: PuttPoll; counts: PuttPollCounts }>,
        ),
    // The caller's own vote on each poll (null if they haven't voted).
    pollIds.length > 0 && visitorId
      ? getMyVotesBulk(pollIds, visitorId)
      : Promise.resolve({} as Record<string, "yes" | "no" | null>),
    // Caller's putt-prediction accuracy + streak + tournament rank.
    visitorId
      ? getUserStats(visitorId, tournament.id)
      : Promise.resolve(null as PuttIqStats | null),
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

  // Top-10 prob shift attachment. Same architectural pattern as the
  // odds shift — look at the topFinishHistory snapshots either side
  // of the event's ts, pick a meaningful absolute swing (≥5pp), and
  // discard if the direction contradicts the event's polarity.
  const TOP10_MIN_PP = 0.05;
  const TOP10_BEFORE_MS = 180_000;
  const TOP10_AFTER_MS = 180_000;
  // Most recent ~20 snapshots is enough to compute shifts around
  // any score event in this response (events are at most a few
  // minutes old by the time attachment runs).
  const topFinishRecent = topFinishHistoryFull.slice(0, 20);
  const attachTop10Shift = (event: FeedRow["event"]): FeedRow["event"] => {
    if (event.type !== "score") return event;
    if (topFinishRecent.length < 2) return event;
    // Snapshots arrive newest-first from getTopFinishHistory.
    const before = topFinishRecent.find(
      (s) =>
        s.ts <= event.ts - 30_000 &&
        event.ts - s.ts <= TOP10_BEFORE_MS,
    );
    const after = [...topFinishRecent]
      .reverse()
      .find(
        (s) =>
          s.ts >= event.ts && s.ts - event.ts <= TOP10_AFTER_MS,
      );
    if (!before || !after || before.ts === after.ts) return event;
    const b = before.byPlayer[event.playerId]?.top10;
    const a = after.byPlayer[event.playerId]?.top10;
    if (typeof b !== "number" || typeof a !== "number") return event;
    if (Math.abs(a - b) < TOP10_MIN_PP) return event;
    const polarity = eventPolarity(event);
    if (polarity !== 0) {
      const climbed = a > b;
      if (polarity === 1 && !climbed) return event;
      if (polarity === -1 && climbed) return event;
    }
    return { ...event, top10Before: b, top10After: a };
  };

  const toRow = (event: FeedRow["event"]): FeedRow => ({
    event: attachTop10Shift(attachOdds(event)),
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
  // topFinishHistoryFull was read early (alongside reactions) so the
  // top-10 shift attachment had it ready. Only ship it down the wire
  // when the caller asked for chart data.
  const topFinishHistory = includeChartData ? topFinishHistoryFull : [];

  // Per-player tournament-to-date SG breakdown (per-round averages
  // vs the field). Powers the "where it's leaking" hint on the bet-
  // detail insight card AND the per-poll putting-SG anchor that
  // sits under the putt-prediction widget question. Lookup is cached
  // server-side for 5 min; the full map only ships down the wire on
  // ?include=charts, but we always need it server-side to enrich
  // any open polls with the bet player's putting SG. Map keyed by
  // orchestrator playerId via name match against the leaderboard.
  const playerSgBreakdown = await buildSgBreakdownMap(
    tournament.id,
    leaderboard,
  );

  // Hot/cold-hand badges. Pulls current-round SG (not week-to-date)
  // so "hot" reflects what's happening right now, not what happened
  // Thursday. Reads from the same 5-min DG cache as everything else;
  // never blocks shot emission. Top 5 with sgTotal ≥ +1.5 → 🔥;
  // bottom 5 with sgTotal ≤ −1.5 → 🥶. Magnitude floors avoid
  // labelling marginal players in a flat scoring round.
  // "Today's round" = max currentRound seen across active players in
  // playerRoundStates. Robust to weather delays / two-tee starts (a
  // back-9 starter sitting on the same round as a front-9 starter).
  let currentRound = 1;
  for (const state of Object.values(playerRoundStates)) {
    if (state.currentRound > currentRound) currentRound = state.currentRound;
  }
  const handStatus = await buildHandStatusMap(
    tournament.id,
    currentRound,
    leaderboard,
  );

  // "Hottest in field this week" strip. Reads from the same cached
  // event_avg SG breakdown we already pull for the bet-insight card
  // — no new DataGolf call. Top 3 / bottom 3 by sg_total with a
  // ±0.5 SG/round magnitude floor so a flat field doesn't surface
  // a noisy "hottest".
  const fieldMomentum = deriveFieldMomentum(playerSgBreakdown, leaderboard);

  // Recent-form sparkline data — last 8 starts per leaderboard player.
  // Pure JSON lookup from a pre-baked file (server-only); no API
  // calls, no per-shot latency. Top 30 of the leaderboard covers
  // everyone shown on the leaderboard panel + practically every
  // tracked bet (bets are placed on prominent players).
  const recentForm = getRecentFormBulk(
    leaderboard.slice(0, 30).map((r) => ({
      playerId: r.playerId,
      displayName: r.displayName,
    })),
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
    /** Community-backing percentages keyed by playerId. Sparse —
     *  only players who pass the 2-backer / 5% floor are included.
     *  Tiny payload (a few dozen integers at most) so always
     *  included regardless of slim/full. */
    communityBackingPct: communityBacking.byPlayer,
    communityTotalBettors: communityBacking.totalBettors,
    /** Putt prediction polls keyed by pollId. Counts + close status +
     *  the caller's own vote. Sparse — only includes polls referenced
     *  by events in this response. */
    puttPolls: composePuttPollPayload(
      puttPollBulk,
      puttPollMyVotes,
      playerSgBreakdown,
    ),
    /** Caller's putt-prediction stats — total / correct / streak +
     *  tournament rank. Drives the header chip + recap toasts. Null
     *  when no visitorId is supplied. */
    myPuttIq,
    /** Hot/cold-hand status keyed by playerId. Sparse — only contains
     *  the top 5 by sg_total today (🔥) and bottom 5 (🥶), magnitude
     *  floors applied. Renders as a small emoji prefix next to player
     *  names anywhere they appear. */
    handStatus,
    /** Top 3 / bottom 3 by week-to-date sg_total. Powers the
     *  "🔥 hottest this week / 🥶 coldest" strip near the top of /live. */
    fieldMomentum,
    /** Recent-form sparkline data keyed by playerId. Last 8 PGA Tour
     *  starts: finish text + numeric position + made-cut flag. Sparse
     *  — only top-30 leaderboard players are mapped. Powers the
     *  sparkline next to player names on leaderboard rows + bet
     *  tracker cards. */
    recentForm,
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
          playerSgBreakdown,
        }
      : {}),
  });
}

/** Compact wire shape for one putt poll the client renders. */
interface PuttPollWire {
  counts: PuttPollCounts;
  closedAt: number | null;
  made: boolean | null;
  myVote: "yes" | "no" | null;
  /** Stroke count when the poll opened — lets the client tell a viewer
   *  arriving late whether the poll's still actionable. */
  polledAtStroke: number;
  /** True when the closed poll's community consensus opposed the
   *  outcome (≥60% vote one way, opposite result, ≥6 voters). Powers
   *  the "🤡 crowd called it wrong" chip on closed rows. */
  crowdWasWrong: boolean;
  /** Bet player's week-to-date putting SG per round (positive = better
   *  than field on the greens). Null when DataGolf hasn't reported
   *  yet — widget hides the anchor line in that case. */
  playerPuttSg: number | null;
}

function composePuttPollPayload(
  bulk: Record<string, { poll: PuttPoll; counts: PuttPollCounts }>,
  myVotes: Record<string, "yes" | "no" | null>,
  sgBreakdown: Record<
    string,
    {
      total: number | null;
      ott: number | null;
      app: number | null;
      arg: number | null;
      putt: number | null;
    }
  > | null,
): Record<string, PuttPollWire> {
  const out: Record<string, PuttPollWire> = {};
  for (const [id, { poll, counts }] of Object.entries(bulk)) {
    const crowdWasWrong =
      poll.closedAt != null && poll.made != null
        ? crowdConsensusWasWrong({
            yes: counts.yes,
            no: counts.no,
            made: poll.made,
          })
        : false;
    const playerPuttSg = sgBreakdown?.[poll.playerId]?.putt ?? null;
    out[id] = {
      counts,
      closedAt: poll.closedAt ?? null,
      made: poll.made ?? null,
      myVote: myVotes[id] ?? null,
      polledAtStroke: poll.polledAtStroke,
      crowdWasWrong,
      playerPuttSg,
    };
  }
  return out;
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

/**
 * Build a per-player SG breakdown map keyed by orchestrator playerId.
 *
 * Source: DataGolf's live-tournament-stats endpoint with round=event_avg
 * (per-round averages aggregated across played rounds). DataGolf names
 * are matched to orchestrator IDs via the leaderboard.
 *
 * Returns null if DataGolf is unavailable so the insight card degrades
 * to its no-SG hint rather than blocking the route.
 */
async function buildSgBreakdownMap(
  tournamentId: string,
  leaderboard: import("@/lib/feed/store").CachedLeaderboardRow[],
): Promise<Record<
  string,
  {
    total: number | null;
    ott: number | null;
    app: number | null;
    arg: number | null;
    putt: number | null;
  }
> | null> {
  let stats;
  try {
    stats = await getLiveStatsCached(tournamentId, "event_avg");
  } catch (err) {
    console.error("[feed] live-stats fetch failed", err);
    return null;
  }
  if (stats.length === 0) return null;
  const byNorm = new Map<string, (typeof stats)[number]>();
  for (const s of stats) byNorm.set(normaliseName(s.name), s);
  const out: Record<
    string,
    {
      total: number | null;
      ott: number | null;
      app: number | null;
      arg: number | null;
      putt: number | null;
    }
  > = {};
  for (const row of leaderboard) {
    const s = byNorm.get(normaliseName(row.displayName));
    if (!s) continue;
    // Only include the row if at least one SG component is present —
    // otherwise it's noise for the bet detail card.
    if (
      s.sgTotal == null &&
      s.sgOtt == null &&
      s.sgApp == null &&
      s.sgArg == null &&
      s.sgPutt == null
    ) {
      continue;
    }
    out[row.playerId] = {
      total: s.sgTotal,
      ott: s.sgOtt,
      app: s.sgApp,
      arg: s.sgArg,
      putt: s.sgPutt,
    };
  }
  return out;
}

/**
 * Build a `playerId → "hot" | "cold"` map for today's current round.
 *
 * Pulls cached DataGolf live-stats for the current round (5-min TTL).
 * Marks the top 5 by sg_total with a magnitude floor at +1.5 as 🔥;
 * bottom 5 with floor at −1.5 as 🥶. Magnitude floors stop us
 * labelling marginal players in a flat scoring round.
 *
 * Returns {} if DataGolf is unreachable — never blocks shot emission.
 */
async function buildHandStatusMap(
  tournamentId: string,
  currentRound: number,
  leaderboard: import("@/lib/feed/store").CachedLeaderboardRow[],
): Promise<Record<string, "hot" | "cold">> {
  if (!Number.isFinite(currentRound) || currentRound < 1) return {};
  let stats;
  try {
    stats = await getLiveStatsCached(tournamentId, currentRound);
  } catch (err) {
    console.error("[feed] hand-status DG fetch failed", err);
    return {};
  }
  if (stats.length === 0) return {};
  // Match DG rows back to orchestrator playerIds via name.
  const byNorm = new Map<string, (typeof stats)[number]>();
  for (const s of stats) byNorm.set(normaliseName(s.name), s);
  const rows: Array<{ playerId: string; sgTotal: number }> = [];
  for (const r of leaderboard) {
    const s = byNorm.get(normaliseName(r.displayName));
    if (!s || s.sgTotal == null || !Number.isFinite(s.sgTotal)) continue;
    rows.push({ playerId: r.playerId, sgTotal: s.sgTotal });
  }
  if (rows.length < 10) return {}; // too few players reporting — noisy
  rows.sort((a, b) => b.sgTotal - a.sgTotal);
  const out: Record<string, "hot" | "cold"> = {};
  const HOT_FLOOR = 1.5;
  const COLD_FLOOR = -1.5;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (rows[i].sgTotal >= HOT_FLOOR) out[rows[i].playerId] = "hot";
  }
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[rows.length - 1 - i];
    if (r.sgTotal <= COLD_FLOOR) out[r.playerId] = "cold";
  }
  return out;
}

interface MomentumRow {
  playerId: string;
  displayName: string;
  sgTotal: number;
}

/**
 * Derive the top 3 / bottom 3 SG_total players for the
 * "🔥 hottest in field" / "🥶 coldest" strip on /live. Reads from
 * the SG map we already build for the bet-insight card — no extra
 * DataGolf call. Magnitude floor (±0.5 SG/round) so a flat field
 * doesn't surface a noisy "hottest".
 */
function deriveFieldMomentum(
  sgBreakdown: Record<
    string,
    {
      total: number | null;
      ott: number | null;
      app: number | null;
      arg: number | null;
      putt: number | null;
    }
  > | null,
  leaderboard: import("@/lib/feed/store").CachedLeaderboardRow[],
): { hot: MomentumRow[]; cold: MomentumRow[] } {
  const empty = { hot: [], cold: [] };
  if (!sgBreakdown) return empty;
  const nameByPid = new Map(
    leaderboard.map((r) => [r.playerId, r.displayName]),
  );
  const rows: MomentumRow[] = [];
  for (const [pid, sg] of Object.entries(sgBreakdown)) {
    if (sg.total == null || !Number.isFinite(sg.total)) continue;
    const displayName = nameByPid.get(pid);
    if (!displayName) continue;
    rows.push({ playerId: pid, displayName, sgTotal: sg.total });
  }
  if (rows.length < 10) return empty;
  rows.sort((a, b) => b.sgTotal - a.sgTotal);
  const HOT_FLOOR = 0.5;
  const COLD_FLOOR = -0.5;
  const hot = rows.slice(0, 5).filter((r) => r.sgTotal >= HOT_FLOOR).slice(0, 3);
  const cold = rows
    .slice(-5)
    .filter((r) => r.sgTotal <= COLD_FLOOR)
    .slice(-3)
    .reverse(); // present worst-first
  return { hot, cold };
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
