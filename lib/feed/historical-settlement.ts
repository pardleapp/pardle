/**
 * Historical bet settlement — given a bet whose tournament has
 * finished (i.e. it's no longer the active event), resolve its
 * outcome from the historical-rounds archive and return the
 * { settled, won } verdict.
 *
 * Mirrors the live-detector branches in bet-shared.ts but reads
 * from completed-tournament data rather than the live leaderboard:
 *
 *   round-score    bet.round's score for the bet's player vs line
 *   outright       fin_text === "1" or "T1" (dead-heat = co-winners)
 *   top-finish     numeric fin_text ≤ bet.cutoff
 *   winning-score  winner's total strokes vs line
 *
 * Server-only — pulls from the historical-rounds Redis cache (30d
 * TTL) which in turn proxies the DataGolf paid archive endpoint.
 * Reads through resolveEventId (orchestrator tournament name → DG
 * event id by normalised-name match against the cached event list).
 */

import "server-only";
import {
  getCachedHistoricalRounds,
  resolveEventId,
} from "./historical-cache";
import type {
  DGHistoricalRound,
  DGHistoricalScoreRow,
} from "@/lib/golf-api/datagolf";
import type {
  OutrightBet,
  RoundScoreBet,
  TopFinishBet,
  TrackedBet,
  WinningScoreBet,
} from "@/app/live/bet-shared";

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** "Last, First" → "First Last" (DG stores names lastName-first). */
function flipName(s: string): string {
  const i = s.indexOf(",");
  if (i < 0) return s.trim();
  return `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`;
}

/** Locate a player by name in a historical event payload. */
function findPlayer(
  rows: DGHistoricalScoreRow[],
  playerName: string,
): DGHistoricalScoreRow | null {
  const target = normaliseName(playerName);
  return (
    rows.find((r) => normaliseName(flipName(r.player_name)) === target) ?? null
  );
}

/** Parse "T7" / "12" / "CUT" / "WD" / "MC" → numeric position or null. */
function parseFinish(finText: string | null | undefined): number | null {
  if (!finText) return null;
  const m = finText.match(/^T?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Sum strokes across rounds the player completed. */
function totalStrokes(player: DGHistoricalScoreRow): number {
  let total = 0;
  for (const r of [
    player.round_1,
    player.round_2,
    player.round_3,
    player.round_4,
  ] as Array<DGHistoricalRound | undefined>) {
    if (r && typeof r.score === "number") total += r.score;
  }
  return total;
}

/** All players with fin_text "1" or "T1" — covers ties (dead-heat). */
function findWinners(rows: DGHistoricalScoreRow[]): DGHistoricalScoreRow[] {
  return rows.filter((r) => {
    const ft = r.fin_text?.trim();
    return ft === "1" || ft === "T1";
  });
}

export interface HistoricalSettleResult {
  settled: boolean;
  won?: boolean;
  reason?: string;
}

/**
 * Auto-settle a bet from the historical archive. Returns
 * { settled: false } when the data isn't available (DG hasn't
 * archived the event yet, or the player isn't on file). Callers
 * leave such bets in their current state — the next cron tick
 * retries.
 */
export async function settleBetFromHistory(
  bet: TrackedBet,
): Promise<HistoricalSettleResult> {
  // 1. Resolve the bet's tournament → DG event_id via the
  //    tournamentName stamped at placement. Year is the year the
  //    bet was placed (UTC) — covers the realistic case; long-
  //    futures bets across year boundaries are rare for a 4-round
  //    weekly market.
  const tournamentName = bet.tournamentName;
  if (!tournamentName) {
    return { settled: false, reason: "no-tournament-name" };
  }
  const year = new Date(bet.placedAt).getUTCFullYear();
  const resolved = await resolveEventId(tournamentName, year);
  if (!resolved) {
    return { settled: false, reason: "event-not-in-dg-archive" };
  }
  const payload = await getCachedHistoricalRounds(
    resolved.eventId,
    resolved.year,
  );
  if (!payload || !Array.isArray(payload.scores)) {
    return { settled: false, reason: "rounds-unavailable" };
  }
  const rows = payload.scores;

  // 2. Branch on bet kind — each path mirrors the live detector.
  if (bet.kind === "round-score") {
    const rs = bet as RoundScoreBet;
    // Resolve the target round. Preference order:
    //   1. bet.round (explicitly locked at placement)
    //   2. bet.placement.round (lock captured on the placement snap)
    //   3. infer from placedAt: tournaments tee off Thursday, so the
    //      day-of-week of placement maps to a round (Thu→1, Fri→2,
    //      Sat→3, Sun→4); evening placements before a tee-off bake
    //      into the next round.
    let round = rs.round ?? rs.placement?.round ?? null;
    if (round == null) {
      const d = new Date(rs.placedAt);
      const dow = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
      // Wed evening / Thu / Fri / Sat / Sun → R1 / R1 / R2 / R3 / R4
      if (dow === 4) round = 1;
      else if (dow === 5) round = 2;
      else if (dow === 6) round = 3;
      else if (dow === 0) round = 4;
      else round = 1; // Mon-Wed placements bet into the upcoming R1
    }
    const player = findPlayer(rows, rs.playerName);
    if (!player) {
      // Player not in the event = missed the field (WD'd / didn't
      // tee off / wrong tour). Bet effectively lost.
      return { settled: true, won: false, reason: "player-not-in-event" };
    }
    const rd = (player as unknown as Record<string, DGHistoricalRound | undefined>)[
      `round_${round}`
    ];
    if (!rd || typeof rd.score !== "number") {
      // Player didn't complete the round (cut/withdrew before it).
      // Industry standard: bet voids / loses. Treat as "lost" here
      // — the tracker is informational; users can manually correct
      // a void if their book actually graded otherwise.
      return { settled: true, won: false, reason: "round-not-played" };
    }
    const score = rd.score;
    const won = rs.side === "under" ? score < rs.line : score > rs.line;
    return { settled: true, won };
  }

  if (bet.kind === "outright") {
    const ob = bet as OutrightBet;
    const winners = findWinners(rows);
    if (winners.length === 0) {
      // Tournament finished without a "1" / "T1" position recorded
      // — extremely rare (canceled tournament). Leave unsettled.
      return { settled: false, reason: "no-winner-recorded" };
    }
    const targetNorm = normaliseName(ob.playerName);
    const won = winners.some(
      (w) => normaliseName(flipName(w.player_name)) === targetNorm,
    );
    return { settled: true, won };
  }

  if (bet.kind === "top-finish") {
    const tf = bet as TopFinishBet;
    const player = findPlayer(rows, tf.playerName);
    if (!player) {
      // Player not on file = missed cut at the very least → lost.
      return { settled: true, won: false, reason: "player-not-in-event" };
    }
    const pos = parseFinish(player.fin_text);
    if (pos == null) return { settled: true, won: false, reason: "cut-or-wd" };
    return { settled: true, won: pos <= tf.cutoff };
  }

  if (bet.kind === "winning-score") {
    const ws = bet as WinningScoreBet;
    const winners = findWinners(rows);
    if (winners.length === 0) {
      return { settled: false, reason: "no-winner-recorded" };
    }
    // Dead-heat: every winner has the same total. Pick the first.
    const total = totalStrokes(winners[0]);
    if (total === 0) {
      return { settled: false, reason: "winner-rounds-incomplete" };
    }
    const won = ws.side === "under" ? total < ws.line : total >= ws.line;
    return { settled: true, won };
  }

  return { settled: false, reason: "unknown-bet-kind" };
}
