import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  getLeaderboard,
  getScorecards,
  getSchedule,
} from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";

/**
 * GET /api/bets/[id]/replay
 *
 * Reconstructs a hole-by-hole "what happened" chart for a settled
 * bet from a past tournament. Used by BetChartFull when the bet is
 * settled but the live Polymarket-odds buffer has aged out of Redis,
 * which is the common state for anything more than a few days old.
 *
 * Strategy:
 *   1. Look up the bet (RLS gates to the owner)
 *   2. Infer which tournament it belonged to by matching the bet's
 *      placed_at against the schedule's completed list (window of
 *      start..start+5days)
 *   3. Fetch the relevant scorecards via the PGA orchestrator (which
 *      serves historical data indefinitely, unlike our Redis buffer)
 *   4. Convert hole strokes into a running "to par" series, with
 *      round boundaries marked so the chart can render dashed
 *      separators
 *
 * Returns the relevant player(s):
 *   - outright + top-finish + round-score: the bet's playerId
 *   - winning-score: the actual winner (sole position-1 finisher)
 */

interface ReplayPlayerSeries {
  playerId: string;
  playerName: string;
  /** Per-hole running to-par. holeIndex 0..71 covers all 4 rounds. */
  points: Array<{ holeIndex: number; round: number; toPar: number }>;
  finalToPar: number;
  finalPosition: string | null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await getSupabaseServer();
  const { data: betRow, error } = await supabase
    .from("bets")
    .select("id, kind, data, placed_at, settled_at, settled_won")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: "fetch-failed", message: error.message },
      { status: 500 },
    );
  }
  if (!betRow) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const bet = betRow.data as Record<string, unknown>;
  const placedAt = new Date(betRow.placed_at as string).getTime();
  if (!betRow.settled_at) {
    // No replay needed — the live chart still has data.
    return NextResponse.json({ error: "bet-not-settled" }, { status: 400 });
  }

  // Match placed_at against the schedule.
  const { upcoming, completed } = await getSchedule();
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
  const all = [...completed, ...upcoming];
  const tournament =
    all.find(
      (t) =>
        placedAt >= t.startDate - 24 * 60 * 60 * 1000 &&
        placedAt <= t.startDate + FIVE_DAYS,
    ) ?? null;
  if (!tournament) {
    return NextResponse.json(
      { error: "tournament-not-resolvable" },
      { status: 404 },
    );
  }

  const leaderboard = await getLeaderboard(tournament.id);
  const lbByPid = new Map(leaderboard.map((r) => [r.playerId, r]));

  // Figure out which player(s) we're plotting.
  const targets: string[] = [];
  if (bet.kind === "outright" || bet.kind === "top-finish" || bet.kind === "round-score") {
    const pid = bet.playerId as string | undefined;
    if (pid) targets.push(pid);
  } else if (bet.kind === "winning-score") {
    const winner = leaderboard.find(
      (r) => r.position === "1" && r.thru === "F",
    );
    if (winner) targets.push(winner.playerId);
  }
  if (targets.length === 0) {
    return NextResponse.json(
      { error: "no-player-to-plot" },
      { status: 400 },
    );
  }

  const scorecards = await getScorecards(tournament.id, targets);

  const series: ReplayPlayerSeries[] = [];
  for (const pid of targets) {
    const sc = scorecards[pid];
    if (!sc) continue;
    const lbRow = lbByPid.get(pid);
    const points: ReplayPlayerSeries["points"] = [];
    let runningToPar = 0;
    let holeIndex = 0;
    for (let r = 1; r <= 4; r++) {
      const holes = sc.rounds[r];
      if (!holes || holes.length === 0) continue;
      for (const h of holes) {
        const strokes = Number(h.score);
        if (!Number.isFinite(strokes) || strokes <= 0) {
          holeIndex++;
          continue;
        }
        runningToPar += strokes - h.par;
        points.push({ holeIndex, round: r, toPar: runningToPar });
        holeIndex++;
      }
    }
    series.push({
      playerId: pid,
      playerName: lbRow?.displayName ?? pid,
      points,
      finalToPar: runningToPar,
      finalPosition: lbRow?.position ?? null,
    });
  }

  return NextResponse.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      startDate: tournament.startDate,
    },
    bet: {
      id: betRow.id as string,
      kind: betRow.kind as string,
      settledWon: betRow.settled_won as boolean,
      stake: bet.stake as number,
      oddsTaken: bet.oddsTaken as number,
      line: (bet.line as number) ?? null,
      side: (bet.side as string) ?? null,
      cutoff: (bet.cutoff as number) ?? null,
      round: (bet.round as number | null) ?? null,
    },
    series,
  });
}
