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
}

export type TrackedBet = OutrightBet | RoundScoreBet;

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
  const currentPace =
    r.holesPlayed > 0 ? (r.strokes - r.parPlayed) / r.holesPlayed : 0;
  const w = Math.min(1, r.holesPlayed / 9);
  const blendedPace = w * currentPace + (1 - w) * state.ttdPacePerHole;
  const expectedFinal =
    r.strokes + r.parRemaining + r.holesRemaining * blendedPace;
  const sd = Math.sqrt(r.holesRemaining * PER_HOLE_VAR);
  const prob =
    bet.side === "under"
      ? normalCdf(bet.line, expectedFinal, sd)
      : 1 - normalCdf(bet.line, expectedFinal, sd);
  return { kind: "in-progress", round, prob, roundState: r };
}

export function currentValueForBet(
  b: TrackedBet,
  currentOdds: Record<string, number>,
  playerRoundStates: Record<string, PlayerRoundState>,
): number | null {
  if (b.kind === "outright") {
    const fair = currentOdds[b.playerId];
    if (!Number.isFinite(fair) || fair <= 1) return null;
    return b.stake * (b.oddsTaken / fair);
  }
  const ev = evaluateRoundScore(b, playerRoundStates[b.playerId]);
  if (!ev) return null;
  if (ev.kind === "not-started") return b.stake;
  if (ev.kind === "settled") return ev.won ? b.stake * b.oddsTaken : 0;
  if (ev.prob >= 1) return b.stake * b.oddsTaken;
  if (ev.prob <= 0) return 0;
  return b.stake * (b.oddsTaken / (1 / ev.prob));
}

function roundScoreValueAt(
  bet: RoundScoreBet,
  strokes: number,
  parPlayed: number,
  holesPlayed: number,
  parRemaining: number,
  holesRemaining: number,
  ttdPacePerHole: number,
): number {
  if (holesRemaining === 0) {
    const won =
      bet.side === "under" ? strokes < bet.line : strokes > bet.line;
    return won ? bet.stake * bet.oddsTaken : 0;
  }
  const currentPace =
    holesPlayed > 0 ? (strokes - parPlayed) / holesPlayed : 0;
  const w = Math.min(1, holesPlayed / 9);
  const blendedPace = w * currentPace + (1 - w) * ttdPacePerHole;
  const expectedFinal = strokes + parRemaining + holesRemaining * blendedPace;
  const sd = Math.sqrt(holesRemaining * PER_HOLE_VAR);
  const prob =
    bet.side === "under"
      ? normalCdf(bet.line, expectedFinal, sd)
      : 1 - normalCdf(bet.line, expectedFinal, sd);
  if (prob <= 0) return 0;
  if (prob >= 1) return bet.stake * bet.oddsTaken;
  return bet.stake * (bet.oddsTaken / (1 / prob));
}

// ── History reconstruction ──────────────────────────────────────────

export function reconstructHistory(
  bet: TrackedBet,
  oddsHistories: Record<string, OddsHistorySample[] | null>,
  playerRoundStates: Record<string, PlayerRoundState>,
  feedEvents: FeedRowLike[],
  nowValue: number | null,
): PnlSample[] {
  const series: PnlSample[] = [];
  series.push({ t: bet.placedAt, v: bet.stake, holesPlayed: 0 });

  if (bet.kind === "outright") {
    const samples = oddsHistories[bet.playerId] ?? [];
    for (const s of samples) {
      if (s.ts < bet.placedAt) continue;
      if (!Number.isFinite(s.p) || s.p <= 1) continue;
      const v = bet.stake * (bet.oddsTaken / s.p);
      const last = series[series.length - 1];
      if (Math.abs(v - last.v) < 0.05 && s.ts - last.t < 60_000) continue;
      series.push({ t: s.ts, v });
    }
  } else {
    const state = playerRoundStates[bet.playerId];
    const round =
      bet.round != null ? bet.round : state?.currentRound ?? null;
    if (round == null) {
      if (nowValue != null) series.push({ t: Date.now(), v: nowValue });
      return series;
    }
    const roundSnap = state?.rounds?.[round];
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

    if (!roundSnap) {
      if (nowValue != null && Math.abs(nowValue - bet.stake) > 0.01) {
        series.push({ t: Date.now(), v: nowValue });
      }
      return series;
    }

    let strokes = 0;
    let parPlayed = 0;
    let holesPlayed = 0;
    const roundPar = roundSnap.roundPar;
    for (const r of events) {
      strokes += r.event.strokes!;
      parPlayed += r.event.par!;
      holesPlayed++;
      const holesRemaining = 18 - holesPlayed;
      const parRemaining = roundPar - parPlayed;
      const v = roundScoreValueAt(
        bet,
        strokes,
        parPlayed,
        holesPlayed,
        parRemaining,
        holesRemaining,
        state?.ttdPacePerHole ?? 0,
      );
      series.push({ t: r.event.ts, v, holesPlayed });
    }
  }

  if (nowValue != null) {
    const last = series[series.length - 1];
    if (Math.abs(nowValue - last.v) > 0.01) {
      series.push({
        t: Date.now(),
        v: nowValue,
        holesPlayed: last.holesPlayed,
      });
    }
  }
  return series;
}
