/**
 * Shared bet-tracker types and helpers. Used by:
 *   - <BetTracker> on /live (panel of bets + summary)
 *   - <BetDetail> on /live/bet/[id] (dedicated chart page)
 *
 * Pure client-only — bets live in localStorage, no auth, no DB. The
 * history charts are rebuilt at render time from server-tracked data
 * (the odds buffer + score events) so they cover periods the user
 * wasn't on the page.
 */

// ── Bet shapes ──────────────────────────────────────────────────────

export interface PnlSample {
  t: number; // epoch ms
  v: number; // bet's current value in £
  /** For round-score bets — holes played since the bet was placed. */
  holesPlayed?: number;
  /** Model's win probability at this sample (0–1). Round-score only;
   *  outright uses live market prob so this is derivable from v. */
  prob?: number;
}

export interface OutrightBet {
  id: string;
  kind: "outright";
  playerId: string;
  playerName: string;
  oddsTaken: number;
  oddsTakenLabel: string;
  stake: number;
  placedAt: number;
}

export interface RoundScorePlacement {
  /** Round state at the moment the bet was placed. */
  holesPlayed: number;
  strokes: number;
  parPlayed: number;
  roundPar: number;
  ttdPacePerHole: number;
  /** The model's win probability at placement. The chart anchors the
   *  PnL £ baseline to v_at_placement = stake (using this), and plots
   *  the Win % directly from the model's prob over time. */
  probAtPlacement: number;
}

export interface RoundScoreBet {
  id: string;
  kind: "round-score";
  playerId: string;
  playerName: string;
  /** The round the bet applies to. `null` = current / next round. */
  round: number | null;
  /** Score line — e.g. 69.5. */
  line: number;
  side: "under" | "over";
  oddsTaken: number;
  oddsTakenLabel: string;
  stake: number;
  placedAt: number;
  placement?: RoundScorePlacement;
}

export interface WinningScoreBet {
  id: string;
  kind: "winning-score";
  /** Total-strokes line for the eventual winner (e.g. 268.5). */
  line: number;
  side: "under" | "over";
  oddsTaken: number;
  oddsTakenLabel: string;
  stake: number;
  placedAt: number;
}

export interface TopFinishBet {
  id: string;
  kind: "top-finish";
  playerId: string;
  playerName: string;
  /** Which top-N market: 5, 10 or 20. */
  cutoff: 5 | 10 | 20;
  oddsTaken: number;
  oddsTakenLabel: string;
  stake: number;
  placedAt: number;
}

export type TrackedBet =
  | OutrightBet
  | RoundScoreBet
  | WinningScoreBet
  | TopFinishBet;

export interface TournamentProjection {
  /** Model-expected final 4-round total strokes. */
  mean: number;
  /** Variance of the projection (sum of per-hole variance for
   *  remaining holes across all 4 rounds). */
  variance: number;
  /** False if the player is cut, withdrawn, DQ'd, missed-cut, etc. */
  active: boolean;
}

// ── Round state types (mirror /api/feed response shape) ────────────

export interface RoundSnapshot {
  holesPlayed: number;
  holesRemaining: number;
  strokes: number;
  parPlayed: number;
  parRemaining: number;
  roundPar: number;
  toPar: number;
  status: "not-started" | "in-progress" | "complete";
  /** Round-score model projection of remaining strokes (field-anchored,
   *  skill-adjusted). Server-baked. Older payloads omit it. */
  expectedRemaining?: number;
  /** Variance of the projection (sum of per-hole variance for remaining). */
  variance?: number;
}

export interface PlayerRoundState {
  currentRound: number;
  holesPlayed: number;
  holesRemaining: number;
  strokes: number;
  parPlayed: number;
  parRemaining: number;
  roundPar: number;
  toPar: number;
  ttdPacePerHole: number;
  ttdHoles: number;
  rounds: Record<number, RoundSnapshot>;
}

export interface OddsHistorySample {
  ts: number;
  p: number; // decimal odds
}

export interface DgProbHistorySample {
  ts: number;
  prob: number; // 0..1
}

export interface FeedRowLike {
  event: {
    id: string;
    type: string;
    playerId: string;
    round: number;
    hole?: number;
    par?: number;
    strokes?: number;
    ts: number;
  };
}

export interface FieldHoleStat {
  mean: number;
  variance: number;
}

export interface WinningScoreCdfPoint {
  line: number;
  probUnder: number;
}

export interface WinningScoreSnapshot {
  ts: number;
  points: WinningScoreCdfPoint[];
}

/**
 * Look up P(winner < line) for a specific line in a CDF snapshot.
 * Linearly interpolates between the two surrounding stored points
 * when the requested line isn't on a half-integer grid step.
 */
export function probUnderAtLine(
  snapshot: WinningScoreSnapshot,
  line: number,
): number | null {
  const pts = snapshot.points;
  if (pts.length === 0) return null;
  if (line <= pts[0].line) return pts[0].probUnder;
  if (line >= pts[pts.length - 1].line) {
    return pts[pts.length - 1].probUnder;
  }
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].line >= line) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (line - a.line) / (b.line - a.line);
      return a.probUnder + (b.probUnder - a.probUnder) * t;
    }
  }
  return null;
}

export interface BetScorecard {
  /** Played holes in completion order. */
  holes: { holeNumber: number; par: number; strokes: number }[];
  /** Currently-unplayed holes in this round. */
  remaining: { holeNumber: number; par: number }[];
  roundPar: number;
  /** Field's (mean, variance) of (strokes − par) for each hole this
   *  round — already walked through the prior-round fallback ladder
   *  server-side, so the client just reads. */
  holeStats: Record<number, FieldHoleStat>;
  /** This player's DataGolf SG_total ÷ 18 — i.e. strokes better than
   *  field, per hole. Positive = better. */
  skillPerHole: number;
}

// ── localStorage ────────────────────────────────────────────────────

const STORAGE_KEY = "pardle_bets_v2";
const LEGACY_KEY = "pardle_bets_v1";

export function readBets(): TrackedBet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Partial<TrackedBet>>).map((b) => {
      if (!b.kind) return { ...(b as OutrightBet), kind: "outright" };
      return b as TrackedBet;
    });
  } catch {
    return [];
  }
}

export function writeBets(bets: TrackedBet[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
  window.localStorage.removeItem(LEGACY_KEY);
}

export function readBetById(id: string): TrackedBet | null {
  return readBets().find((b) => b.id === id) ?? null;
}

// ── Valuation ───────────────────────────────────────────────────────

const PER_HOLE_VAR = 0.65;

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(1, p));
}

/** Prob given a finished projection (mean of final score, variance). */
function probFromProjection(
  side: "under" | "over",
  line: number,
  currentStrokes: number,
  expectedRemaining: number,
  variance: number,
): number {
  const expectedFinal = currentStrokes + expectedRemaining;
  if (variance <= 0) {
    const won = side === "under" ? expectedFinal < line : expectedFinal > line;
    return won ? 1 : 0;
  }
  const sd = Math.sqrt(variance);
  const cdf = normalCdf(line, expectedFinal, sd);
  return clamp01(side === "under" ? cdf : 1 - cdf);
}

/** Project remaining strokes from a set of remaining (hole, par)
 *  entries + per-hole field stats + the player's skill. Returns
 *  (expectedRemaining, variance) which are the inputs to
 *  probFromProjection. */
function projectRemaining(
  remaining: { holeNumber: number; par: number }[],
  holeStats: Record<number, FieldHoleStat>,
  skillPerHole: number,
): { expectedRemaining: number; variance: number } {
  let expectedRemaining = 0;
  let variance = 0;
  for (const h of remaining) {
    const stat = holeStats[h.holeNumber] ?? { mean: 0, variance: PER_HOLE_VAR };
    expectedRemaining += h.par + stat.mean - skillPerHole;
    variance += stat.variance;
  }
  return { expectedRemaining, variance };
}

/** Model-fair value of the bet given the latest model prob. The
 *  reference price is the market price the user paid (oddsTaken),
 *  *not* the model's view at placement — that way a bet placed at
 *  +EV (e.g. evens on a 66 %-model favourite) shows the edge as PnL
 *  from day one, instead of being normalised away by anchoring to
 *  the model's own opinion at placement.
 *
 *  The second arg is retained for call-site back-compat and ignored. */
export function anchoredValue(
  prob: number,
  _probAtPlacement: number,
  stake: number,
  oddsTaken: number,
): number {
  if (prob >= 1) return stake * oddsTaken;
  if (prob <= 0) return 0;
  return stake * prob * oddsTaken;
}

/** Read the server-baked projection out of a RoundSnapshot, falling
 *  back to a par-anchored estimate if the snapshot pre-dates the
 *  expectedRemaining/variance fields. */
function projectionFromSnap(
  r: RoundSnapshot,
): { expectedRemaining: number; variance: number } {
  if (
    typeof r.expectedRemaining === "number" &&
    typeof r.variance === "number"
  ) {
    return { expectedRemaining: r.expectedRemaining, variance: r.variance };
  }
  return {
    expectedRemaining: r.parRemaining,
    variance: r.holesRemaining * PER_HOLE_VAR,
  };
}

/** Best-effort backfill of `placement` for round-score bets stored
 *  before the field existed. Assumes pre-round placement and uses
 *  the current player state's projection (already baked with field
 *  + skill server-side) to anchor `probAtPlacement`. */
export function patchLegacyPlacement(
  b: RoundScoreBet,
  state: PlayerRoundState | undefined,
): RoundScoreBet {
  if (b.placement || !state) return b;
  const round = b.round ?? state.currentRound ?? null;
  if (round == null) return b;
  const r = state.rounds?.[round];
  if (!r) return b;
  // For a bet assumed placed pre-round, the "expected remaining" is
  // the same projection the snap gives us when no holes are played
  // yet — which is what we'd want to anchor against.
  const { expectedRemaining, variance } = projectionFromSnap(r);
  // If the round is mid-way, scale the projection back to pre-round
  // by adding the holes that were played + their actual deviation.
  // Cleaner: just use the snap's projection plus current strokes (=
  // "where the model thinks it'd finish from here"), and use that
  // as the placement anchor. Captures the bet's setup state well
  // enough for the chart to be sensible.
  const prob = probFromProjection(
    b.side,
    b.line,
    r.strokes,
    expectedRemaining,
    variance,
  );
  return {
    ...b,
    placement: {
      holesPlayed: r.holesPlayed,
      strokes: r.strokes,
      parPlayed: r.parPlayed,
      roundPar: r.roundPar,
      ttdPacePerHole: state.ttdPacePerHole ?? 0,
      probAtPlacement: prob > 0 ? prob : 1 / b.oddsTaken,
    },
  };
}

/** Build the placement snapshot stored on a new round-score bet. */
export function snapshotForPlacement(
  bet: Pick<RoundScoreBet, "round" | "line" | "side" | "oddsTaken">,
  state: PlayerRoundState | undefined,
): RoundScorePlacement | undefined {
  if (!state) return undefined;
  const round = bet.round ?? state.currentRound ?? null;
  if (round == null) return undefined;
  const r = state.rounds?.[round];
  if (!r) return undefined;
  let prob: number;
  if (r.status === "complete") {
    prob =
      bet.side === "under"
        ? r.strokes < bet.line
          ? 1
          : 0
        : r.strokes > bet.line
        ? 1
        : 0;
  } else {
    const { expectedRemaining, variance } = projectionFromSnap(r);
    prob = probFromProjection(
      bet.side,
      bet.line,
      r.strokes,
      expectedRemaining,
      variance,
    );
  }
  return {
    holesPlayed: r.holesPlayed,
    strokes: r.strokes,
    parPlayed: r.parPlayed,
    roundPar: r.roundPar,
    ttdPacePerHole: state.ttdPacePerHole ?? 0,
    probAtPlacement: prob > 0 ? prob : 1 / bet.oddsTaken,
  };
}

export type RoundScoreEval =
  | { kind: "not-started"; round: number }
  | {
      kind: "in-progress";
      round: number;
      prob: number;
      roundState: RoundSnapshot;
    }
  | { kind: "settled"; round: number; won: boolean; finalStrokes: number };

export function resolveBetRound(
  bet: RoundScoreBet,
  state: PlayerRoundState | undefined,
): number | null {
  if (bet.round != null) return bet.round;
  return state?.currentRound ?? null;
}

export function evaluateRoundScore(
  bet: RoundScoreBet,
  state: PlayerRoundState | undefined,
): RoundScoreEval | null {
  if (!state) return null;
  const round = resolveBetRound(bet, state);
  if (round == null) return null;
  const r = state.rounds?.[round];
  if (!r) return { kind: "not-started", round };

  if (r.status === "not-started") {
    return { kind: "not-started", round };
  }
  if (r.status === "complete") {
    const won =
      bet.side === "under" ? r.strokes < bet.line : r.strokes > bet.line;
    return { kind: "settled", round, won, finalStrokes: r.strokes };
  }
  const { expectedRemaining, variance } = projectionFromSnap(r);
  const prob = probFromProjection(
    bet.side,
    bet.line,
    r.strokes,
    expectedRemaining,
    variance,
  );
  return { kind: "in-progress", round, prob, roundState: r };
}

function probAtPlacementFor(b: RoundScoreBet): number {
  return b.placement?.probAtPlacement ?? 1 / b.oddsTaken;
}

export interface TopFinishProbs {
  top5: number;
  top10: number;
  top20: number;
}

export interface TopFinishSnapshot {
  ts: number;
  byPlayer: Record<string, TopFinishProbs>;
}

function probForCutoff(
  cutoff: 5 | 10 | 20,
  probs: TopFinishProbs | undefined,
): number | null {
  if (!probs) return null;
  const v =
    cutoff === 5 ? probs.top5 : cutoff === 10 ? probs.top10 : probs.top20;
  return Number.isFinite(v) ? v : null;
}

export function currentValueForBet(
  b: TrackedBet,
  currentOdds: Record<string, number>,
  playerRoundStates: Record<string, PlayerRoundState>,
  tournamentProjections?: Record<string, TournamentProjection>,
  topFinishCurrent?: Record<string, TopFinishProbs>,
): number | null {
  if (b.kind === "outright") {
    const fair = currentOdds[b.playerId];
    if (!Number.isFinite(fair) || fair <= 1) return null;
    return b.stake * (b.oddsTaken / fair);
  }
  if (b.kind === "top-finish") {
    const prob = probForCutoff(b.cutoff, topFinishCurrent?.[b.playerId]);
    if (prob == null) return null;
    if (prob >= 1) return b.stake * b.oddsTaken;
    if (prob <= 0) return 0;
    return b.stake * prob * b.oddsTaken;
  }
  if (b.kind === "winning-score") {
    if (!tournamentProjections) return null;
    const ev = evaluateWinningScore(b, tournamentProjections);
    if (!ev) return null;
    if (ev.prob >= 1) return b.stake * b.oddsTaken;
    if (ev.prob <= 0) return 0;
    return b.stake * ev.prob * b.oddsTaken;
  }
  const ev = evaluateRoundScore(b, playerRoundStates[b.playerId]);
  if (!ev) return null;
  if (ev.kind === "not-started") return b.stake;
  if (ev.kind === "settled") return ev.won ? b.stake * b.oddsTaken : 0;
  return anchoredValue(ev.prob, probAtPlacementFor(b), b.stake, b.oddsTaken);
}

/** Current model win probability for a round-score bet. */
export function currentProbForBet(
  b: RoundScoreBet,
  playerRoundStates: Record<string, PlayerRoundState>,
): number | null {
  const ev = evaluateRoundScore(b, playerRoundStates[b.playerId]);
  if (!ev) return null;
  if (ev.kind === "not-started") return probAtPlacementFor(b);
  if (ev.kind === "settled") return ev.won ? 1 : 0;
  return ev.prob;
}

/**
 * Winning-score model. Each active player has a final-strokes
 * distribution N(mean, variance). The eventual winner's score =
 * min over active players. Under independence,
 *   P(min < L) = 1 − Π_i P(player_i ≥ L)
 *              = 1 − Π_i (1 − Φ((L − mean_i)/sd_i))
 * "Under L" wins on at-least-one-finishes-below; "over L" wins on
 * all-players-finish-at-or-above. The model treats players as
 * independent — it ignores course-wide correlations (weather etc.),
 * which makes the under side slightly underpriced in reality.
 */
export function evaluateWinningScore(
  bet: WinningScoreBet,
  projections: Record<string, TournamentProjection>,
): { prob: number } | null {
  let logProdMissed = 0;
  let count = 0;
  for (const p of Object.values(projections)) {
    if (!p.active) continue;
    if (p.variance <= 0) {
      // Player has effectively finished — treat as deterministic.
      if (p.mean < bet.line) {
        return { prob: bet.side === "under" ? 1 : 0 };
      }
      continue;
    }
    const sd = Math.sqrt(p.variance);
    const probUnder = clamp01(normalCdf(bet.line, p.mean, sd));
    const probAtLeast = 1 - probUnder;
    if (probAtLeast <= 1e-9) {
      // Player almost certainly finishes under the line → under
      // wins on this player alone.
      return { prob: bet.side === "under" ? 1 : 0 };
    }
    logProdMissed += Math.log(probAtLeast);
    count++;
  }
  if (count === 0) return null;
  const probAllMiss = Math.exp(logProdMissed);
  const probUnder = clamp01(1 - probAllMiss);
  return { prob: bet.side === "under" ? probUnder : 1 - probUnder };
}

// ── History reconstruction ──────────────────────────────────────────

export function reconstructHistory(
  bet: TrackedBet,
  oddsHistories: Record<string, OddsHistorySample[] | null>,
  playerRoundStates: Record<string, PlayerRoundState>,
  feedEvents: FeedRowLike[],
  nowValue: number | null,
  scorecard?: BetScorecard | null,
  dgWinProbs?: Record<string, DgProbHistorySample[] | null>,
  winningScoreHistory?: WinningScoreSnapshot[],
  topFinishHistory?: TopFinishSnapshot[],
  bookOdds?: {
    draftkings: Record<string, OddsHistorySample[] | null>;
    fanduel: Record<string, OddsHistorySample[] | null>;
  },
): PnlSample[] {
  const series: PnlSample[] = [];

  if (bet.kind === "outright") {
    // Source preference: Polymarket primary, DataGolf in-play prob
    // as fallback when Polymarket is thin (illiquid longshot market,
    // late-starting tracking, dedup collapsed everything). "Thin"
    // means < 3 distinct buffer samples for this player.
    const pmSamples = oddsHistories[bet.playerId] ?? [];
    const dgSamples = dgWinProbs?.[bet.playerId] ?? [];
    const POLYMARKET_LIQUIDITY_THRESHOLD = 3;
    const usePolymarket =
      Array.isArray(pmSamples) && pmSamples.length >= POLYMARKET_LIQUIDITY_THRESHOLD;

    // Build a unified (timestamp, prob) sample list for the chart window.
    type Pt = { t: number; prob: number };
    const pts: Pt[] = [];
    if (usePolymarket) {
      for (const s of pmSamples) {
        if (!Number.isFinite(s.p) || s.p <= 1) continue;
        pts.push({ t: s.ts, prob: 1 / s.p });
      }
    } else if (Array.isArray(dgSamples)) {
      for (const s of dgSamples) {
        if (!Number.isFinite(s.prob) || s.prob <= 0 || s.prob >= 1) continue;
        pts.push({ t: s.ts, prob: s.prob });
      }
    }
    // Merge DraftKings + FanDuel samples in regardless. Adds book
    // consensus alongside Polymarket / DataGolf — more data points
    // give the chart a smoother trajectory.
    const dkSamples = bookOdds?.draftkings?.[bet.playerId];
    if (Array.isArray(dkSamples)) {
      for (const s of dkSamples) {
        if (!Number.isFinite(s.p) || s.p <= 1) continue;
        pts.push({ t: s.ts, prob: 1 / s.p });
      }
    }
    const fdSamples = bookOdds?.fanduel?.[bet.playerId];
    if (Array.isArray(fdSamples)) {
      for (const s of fdSamples) {
        if (!Number.isFinite(s.p) || s.p <= 1) continue;
        pts.push({ t: s.ts, prob: 1 / s.p });
      }
    }
    // Only include the placedAt anchor (= the price the user paid)
    // if the buffer has NO real samples near placement time —
    // otherwise the user-paid price differs from the actual market
    // price at that moment and injects a misleading V-dip into the
    // chart line.
    const NEAR_PLACEMENT_MS = 30 * 60 * 1000;
    const haveSampleNearPlacement = pts.some(
      (p) => Math.abs(p.t - bet.placedAt) < NEAR_PLACEMENT_MS,
    );
    if (
      !haveSampleNearPlacement &&
      Date.now() - bet.placedAt < 24 * 60 * 60 * 1000
    ) {
      pts.push({ t: bet.placedAt, prob: 1 / bet.oddsTaken });
    }
    pts.sort((a, b) => a.t - b.t);
    for (const pt of pts) {
      const v = bet.stake * bet.oddsTaken * pt.prob;
      const last = series[series.length - 1];
      if (last && Math.abs(v - last.v) < 0.05 && pt.t - last.t < 60_000)
        continue;
      series.push({ t: pt.t, v });
    }
    // Always append the current value as the rightmost sample so a
    // thin buffer (e.g. a market we just started tracking) still
    // gives the chart two points to draw a line between.
    if (nowValue != null) {
      series.push({ t: Date.now(), v: nowValue });
    }
    return series;
  }

  if (bet.kind === "top-finish") {
    // Build the trajectory from model snapshots. Each snapshot gives
    // the model's prob this player makes the cutoff at that ts; we
    // convert to fair value via stake × prob × oddsTaken (same
    // convention as round-score and winning-score).
    const snaps = topFinishHistory ?? [];
    const sorted = [...snaps].sort((a, b) => a.ts - b.ts);
    for (const snap of sorted) {
      const prob = probForCutoff(bet.cutoff, snap.byPlayer[bet.playerId]);
      if (prob == null) continue;
      let v: number;
      if (prob >= 1) v = bet.stake * bet.oddsTaken;
      else if (prob <= 0) v = 0;
      else v = bet.stake * prob * bet.oddsTaken;
      series.push({ t: snap.ts, v, prob });
    }
    if (nowValue != null) {
      const last = series[series.length - 1];
      if (!last || Math.abs(nowValue - last.v) > 0.01) {
        series.push({ t: Date.now(), v: nowValue });
      }
    }
    return series;
  }

  if (bet.kind === "winning-score") {
    // Build the trajectory from the server-cached CDF history. Each
    // snapshot lets us read P(winner < line) at the bet's line; we
    // convert to value via stake × prob × oddsTaken on the bet's
    // chosen side, same way currentValueForBet does.
    const snapshots = winningScoreHistory ?? [];
    // Snapshots arrive newest-first from /api/feed; sort ascending.
    const sorted = [...snapshots].sort((a, b) => a.ts - b.ts);
    for (const snap of sorted) {
      const probUnder = probUnderAtLine(snap, bet.line);
      if (probUnder == null) continue;
      const prob = bet.side === "under" ? probUnder : 1 - probUnder;
      let v: number;
      if (prob >= 1) v = bet.stake * bet.oddsTaken;
      else if (prob <= 0) v = 0;
      else v = bet.stake * prob * bet.oddsTaken;
      series.push({ t: snap.ts, v, prob });
    }
    if (nowValue != null) {
      const last = series[series.length - 1];
      if (!last || Math.abs(nowValue - last.v) > 0.01) {
        series.push({ t: Date.now(), v: nowValue });
      }
    }
    return series;
  }

  const probAtP = probAtPlacementFor(bet);
  const state = playerRoundStates[bet.playerId];
  const round = bet.round != null ? bet.round : state?.currentRound ?? null;
  if (round == null) {
    // No round context — fall back to a single placement-anchored sample.
    series.push({
      t: bet.placedAt,
      v: bet.stake,
      holesPlayed: 0,
      prob: probAtP,
    });
    if (nowValue != null) series.push({ t: Date.now(), v: nowValue });
    return series;
  }
  const roundSnap = state?.rounds?.[round];

  // Walk the round from hole 0 (pre-round, before anyone teed off)
  // through current. This shows the bet's full trajectory regardless
  // of when the user actually placed it — so a bet placed at hole 5
  // still gets the "would have looked like X at hole 1" context, and
  // a chart-level placement marker shows where they got in.
  if (scorecard && scorecard.holes.length > 0) {
    const holeStats = scorecard.holeStats ?? {};
    const skillPerHole = scorecard.skillPerHole ?? 0;
    type RemEntry = { holeNumber: number; par: number };
    const fullSequence: RemEntry[] = [
      ...scorecard.holes.map((h) => ({
        holeNumber: h.holeNumber,
        par: h.par,
      })),
      ...(scorecard.remaining ?? []).map((h) => ({
        holeNumber: h.holeNumber,
        par: h.par,
      })),
    ];
    let strokes = 0;
    const remaining = [...fullSequence];

    // Hole 0 — pre-round, no holes played yet.
    {
      const proj = projectRemaining(remaining, holeStats, skillPerHole);
      const prob = probFromProjection(
        bet.side,
        bet.line,
        strokes,
        proj.expectedRemaining,
        proj.variance,
      );
      series.push({
        t: bet.placedAt,
        v: anchoredValue(prob, probAtP, bet.stake, bet.oddsTaken),
        holesPlayed: 0,
        prob,
      });
    }

    // Each subsequent hole completion.
    for (let i = 0; i < scorecard.holes.length; i++) {
      const h = scorecard.holes[i];
      strokes += h.strokes;
      remaining.shift();
      const proj = projectRemaining(remaining, holeStats, skillPerHole);
      const prob = probFromProjection(
        bet.side,
        bet.line,
        strokes,
        proj.expectedRemaining,
        proj.variance,
      );
      series.push({
        t: bet.placedAt + (i + 1) * 60_000,
        v: anchoredValue(prob, probAtP, bet.stake, bet.oddsTaken),
        holesPlayed: i + 1,
        prob,
      });
    }
  } else if (roundSnap) {
    // No scorecard — degrade to the feed events list. We won't have
    // per-hole field stats so the projection falls back to a par +
    // constant-variance baseline (no skill adjustment). We can't
    // recover pre-placement holes here either, so we start the chart
    // at placement.
    series.push({
      t: bet.placedAt,
      v: bet.stake,
      holesPlayed: 0,
      prob: probAtP,
    });
    const events = feedEvents
      .filter(
        (r) =>
          r.event.type === "score" &&
          r.event.playerId === bet.playerId &&
          r.event.round === round &&
          r.event.ts >= bet.placedAt &&
          typeof r.event.strokes === "number" &&
          typeof r.event.par === "number" &&
          typeof r.event.hole === "number",
      )
      .sort((a, b) => a.event.ts - b.event.ts);
    let strokes = bet.placement?.strokes ?? 0;
    let parPlayed = bet.placement?.parPlayed ?? 0;
    let holesPlayed = bet.placement?.holesPlayed ?? 0;
    const baselineHoles = holesPlayed;
    const roundPar = bet.placement?.roundPar ?? roundSnap.roundPar;
    for (const r of events) {
      strokes += r.event.strokes!;
      parPlayed += r.event.par!;
      holesPlayed++;
      const holesRemaining = 18 - holesPlayed;
      const parRemaining = roundPar - parPlayed;
      const prob = probFromProjection(
        bet.side,
        bet.line,
        strokes,
        parRemaining,
        holesRemaining * PER_HOLE_VAR,
      );
      series.push({
        t: r.event.ts,
        v: anchoredValue(prob, probAtP, bet.stake, bet.oddsTaken),
        holesPlayed: holesPlayed - baselineHoles,
        prob,
      });
    }
  } else {
    // No scorecard, no round snap — anchor sample only.
    series.push({
      t: bet.placedAt,
      v: bet.stake,
      holesPlayed: 0,
      prob: probAtP,
    });
  }

  if (nowValue != null) {
    const last = series[series.length - 1];
    if (Math.abs(nowValue - last.v) > 0.01) {
      const nowProb =
        currentProbForBet(bet, playerRoundStates) ?? last.prob ?? probAtP;
      series.push({
        t: Date.now(),
        v: nowValue,
        holesPlayed: last.holesPlayed,
        prob: nowProb,
      });
    }
  }
  return series;
}
