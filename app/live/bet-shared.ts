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

import type { FeedRow } from "@/lib/feed/types";
import { projectRoundTotal, roundScoreProb } from "@/lib/bet-model/bet-projection";
import type { PlayerSkill } from "@/lib/bet-model/shot-projection";

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

/** Server-side settlement fields written by notify-poll when a
 *  tournament concludes. Present on every bet kind; null when the
 *  bet is still pending. Stored on Supabase but threaded through
 *  the wire response and into the in-memory bet object so the bet
 *  tracker can render won/lost on bets from past tournaments where
 *  the active-leaderboard-based client detector can't reach. */
export interface BetSettlementFields {
  settledAt?: number | null;
  settledWon?: boolean | null;
  /** Currency captured at placement so PnL/share/notify can render
   *  in the user's actual betting currency. Optional for back-compat
   *  with bets placed before multi-currency landed — those default
   *  to GBP at render time. */
  currency?: import("@/lib/format/bet-currency").BetCurrency;
  /** Owner-only flag: when true the bet is hidden from fellow group
   *  members (excluded from standings P&L, most-backed aggregation,
   *  and the member's profile). Defaults to undefined / false. */
  isPrivate?: boolean;
  /** Orchestrator tournament id stamped at placement time. Optional
   *  here only so legacy bets (placed before this field landed)
   *  still type-check; new placements must populate it. The
   *  settlement layer uses this to route bets to the LIVE detector
   *  (when the active tournament matches) vs the HISTORICAL detector
   *  (when the bet's tournament has finished and another's running).
   *  Without it, every unsettled bet implicitly retargets whichever
   *  tournament happens to be active when it's read — the bug that
   *  surfaced as "my Memorial bets are showing on US Open." */
  tournamentId?: string;
  /** Display name captured at placement so the UI can show e.g.
   *  "the Memorial Tournament" without a feed lookup, even after
   *  the active event has rolled forward. Optional for legacy
   *  back-compat. */
  tournamentName?: string;
}


export interface OutrightBet extends BetSettlementFields {
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
  /** Resolved round number at placement time. Captures the user's
   *  intent for "current round" bets: if a round was in progress when
   *  the bet was placed, the bet locks to THAT round; otherwise it
   *  locks to the next round to start. Without this, render-time
   *  resolveBetRound() drifts to whatever state.currentRound happens
   *  to be later (so a bet placed during R1 drifts to R2 once R1
   *  completes). Optional for back-compat with bets placed before
   *  this field was introduced. */
  round?: number;
}

export interface RoundScoreBet extends BetSettlementFields {
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

export interface WinningScoreBet extends BetSettlementFields {
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

export interface TopFinishBet extends BetSettlementFields {
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

// ── Persistence (localStorage + optional server sync) ─────────────

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

/** Custom event fired on any write to the local bet store. Same
 *  pattern as `pardle-follows-changed`: consumers (BetTracker,
 *  useRealBets on /bets, useRealLeaderboard's bet-tag layer) listen
 *  for this and re-read so a new bet shows up immediately without
 *  a page reload. The native `storage` event only fires cross-tab,
 *  so we need our own event for same-tab updates. */
export const BETS_CHANGED_EVENT = "pardle-bets-changed";

export function writeBets(bets: TrackedBet[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
  window.localStorage.removeItem(LEGACY_KEY);
  try {
    window.dispatchEvent(new CustomEvent(BETS_CHANGED_EVENT));
  } catch {
    // CustomEvent constructor exists in every browser we support
    // but defend against odd embedded webviews just in case.
  }
}

export function readBetById(id: string): TrackedBet | null {
  return readBets().find((b) => b.id === id) ?? null;
}

/** Fire-and-forget upsert to the server when signed in. Always writes
 *  to localStorage too so the bet is visible immediately and survives
 *  a brief offline period. */
export async function persistBet(bet: TrackedBet): Promise<void> {
  if (typeof window === "undefined") return;
  const existing = readBets().filter((b) => b.id !== bet.id);
  writeBets([...existing, bet]);
  try {
    // Attach the visitor's cookie authorKey so the settle path can
    // route the settled outcome back to their Sharp Score ledger.
    // Same identity used by comments/reactions/putt-poll votes.
    const authorKey =
      window.localStorage.getItem("pardle_feed_author") ?? "";
    await fetch("/api/bets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...bet, authorKey }),
    });
  } catch {
    // Anonymous users get a 401 here — that's fine, localStorage
    // remains the source of truth until they sign in.
  }
}

/** Resolve a bet's playerId to a canonical orchestrator id by
 *  matching against a live leaderboard. Handles two failure modes:
 *
 *   (a) The bet was placed pre-tournament via the AddBetSheet's
 *       /api/field fallback, which stored a DataGolf-prefixed id
 *       ("dg-12345") that never matches the orchestrator's numeric
 *       ids ("40026") once play starts.
 *   (b) Any other future ID-system drift between the bet store and
 *       the live feed.
 *
 *  Returns the bet's existing playerId when it already matches a
 *  leaderboard row, otherwise the orchestrator id of the player
 *  whose name matches. Falls back to the original id if no match
 *  is found so callers can still do their default "no live state"
 *  rendering.
 *
 *  When a resolution happens, side-effect-writes the new id back
 *  into localStorage so the bet self-heals — subsequent renders
 *  use the canonical id directly without paying the lookup cost.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function lastNameOf(name: string): string {
  const parts = normaliseName(name).split(" ");
  return parts[parts.length - 1] ?? "";
}

interface LeaderboardLike {
  playerId: string;
  displayName: string;
}

export function resolveBetPlayerId(
  bet: TrackedBet,
  leaderboard: LeaderboardLike[],
): string {
  if (bet.kind === "winning-score") return ""; // no player to resolve
  const currentId =
    "playerId" in bet ? (bet as { playerId: string }).playerId : "";
  if (!currentId) return "";
  // Direct match — most common case once the bet has been resolved
  // once. Also covers bets placed via real-leaderboard ids from the
  // start.
  if (leaderboard.some((r) => r.playerId === currentId)) return currentId;
  const name = "playerName" in bet ? bet.playerName : "";
  if (!name) return currentId;
  const target = normaliseName(name);
  const targetLast = lastNameOf(name);
  // Exact normalised match.
  let hit = leaderboard.find((r) => normaliseName(r.displayName) === target);
  // Fall back to last-name match — covers "R. Henley" ↔ "Russell Henley"
  // and other initial/full forms users picked from in the sheet.
  if (!hit && targetLast.length >= 3) {
    hit = leaderboard.find((r) => lastNameOf(r.displayName) === targetLast);
  }
  if (!hit) return currentId;
  // Self-heal: write the resolved id back so future loads skip the
  // lookup. Anonymous bets stay in localStorage; signed-in users get
  // a follow-up POST to /api/bets on the next persistBet path.
  if (typeof window !== "undefined") {
    try {
      const all = readBets();
      let dirty = false;
      const next = all.map((b) => {
        if (b.id !== bet.id) return b;
        if ("playerId" in b && b.playerId !== hit!.playerId) {
          dirty = true;
          return { ...b, playerId: hit!.playerId } as TrackedBet;
        }
        return b;
      });
      if (dirty) writeBets(next);
    } catch {
      // localStorage quota / private mode — ignore; in-memory
      // resolution still works for this render.
    }
  }
  return hit.playerId;
}

/** Soft-remove a bet from both local and (if authed) server. */
export async function removeBetEverywhere(betId: string): Promise<void> {
  if (typeof window === "undefined") return;
  writeBets(readBets().filter((b) => b.id !== betId));
  try {
    await fetch(`/api/bets/${encodeURIComponent(betId)}`, {
      method: "DELETE",
    });
  } catch {
    // Anonymous — localStorage is the only place this lived anyway.
  }
}

/** Server bets win on conflict (they're cross-device truth). Merges
 *  any localStorage-only bets (anonymous-era) into the result so we
 *  don't lose work between sessions. */
export function mergeServerAndLocal(
  serverBets: TrackedBet[],
  localBets: TrackedBet[],
): TrackedBet[] {
  const byId = new Map<string, TrackedBet>();
  for (const b of localBets) byId.set(b.id, b);
  for (const b of serverBets) byId.set(b.id, b);
  return Array.from(byId.values()).sort((a, b) => b.placedAt - a.placedAt);
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
      round,
      holesPlayed: r.holesPlayed,
      strokes: r.strokes,
      parPlayed: r.parPlayed,
      roundPar: r.roundPar,
      ttdPacePerHole: state.ttdPacePerHole ?? 0,
      probAtPlacement: prob > 0 ? prob : 1 / b.oddsTaken,
    },
  };
}

/**
 * Resolve which round a "current round" bet (bet.round = null) should
 * lock to at placement time, following the rule:
 *   - if a round is in progress (or about to start) → that round
 *   - else if the active round just completed → next round (clamped to 4)
 */
function roundAtPlacement(state: PlayerRoundState): number | null {
  const cur = state.currentRound;
  if (typeof cur !== "number") return null;
  const snap = state.rounds?.[cur];
  if (snap?.status === "complete") {
    return Math.min(4, cur + 1);
  }
  return cur;
}

/** Build the placement snapshot stored on a new round-score bet. */
export function snapshotForPlacement(
  bet: Pick<RoundScoreBet, "round" | "line" | "side" | "oddsTaken">,
  state: PlayerRoundState | undefined,
): RoundScorePlacement | undefined {
  if (!state) return undefined;
  const round = bet.round ?? roundAtPlacement(state);
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
    round,
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

/**
 * Resolve which tournament round a round-score bet actually targets.
 * When the bet was placed with `bet.round = null` (the UI calls this
 * "current round at placement time"), we have to figure out what
 * "current round" was for the bet AT placement time.
 *
 * For LIVE bets: use the player's currentRound from playerRoundStates.
 *
 * For PAST-TOURNAMENT replays: playerRoundStates.currentRound is
 * usually R4 (the last completed round), which is wrong for an R2/R3
 * bet. If `tournamentStartDate` is passed, fall back to a Thu/Fri/Sat/
 * Sun heuristic: floor(days_since_start) + 1, clamped to [1, 4].
 */
export function resolveBetRound(
  bet: RoundScoreBet,
  state: PlayerRoundState | undefined,
  tournamentStartDate?: number | null,
): number | null {
  // Explicit round on the bet wins everything else.
  if (bet.round != null) return bet.round;
  // Placement-time round (captured at submit) is the next preference —
  // tells us which round was intended when "current round" was picked.
  // Newer bets always have this; older bets fall through to date heuristics.
  if (bet.placement?.round != null) return bet.placement.round;
  if (tournamentStartDate != null) {
    const diffDays =
      (bet.placedAt - tournamentStartDate) / (24 * 60 * 60 * 1000);
    if (Number.isFinite(diffDays)) {
      return Math.min(4, Math.max(1, Math.floor(diffDays) + 1));
    }
  }
  return state?.currentRound ?? null;
}

export function evaluateRoundScore(
  bet: RoundScoreBet,
  state: PlayerRoundState | undefined,
  /** Optional live rows for shot-aware projection. When passed AND a
   *  mid-hole IMG shot is available for (playerId, round), the projection
   *  layers the shot-level model on top of the snap so the bet updates
   *  on every shot rather than just on hole completions. */
  contextRows?: FeedRow[],
  /** Optional per-player SG skill inputs for the shot projection. */
  playerSkill?: Record<string, PlayerSkill>,
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
  // Shot-aware path. Trust the shot projection only when it actually
  // saw a mid-hole IMG shot — else the server snap is at least as
  // current and carries the field-anchored, skill-adjusted baseline.
  // For the un-touched *remaining* holes (all holes past the current
  // one), pass the snap's expected-remaining through so those holes
  // stay field-anchored / skill-adjusted instead of falling back to
  // raw par. The shot-aware model then only revises the current hole.
  if (contextRows) {
    const holePars: Record<number, number> = {};
    for (const row of contextRows) {
      const ev = row.event;
      if (
        ev.playerId === bet.playerId &&
        ev.round === round &&
        typeof ev.hole === "number" &&
        typeof ev.par === "number"
      ) {
        holePars[ev.hole] = ev.par;
      }
    }
    const snap = projectionFromSnap(r);
    const projection = projectRoundTotal({
      rows: contextRows,
      playerId: bet.playerId,
      round,
      skill: playerSkill?.[bet.playerId],
      roundPar: r.roundPar,
      holePars,
      snapExpectedRemaining: snap.expectedRemaining,
      snapHolesRemaining: r.holesRemaining,
    });
    if (projection.currentHole) {
      const prob = roundScoreProb({
        projection,
        line: bet.line,
        side: bet.side,
      });
      return { kind: "in-progress", round, prob, roundState: r };
    }
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

export interface PlayerForSettlement {
  playerId: string;
  position: string;
  thru: string;
  playerState?: string;
}

const INACTIVE_LEADERBOARD_STATES = new Set([
  "CUT",
  "WD",
  "MC",
  "DQ",
  "DNS",
]);

/**
 * Has the tournament concluded?
 *
 * thru="F" alone is NOT enough — at the end of R1/R2/R3 every player
 * who finished that round shows thru="F" mid-tournament. Without the
 * R4-completion check we'd flip outright/top-finish/winning-score
 * bets to settled the moment R1 ended (the original Memorial bug).
 *
 * So we require, for every active player on the leaderboard, that
 * their PlayerRoundState shows currentRound=4 AND holesRemaining=0.
 * Players marked CUT/WD/MC/DQ/DNS (or thru="—" for placeholder
 * inactive states) are skipped.
 *
 * Synchronous-safe mirror of pgatour.ts's isTournamentConcluded, but
 * without the 80h-since-start time gate — that gate is a server-side
 * safety net against between-rounds gaps and isn't reachable from the
 * notify-poll caller. The bet-row's last_notified_at + the cron's
 * own polling cadence give equivalent debouncing here.
 */
function isLeaderboardFinal(
  players: PlayerForSettlement[],
  playerRoundStates: Record<string, PlayerRoundState>,
): boolean {
  if (players.length === 0) return false;
  let anyActive = false;
  for (const p of players) {
    if (p.playerState && INACTIVE_LEADERBOARD_STATES.has(p.playerState)) continue;
    if (p.thru === "—") continue;
    if (p.thru !== "F") return false;
    const s = playerRoundStates[p.playerId];
    if (!s) return false;
    if (s.currentRound !== 4 || s.holesRemaining !== 0) return false;
    anyActive = true;
  }
  return anyActive;
}

/**
 * Detect a settled tournament from the live leaderboard. Returns the
 * winner's playerId. Handles both the common (sole winner) and the
 * less-common (playoff / shared 1st) cases.
 *
 * The leaderboard is considered settled when:
 *   - The bet's player has played all 18 holes of R4, AND
 *   - Every other active player on the leaderboard is also thru "F".
 *
 * If multiple players share position 1 (post-playoff orchestrator
 * lag, or a genuinely tied final) we return the first listed leader.
 * Downstream callers settle outright/top-finish/winning-score by
 * checking the bet against the leaderboard's actual position(s), so
 * a tie-at-1 still correctly settles a backer of any tied player as
 * "won" (industry standard dead-heat behaviour). The previous
 * `leaders.length !== 1` short-circuit meant tied finishes left
 * every bet permanently unsettled until manual intervention.
 *
 * We use this on the client to short-circuit outright bet valuation
 * once the tournament's done — otherwise we keep multiplying the
 * stake by the last cached market price, which can leave a winning
 * ticket showing ~0% (the pre-settlement longshot price).
 */
export function findOutrightWinner(
  players: PlayerForSettlement[],
  playerRoundStates: Record<string, PlayerRoundState>,
): string | null {
  // Gate everything on a genuinely-final leaderboard (every active
  // player thru "F" of R4) so an "F" at the end of R1/R2/R3 can never
  // trigger settlement. Both the sole-leader and the tied-T1 case
  // share this gate now — the previous sole-leader fast path could
  // settle before all R4 strokes were in, and the tied path relied
  // on an isLeaderboardFinal that ignored which round players had
  // finished. See the comment on isLeaderboardFinal for the bug
  // history.
  if (!isLeaderboardFinal(players, playerRoundStates)) return null;
  const leaders = players.filter(
    (p) => (p.position === "1" || p.position === "T1") && p.thru === "F",
  );
  if (leaders.length === 0) return null;
  // For tied finishes, downstream settlement reads the actual
  // position string on the bet's player row — any backer of a
  // co-winner still settles as won (dead-heat).
  return leaders[0].playerId;
}

/** Strip the optional "T" prefix and parse to int. "T10" → 10, "1" →
 *  1, "T1" → 1, anything else → null. */
function parseLeaderboardPosition(pos: string): number | null {
  if (!pos) return null;
  const m = pos.match(/^T?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Top-finish bet settlement — returns { won } once the tournament
 * leaderboard is final. A "Top N" bet wins when the player's final
 * position (T-prefix stripped) is ≤ N. Players missing from the
 * leaderboard (e.g. missed cut, WD) settle as lost.
 *
 * Returns null while the tournament is still in progress so the
 * caller falls back to the live model prob.
 */
export function topFinishSettlement(
  bet: TopFinishBet,
  players: PlayerForSettlement[],
  playerRoundStates: Record<string, PlayerRoundState>,
): { won: boolean } | null {
  // Same gate as outright: the leaderboard is only "final" once a
  // sole position-1 finisher exists with R4 complete.
  if (!findOutrightWinner(players, playerRoundStates)) return null;
  const row = players.find((p) => p.playerId === bet.playerId);
  if (!row) return { won: false };
  const pos = parseLeaderboardPosition(row.position);
  if (pos === null) return { won: false };
  return { won: pos <= bet.cutoff };
}

/**
 * Winning-score bet settlement — once the tournament's settled we
 * read the winner's actual final stroke total from the projection
 * (variance collapses to 0 when all 4 rounds are in, so mean = the
 * real total). "Under L" wins when total < L; "over L" wins on ≥.
 */
export function winningScoreSettlement(
  bet: WinningScoreBet,
  players: PlayerForSettlement[],
  playerRoundStates: Record<string, PlayerRoundState>,
  tournamentProjections: Record<string, TournamentProjection>,
): { won: boolean; winningStrokes: number } | null {
  const winnerId = findOutrightWinner(players, playerRoundStates);
  if (!winnerId) return null;
  const proj = tournamentProjections[winnerId];
  if (!proj || !Number.isFinite(proj.mean)) return null;
  const winningStrokes = proj.mean;
  const won =
    bet.side === "under"
      ? winningStrokes < bet.line
      : winningStrokes >= bet.line;
  return { won, winningStrokes };
}

/**
 * Single entry point for "is this bet settled?" — returns the won
 * flag for outright / top-finish / winning-score. Round-score bets
 * settle per-round via evaluateRoundScore, so they go through the
 * existing path. Used by both the client (bet-tracker display) and
 * the notify-poll cron (push notifications + Supabase patch).
 */
export function detectBetSettlement(
  bet: TrackedBet,
  players: PlayerForSettlement[],
  playerRoundStates: Record<string, PlayerRoundState>,
  tournamentProjections: Record<string, TournamentProjection>,
): { won: boolean } | null {
  if (bet.kind === "outright") {
    const winner = findOutrightWinner(players, playerRoundStates);
    if (!winner) return null;
    // Co-winners share the title — any player sitting at position
    // "1" or "T1" at the moment findOutrightWinner returned a value
    // is a winning backer. Industry dead-heat rules pay each at full
    // odds for our binary won/lost classification.
    const row = players.find((p) => p.playerId === bet.playerId);
    const isCoWinner =
      !!row && (row.position === "1" || row.position === "T1");
    return { won: isCoWinner };
  }
  if (bet.kind === "top-finish") {
    return topFinishSettlement(bet, players, playerRoundStates);
  }
  if (bet.kind === "winning-score") {
    const r = winningScoreSettlement(
      bet,
      players,
      playerRoundStates,
      tournamentProjections,
    );
    return r ? { won: r.won } : null;
  }
  return null;
}

/**
 * Nudge each active player's TournamentProjection by the shot-aware
 * delta on their in-progress round.
 *
 *   delta = shotAwareRoundTotal − snapRoundTotal   (current round only)
 *   adjusted.mean = original.mean + delta
 *   adjusted.variance ≈ original.variance − 0.4 · PER_HOLE_VAR
 *     (mid-hole cuts uncertainty on the in-flight hole a bit)
 *
 * Only fires for players who have an IMG-sourced mid-hole shot in
 * `rows` — everyone else stays on the server projection unchanged.
 * The result is fed straight into evaluateWinningScore so a birdie
 * hole-out on the leader shifts the "winner under X" prob within one
 * client poll instead of waiting on the next server projection cycle.
 */
function adjustProjectionsForShots(
  projections: Record<string, TournamentProjection>,
  playerRoundStates: Record<string, PlayerRoundState>,
  rows: FeedRow[],
  playerSkill?: Record<string, PlayerSkill>,
): Record<string, TournamentProjection> {
  // Group shot events by (playerId, round) — take the newest per pair.
  const latestShotByPlayerRound = new Map<
    string,
    { playerId: string; round: number; ts: number }
  >();
  for (const row of rows) {
    const ev = row.event;
    if (
      ev.type !== "shot" ||
      !ev.imgSourced ||
      typeof ev.hole !== "number" ||
      typeof ev.round !== "number"
    ) {
      continue;
    }
    const key = `${ev.playerId}:${ev.round}`;
    const prior = latestShotByPlayerRound.get(key);
    if (!prior || ev.ts > prior.ts) {
      latestShotByPlayerRound.set(key, {
        playerId: ev.playerId,
        round: ev.round,
        ts: ev.ts,
      });
    }
  }
  if (latestShotByPlayerRound.size === 0) return projections;

  const adjusted: Record<string, TournamentProjection> = { ...projections };
  for (const { playerId, round } of latestShotByPlayerRound.values()) {
    const orig = adjusted[playerId];
    if (!orig || !orig.active) continue;
    const state = playerRoundStates[playerId];
    if (!state) continue;
    const rs = state.rounds?.[round];
    if (!rs || rs.status !== "in-progress") continue;

    const snap = projectionFromSnap(rs);
    const snapRoundTotal = rs.strokes + snap.expectedRemaining;

    const holePars: Record<number, number> = {};
    for (const row of rows) {
      const ev = row.event;
      if (
        ev.playerId === playerId &&
        ev.round === round &&
        typeof ev.hole === "number" &&
        typeof ev.par === "number"
      ) {
        holePars[ev.hole] = ev.par;
      }
    }
    const shotProjection = projectRoundTotal({
      rows,
      playerId,
      round,
      skill: playerSkill?.[playerId],
      roundPar: rs.roundPar,
      holePars,
      snapExpectedRemaining: snap.expectedRemaining,
      snapHolesRemaining: rs.holesRemaining,
    });
    if (!shotProjection.currentHole) continue;

    const delta = shotProjection.expectedRoundTotal - snapRoundTotal;
    // Shrink variance slightly to reflect knowing SOME shots this hole.
    // Floor at half of PER_HOLE_VAR so the projection can't collapse.
    const nudgedVar = Math.max(
      orig.variance - 0.4 * PER_HOLE_VAR,
      PER_HOLE_VAR * 0.5,
    );
    adjusted[playerId] = {
      ...orig,
      mean: orig.mean + delta,
      variance: nudgedVar,
    };
  }
  return adjusted;
}

export function currentValueForBet(
  b: TrackedBet,
  currentOdds: Record<string, number>,
  playerRoundStates: Record<string, PlayerRoundState>,
  tournamentProjections?: Record<string, TournamentProjection>,
  topFinishCurrent?: Record<string, TopFinishProbs>,
  /** Per-bet settlement override. Pass non-null once the tournament's
   *  finished + we've decided this bet won/lost — short-circuits the
   *  live model maths to a definite payout or zero. */
  settled?: { won: boolean } | null,
  /** Leaderboard rows for playerId reconciliation — pre-tournament
   *  bets saved via /api/field have dg-* ids; resolve them to the
   *  orchestrator id by name before keying into the state maps. */
  leaderboard?: LeaderboardLike[],
  /** Optional live rows + per-player skill for shot-aware round-score
   *  projection. When passed, round-score bets update on every IMG
   *  shot instead of only on hole completion. Ignored for other kinds. */
  contextRows?: FeedRow[],
  playerSkill?: Record<string, PlayerSkill>,
): number | null {
  const resolvedPid = leaderboard
    ? resolveBetPlayerId(b, leaderboard)
    : "playerId" in b
      ? (b as { playerId: string }).playerId
      : "";
  // Tournament-over short-circuit applies uniformly to outright /
  // top-finish / winning-score (round-score has its own per-round
  // settlement path via evaluateRoundScore further down).
  if (settled) {
    if (
      b.kind === "outright" ||
      b.kind === "top-finish" ||
      b.kind === "winning-score"
    ) {
      return settled.won ? b.stake * b.oddsTaken : 0;
    }
  }
  if (b.kind === "outright") {
    const fair = currentOdds[resolvedPid || b.playerId];
    if (!Number.isFinite(fair) || fair <= 1) return null;
    return b.stake * (b.oddsTaken / fair);
  }
  if (b.kind === "top-finish") {
    const prob = probForCutoff(
      b.cutoff,
      topFinishCurrent?.[resolvedPid || b.playerId],
    );
    if (prob == null) return null;
    if (prob >= 1) return b.stake * b.oddsTaken;
    if (prob <= 0) return 0;
    return b.stake * prob * b.oddsTaken;
  }
  if (b.kind === "winning-score") {
    if (!tournamentProjections) return null;
    // Shot-aware layer: nudge every mid-hole active player's mean +
    // variance by the shot-model delta so a birdie hole-out on the
    // leader immediately shortens the winning-under line (etc.),
    // without waiting on the server's per-poll projection refresh.
    const projections = contextRows
      ? adjustProjectionsForShots(
          tournamentProjections,
          playerRoundStates,
          contextRows,
          playerSkill,
        )
      : tournamentProjections;
    const ev = evaluateWinningScore(b, projections);
    if (!ev) return null;
    if (ev.prob >= 1) return b.stake * b.oddsTaken;
    if (ev.prob <= 0) return 0;
    return b.stake * ev.prob * b.oddsTaken;
  }
  const ev = evaluateRoundScore(
    b,
    playerRoundStates[resolvedPid || (b as RoundScoreBet).playerId],
    contextRows,
    playerSkill,
  );
  if (!ev) return null;
  if (ev.kind === "not-started") return b.stake;
  if (ev.kind === "settled") return ev.won ? b.stake * b.oddsTaken : 0;
  return anchoredValue(ev.prob, probAtPlacementFor(b), b.stake, b.oddsTaken);
}

/** Current model win probability for a round-score bet. */
export function currentProbForBet(
  b: RoundScoreBet,
  playerRoundStates: Record<string, PlayerRoundState>,
  contextRows?: FeedRow[],
  playerSkill?: Record<string, PlayerSkill>,
): number | null {
  const ev = evaluateRoundScore(
    b,
    playerRoundStates[b.playerId],
    contextRows,
    playerSkill,
  );
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

/**
 * Trim a trailing run of effectively-constant values from a PnL
 * series. Catches the "Polymarket price hit 1.0 on Sunday and kept
 * ticking the same value through Wednesday" case where the chart
 * would otherwise stretch days past tournament end.
 *
 * Only trims when the constant tail spans more than `minTailMs` of
 * wall-clock time — that's the signal that the market resolved and
 * the buffer is just recording a flat post-settlement value.
 */
function trimTrailingFlat(series: PnlSample[]): PnlSample[] {
  if (series.length < 3) return series;
  const lastV = series[series.length - 1].v;
  // Relative tolerance — 3% of the last value, floor £0.50. A £290
  // settled bet allows £8.70 of wobble in the flat tail (Polymarket
  // = 290 exactly but DK/FD secondary samples can sit a few quid off);
  // a £10 round-score bet still gets a 50p floor.
  const eps = Math.max(0.5, Math.abs(lastV) * 0.03);
  let firstConstantIdx = series.length - 1;
  for (let i = series.length - 2; i >= 0; i--) {
    if (Math.abs(series[i].v - lastV) > eps) break;
    firstConstantIdx = i;
  }
  // Need a few samples worth of constancy AND a meaningful time span
  // (>1 hour) before we call it a post-settlement flatline.
  if (series.length - firstConstantIdx < 3) return series;
  const tailSpan =
    series[series.length - 1].t - series[firstConstantIdx].t;
  if (tailSpan < 60 * 60 * 1000) return series;
  return series.slice(0, firstConstantIdx + 1);
}

/**
 * For round-score bets, append one PnlSample per in-progress-hole
 * IMG shot event. Sits after the hole-completion loop and only fires
 * for shots on holes that haven't shown up as a completed score
 * event yet. Uses projectRoundTotal + roundScoreProb — the exact
 * same path currentValueForBet takes, so the chart is guaranteed
 * to line up with the live card.
 */
function appendShotSamples(
  series: PnlSample[],
  bet: RoundScoreBet,
  playerId: string,
  round: number,
  feedEvents: FeedRowLike[],
  probAtP: number,
  strokesPlayedTotal: number,
  remainingHoleEntries: { holeNumber: number; par: number }[] | null,
  holeStats: Record<number, FieldHoleStat> | null,
  skillPerHole: number | null,
): void {
  // Every IMG shot event for this (player, round), regardless of
  // whether the hole has since completed. Historical shot samples
  // represent real mid-play predictions the model made and belong
  // on the chart timeline between hole-completion ticks. Their
  // fractional `holesPlayed` positions them between the surrounding
  // integer hole ticks.
  const shotEvents = feedEvents
    .filter((r) => {
      const ev = r.event;
      return (
        ev.type === "shot" &&
        ev.playerId === playerId &&
        ev.round === round &&
        typeof ev.hole === "number"
      );
    })
    .sort((a, b) => a.event.ts - b.event.ts);
  if (shotEvents.length === 0) return;

  // The projection uses roundPar + holePars where available. Both
  // paths (scorecard vs snap-fallback) can source these from the
  // events list.
  const holePars: Record<number, number> = {};
  for (const r of feedEvents) {
    const ev = r.event;
    if (
      ev.playerId === playerId &&
      ev.round === round &&
      typeof ev.hole === "number" &&
      typeof ev.par === "number"
    ) {
      holePars[ev.hole] = ev.par;
    }
  }
  const roundPar =
    bet.placement?.roundPar ??
    (Object.values(holePars).reduce((a, b) => a + b, 0) || 72);

  // Precompute snap fallback for the tail — same shape evaluateRoundScore
  // passes when the shot-aware path fires live. For the scorecard path
  // (holeStats + skillPerHole provided), we use projectRemaining to get
  // a matched projection for the un-touched tail. For the snap-fallback
  // path, we let projectRoundTotal fall back to raw hole par (no field
  // data available in that mode).
  let snapExpectedRemaining: number | undefined;
  let snapHolesRemaining: number | undefined;
  if (remainingHoleEntries && holeStats && skillPerHole != null) {
    const proj = projectRemaining(remainingHoleEntries, holeStats, skillPerHole);
    snapExpectedRemaining = proj.expectedRemaining;
    snapHolesRemaining = remainingHoleEntries.length;
  }

  for (const r of shotEvents) {
    const ev = r.event as {
      hole?: number;
      imgShotNum?: number;
    };
    const upTo = feedEvents.filter((row) => row.event.ts <= r.event.ts);
    // Type-widen upTo to the FeedRow shape projectRoundTotal expects.
    // reconstructHistory takes FeedRowLike; at runtime these carry the
    // full FeedEvent shape (see BetDetail's FeedResponse type).
    const projection = projectRoundTotal({
      rows: upTo as unknown as import("@/lib/feed/types").FeedRow[],
      playerId,
      round,
      roundPar,
      holePars,
      snapExpectedRemaining,
      snapHolesRemaining,
    });
    if (!projection.currentHole) continue;
    const prob = roundScoreProb({
      projection,
      line: bet.line,
      side: bet.side,
    });
    // Fractional holesPlayed places the shot sample between the
    // surrounding hole-completion ticks. Shot N on hole H → position
    // is (H − 1) + min(0.85, N × 0.15). Capping at 0.85 means shot
    // samples never overrun the hole's own completion tick.
    const holeNum = ev.hole ?? 0;
    const shotNum = typeof ev.imgShotNum === "number" ? ev.imgShotNum : 1;
    const holesPlayed = holeNum - 1 + Math.min(0.85, shotNum * 0.15);
    // Deduplicate: skip when the previous sample is at (nearly) the
    // same x-position AND (nearly) the same prob. Prevents burst-
    // publishing a shot event moments after a hole score event from
    // producing a zero-width spike.
    const last = series[series.length - 1];
    if (
      last &&
      typeof last.holesPlayed === "number" &&
      Math.abs(holesPlayed - last.holesPlayed) < 0.02 &&
      Math.abs(prob - (last.prob ?? 0)) < 0.005
    ) {
      continue;
    }
    series.push({
      t: r.event.ts,
      v: anchoredValue(prob, probAtP, bet.stake, bet.oddsTaken),
      holesPlayed,
      prob,
    });
  }
  // Prevent silencing the unused-param lint for strokesPlayedTotal —
  // kept in the signature so future calibration work (e.g. anchoring
  // the shot-projection to the running strokes for auditability) has
  // it available without another signature change.
  void strokesPlayedTotal;
}

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
  leaderboard?: LeaderboardLike[],
): PnlSample[] {
  // Resolve the bet's playerId before any state lookups — pre-
  // tournament bets carry dg-* ids that need to be reconciled to the
  // live orchestrator id once the leaderboard arrives. See
  // resolveBetPlayerId for the matching rules.
  const _resolvedPid = leaderboard
    ? resolveBetPlayerId(bet, leaderboard)
    : "playerId" in bet
      ? (bet as { playerId: string }).playerId
      : "";
  const series: PnlSample[] = [];
  // For settled bets the chart should stop at settlement, not at
  // "right now" — otherwise the x-axis stretches days into the
  // post-tournament void as the page keeps re-rendering. Falls back
  // to Date.now() for live bets where settledAt is null.
  const chartNow = bet.settledAt ?? Date.now();

  if (bet.kind === "outright") {
    // Source preference: Polymarket primary, DataGolf in-play prob
    // as fallback when Polymarket is thin (illiquid longshot market,
    // late-starting tracking, dedup collapsed everything). "Thin"
    // means < 3 distinct buffer samples for this player.
    const pid = _resolvedPid || bet.playerId;
    const pmSamples = oddsHistories?.[pid] ?? [];
    const dgSamples = dgWinProbs?.[pid] ?? [];
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
    const dkSamples = bookOdds?.draftkings?.[pid];
    if (Array.isArray(dkSamples)) {
      for (const s of dkSamples) {
        if (!Number.isFinite(s.p) || s.p <= 1) continue;
        pts.push({ t: s.ts, prob: 1 / s.p });
      }
    }
    const fdSamples = bookOdds?.fanduel?.[pid];
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
      // Drop sample ticks that arrived after the bet settled — they
      // don't represent a tradable price anymore and just extend the
      // chart's right edge into post-tournament dead air.
      if (bet.settledAt != null && pt.t > bet.settledAt) continue;
      const v = bet.stake * bet.oddsTaken * pt.prob;
      const last = series[series.length - 1];
      if (last && Math.abs(v - last.v) < 0.05 && pt.t - last.t < 60_000)
        continue;
      // Carry prob on every sample so the chart footer can read the
      // current model win % without falling back to "—".
      series.push({ t: pt.t, v, prob: pt.prob });
    }
    // Always append the current value as the rightmost sample so a
    // thin buffer (e.g. a market we just started tracking) still
    // gives the chart two points to draw a line between. For settled
    // bets the tip lands at settledAt instead of "now".
    if (nowValue != null) {
      const last = series[series.length - 1];
      const maxPayout = bet.stake * bet.oddsTaken;
      const nowProb =
        maxPayout > 0
          ? Math.max(0, Math.min(1, nowValue / maxPayout))
          : last?.prob;
      series.push({ t: chartNow, v: nowValue, prob: nowProb });
    }
    return trimTrailingFlat(series);
  }

  if (bet.kind === "top-finish") {
    // Build the trajectory from model snapshots. Each snapshot gives
    // the model's prob this player makes the cutoff at that ts; we
    // convert to fair value via stake × prob × oddsTaken (same
    // convention as round-score and winning-score).
    const snaps = topFinishHistory ?? [];
    const sorted = [...snaps].sort((a, b) => a.ts - b.ts);
    for (const snap of sorted) {
      if (bet.settledAt != null && snap.ts > bet.settledAt) continue;
      const prob = probForCutoff(
        bet.cutoff,
        snap.byPlayer[_resolvedPid || bet.playerId],
      );
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
        const maxPayout = bet.stake * bet.oddsTaken;
        const nowProb =
          maxPayout > 0
            ? Math.max(0, Math.min(1, nowValue / maxPayout))
            : last?.prob;
        series.push({ t: chartNow, v: nowValue, prob: nowProb });
      }
    }
    return trimTrailingFlat(series);
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
      if (bet.settledAt != null && snap.ts > bet.settledAt) continue;
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
        const maxPayout = bet.stake * bet.oddsTaken;
        const nowProb =
          maxPayout > 0
            ? Math.max(0, Math.min(1, nowValue / maxPayout))
            : last?.prob;
        series.push({ t: chartNow, v: nowValue, prob: nowProb });
      }
    }
    return trimTrailingFlat(series);
  }

  const probAtP = probAtPlacementFor(bet);
  const rsPid = _resolvedPid || bet.playerId;
  const state = playerRoundStates[rsPid];
  const round = bet.round != null ? bet.round : state?.currentRound ?? null;
  if (round == null) {
    // No round context — fall back to a single placement-anchored sample.
    series.push({
      t: bet.placedAt,
      v: bet.stake,
      holesPlayed: 0,
      prob: probAtP,
    });
    if (nowValue != null) {
      const maxPayout = bet.stake * bet.oddsTaken;
      const nowProb =
        maxPayout > 0
          ? Math.max(0, Math.min(1, nowValue / maxPayout))
          : probAtP;
      series.push({ t: chartNow, v: nowValue, prob: nowProb });
    }
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
    // Shot-level tail: for each IMG shot event on holes NOT already in
    // scorecard.holes (i.e. the current in-progress hole), emit a
    // per-shot sample. This walks the same projectRoundTotal path the
    // live model uses so the chart matches the live card.
    appendShotSamples(
      series,
      bet,
      rsPid,
      round,
      feedEvents,
      probAtP,
      strokes,
      remaining.map((h) => ({ holeNumber: h.holeNumber, par: h.par })),
      holeStats,
      skillPerHole,
    );
  } else if (roundSnap) {
    // No scorecard — degrade to the feed events list. We won't have
    // per-hole field stats so the projection falls back to a par +
    // constant-variance baseline (no skill adjustment).
    //
    // Plot ALL completed holes of the round, not just the ones after
    // placement (per CLAUDE.md "bet detail charts show today's full
    // trajectory, not just from entry"). A user arriving mid-round
    // still gets context for holes 1-6 before their bet went on at
    // hole 7. We zero the running totals so the walk starts from a
    // clean round-state — no placement-snapshot drift.
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
          r.event.playerId === rsPid &&
          r.event.round === round &&
          typeof r.event.strokes === "number" &&
          typeof r.event.par === "number" &&
          typeof r.event.hole === "number",
      )
      .sort((a, b) => a.event.ts - b.event.ts);
    let strokes = 0;
    let parPlayed = 0;
    let holesPlayed = 0;
    const baselineHoles = 0;
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
    // Shot-level tail on the fallback path too — no field stats, but
    // projectRoundTotal + snap fallback still gives us shot-anchored
    // movement on the current hole.
    appendShotSamples(
      series,
      bet,
      rsPid,
      round,
      feedEvents,
      probAtP,
      strokes,
      null,
      null,
      null,
    );
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
      // The live valuation refines the projection of the same last
      // completed hole — refresh that sample in place rather than
      // pushing a new one. Pushing would carry the same
      // `holesPlayed` and the hole-by-hole table would render two
      // rows for that hole (one walk-projection, one fresher live).
      // Keep the original timestamp so the chart's x-axis stays
      // anchored to the hole-completion event.
      series[series.length - 1] = {
        ...last,
        v: nowValue,
        prob: nowProb,
      };
    }
  }
  // Sort by holesPlayed so shot samples fall between their surrounding
  // hole-completion ticks. Without this the chart line would zig-zag
  // when shot samples land in the array chronologically-by-ts (which
  // ordering doesn't guarantee holesPlayed-monotonic).
  series.sort((a, b) => {
    const aH = a.holesPlayed ?? Infinity;
    const bH = b.holesPlayed ?? Infinity;
    return aH - bH;
  });
  return series;
}
