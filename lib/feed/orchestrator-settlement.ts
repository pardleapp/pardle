/**
 * Historical bet settlement via the PGA Tour orchestrator.
 *
 * This is the PRIMARY post-tournament settlement path. We prefer it
 * over the DataGolf archive because:
 *   1. It has no paid-API dependency — an empty DG env var can
 *      silently break the DG-only path.
 *   2. Its data model is identical to the live path (same
 *      leaderboard shape, same scorecard shape), so a bet that
 *      settles here mirrors what would have settled live.
 *   3. Final leaderboards + scorecards are queryable at any time,
 *      not just within an active-tournament window.
 *
 * DataGolf remains as a fallback in historical-settlement.ts for
 * the rare cases the orchestrator can't reach (extremely old events,
 * malformed tournamentIds, transient outages).
 *
 * Reads are cached in Redis for 30 days per tournamentId — final
 * leaderboards don't change. First settle-call for a finished event
 * pays the orchestrator round-trip; every subsequent one is free.
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import {
  getLeaderboard,
  getScorecards,
  type PGALeaderboardRow,
  type PGAScorecard,
} from "@/lib/golf-api/pgatour";
import type {
  OutrightBet,
  RoundScoreBet,
  TopFinishBet,
  TrackedBet,
  WinningScoreBet,
} from "@/app/live/bet-shared";
import type { HistoricalSettleResult } from "./historical-settlement";

const redis = Redis.fromEnv();

const FINAL_LB_TTL_S = 30 * 24 * 60 * 60;
const FINAL_SC_TTL_S = 30 * 24 * 60 * 60;

function finalLbKey(tournamentId: string) {
  return `settle:orch:lb:${tournamentId}`;
}
function finalScKey(tournamentId: string, playerId: string) {
  return `settle:orch:sc:${tournamentId}:${playerId}`;
}

/** Post-tournament orchestrator playerStates that mean "no round in play". */
const TERMINAL_STATES = new Set([
  "CUT",
  "MC",
  "WD",
  "DQ",
  "DNS",
  "WITHDRAWN",
  "COMPLETE",
  "FINISHED",
]);

/** A leaderboard is "final" when every row is in a terminal state OR
 *  has thru="F"/"-". At least one row must actually have thru="F" of
 *  R4 — protects against the case where every player is at thru="-"
 *  because the leaderboard hasn't loaded yet. */
function leaderboardLooksFinal(rows: PGALeaderboardRow[]): boolean {
  if (rows.length === 0) return false;
  let anyR4Finisher = false;
  for (const r of rows) {
    const stateOk = TERMINAL_STATES.has(r.playerState);
    const thruOk = r.thru === "F" || r.thru === "-" || r.thru === "—";
    if (!stateOk && !thruOk) return false;
    if (r.thru === "F" && r.currentRound === 4) anyR4Finisher = true;
  }
  return anyR4Finisher;
}

async function getFinalLeaderboard(
  tournamentId: string,
): Promise<PGALeaderboardRow[]> {
  const cached = await redis
    .get<PGALeaderboardRow[]>(finalLbKey(tournamentId))
    .catch(() => null);
  if (cached && cached.length > 0) return cached;
  const rows = await getLeaderboard(tournamentId).catch(() => [] as PGALeaderboardRow[]);
  if (leaderboardLooksFinal(rows)) {
    await redis
      .set(finalLbKey(tournamentId), rows, { ex: FINAL_LB_TTL_S })
      .catch(() => {});
  }
  return rows;
}

async function getFinalScorecard(
  tournamentId: string,
  playerId: string,
): Promise<PGAScorecard | null> {
  const cached = await redis
    .get<PGAScorecard>(finalScKey(tournamentId, playerId))
    .catch(() => null);
  if (cached) return cached;
  const scs = await getScorecards(tournamentId, [playerId]).catch(
    () => ({}) as Record<string, PGAScorecard>,
  );
  const sc = scs[playerId] ?? null;
  if (sc && sc.playerState && TERMINAL_STATES.has(sc.playerState)) {
    await redis
      .set(finalScKey(tournamentId, playerId), sc, { ex: FINAL_SC_TTL_S })
      .catch(() => {});
  }
  return sc;
}

/** Parse "T7" / "12" / "CUT" / "WD" / "MC" → numeric position or null. */
function parsePosition(pos: string | null | undefined): number | null {
  if (!pos) return null;
  const m = pos.match(/^T?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Round-1 date heuristic for legacy bets that don't carry an
 *  explicit round or placement snapshot. Same map the DG path uses. */
function inferRoundFromPlacement(placedAt: number): number {
  const d = new Date(placedAt);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  if (dow === 4) return 1;
  if (dow === 5) return 2;
  if (dow === 6) return 3;
  if (dow === 0) return 4;
  return 1;
}

function sumRoundStrokes(
  holes: { score: string }[] | undefined,
): { total: number; complete: boolean } {
  if (!holes || holes.length === 0) return { total: 0, complete: false };
  let total = 0;
  for (const h of holes) {
    const s = Number(h.score);
    // Empty "-" or NaN → not complete
    if (!Number.isFinite(s) || s === 0) return { total: 0, complete: false };
    total += s;
  }
  return { total, complete: true };
}

/**
 * Attempt to settle a bet from the PGA Tour orchestrator's archive.
 *
 * Returns { settled: false } when the orchestrator's data isn't
 * ready yet (leaderboard hasn't landed as final, scorecard missing).
 * The caller then falls back to DataGolf.
 */
export async function settleBetFromOrchestrator(
  bet: TrackedBet,
): Promise<HistoricalSettleResult> {
  const tournamentId = bet.tournamentId;
  if (typeof tournamentId !== "string" || tournamentId.length === 0) {
    return { settled: false, reason: "orch:no-tournament-id" };
  }
  const leaderboard = await getFinalLeaderboard(tournamentId);
  if (leaderboard.length === 0) {
    return { settled: false, reason: "orch:no-leaderboard" };
  }
  if (!leaderboardLooksFinal(leaderboard)) {
    return { settled: false, reason: "orch:not-yet-final" };
  }

  if (bet.kind === "outright") {
    const b = bet as OutrightBet;
    const row = leaderboard.find((r) => r.playerId === b.playerId);
    if (!row) {
      return { settled: true, won: false, reason: "orch:player-not-in-event" };
    }
    const won = row.position === "1" || row.position === "T1";
    return { settled: true, won, reason: "orch:outright" };
  }

  if (bet.kind === "top-finish") {
    const b = bet as TopFinishBet;
    const row = leaderboard.find((r) => r.playerId === b.playerId);
    if (!row) {
      return { settled: true, won: false, reason: "orch:player-not-in-event" };
    }
    const pos = parsePosition(row.position);
    if (pos == null) {
      return { settled: true, won: false, reason: "orch:cut-or-wd" };
    }
    return { settled: true, won: pos <= b.cutoff, reason: "orch:top-finish" };
  }

  if (bet.kind === "winning-score") {
    const b = bet as WinningScoreBet;
    const winners = leaderboard.filter(
      (r) => r.position === "1" || r.position === "T1",
    );
    if (winners.length === 0) {
      return { settled: false, reason: "orch:no-winner-recorded" };
    }
    // Dead-heat: every winner has the same total. Use the first
    // that has a full 4-round scorecard on file.
    for (const w of winners) {
      const sc = await getFinalScorecard(tournamentId, w.playerId);
      if (!sc) continue;
      let total = 0;
      let complete = true;
      for (let r = 1; r <= 4; r++) {
        const summary = sumRoundStrokes(sc.rounds?.[r]);
        if (!summary.complete) {
          complete = false;
          break;
        }
        total += summary.total;
      }
      if (!complete || total === 0) continue;
      const won = b.side === "under" ? total < b.line : total >= b.line;
      return { settled: true, won, reason: "orch:winning-score" };
    }
    return { settled: false, reason: "orch:winner-scorecard-unavailable" };
  }

  if (bet.kind === "round-score") {
    const b = bet as RoundScoreBet;
    const round =
      b.round ?? b.placement?.round ?? inferRoundFromPlacement(b.placedAt);
    const sc = await getFinalScorecard(tournamentId, b.playerId);
    if (!sc) {
      return {
        settled: true,
        won: false,
        reason: "orch:player-scorecard-unavailable",
      };
    }
    const summary = sumRoundStrokes(sc.rounds?.[round]);
    if (!summary.complete) {
      // Player never completed this round — either was cut before it
      // (score row absent) or the archive is still filling. Grade as
      // lost consistent with the DG path — a WD/MC mid-tournament is
      // industry-standard "bet lost" for a round-score line.
      return { settled: true, won: false, reason: "orch:round-not-played" };
    }
    const won = b.side === "under" ? summary.total < b.line : summary.total > b.line;
    return { settled: true, won, reason: "orch:round-score" };
  }

  return { settled: false, reason: "orch:unknown-bet-kind" };
}
