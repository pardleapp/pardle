import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getLeaderboard } from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/settle-tournament/[id]?par=280
 *
 * Operator-triggered one-shot to mark all pending bets that belong
 * to a specific concluded tournament as settled. Fixes the case
 * where the active-tournament resolver rolled forward (e.g. past
 * the PGA Championship) before notify-poll's per-tick settlement
 * could run against that tournament's leaderboard.
 *
 * Auth: Bearer CRON_SECRET.
 *
 * Heuristics for "which pending bets belong to this tournament":
 *   - outright + top-finish: bet.playerId appears in the tournament's
 *     leaderboard
 *   - winning-score: placed_at falls within the tournament's window
 *     (no playerId to anchor on; we trust the window). Window is
 *     ~Thu start to start + 7 days.
 *   - round-score: skipped — round-score has its own per-round
 *     settlement path via notify-poll which doesn't need this fix.
 */

interface LeaderboardRow {
  playerId: string;
  displayName: string;
  position: string;
  total: string;
  thru: string;
  playerState: string;
}

function parsePosition(s: string): number | null {
  if (!s) return null;
  const m = s.match(/^T?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
  }

  const { id: tournamentId } = await ctx.params;
  const url = new URL(req.url);
  const par = Number(url.searchParams.get("par") ?? "280");
  // Window for winning-score bet attribution (placed_at must fall
  // within this window for us to settle the bet against this
  // tournament's outcome). Default = 9 days from tournament start
  // (Thu-1 to Fri+1 of the next week).
  const windowDays = Number(url.searchParams.get("windowDays") ?? "9");

  let leaderboard: LeaderboardRow[];
  try {
    leaderboard = (await getLeaderboard(tournamentId)) as LeaderboardRow[];
  } catch (err) {
    return NextResponse.json(
      {
        error: "leaderboard-fetch-failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
  if (leaderboard.length === 0) {
    return NextResponse.json(
      { error: "empty-leaderboard", tournamentId },
      { status: 400 },
    );
  }

  const positionByPid = new Map<string, number | null>();
  for (const row of leaderboard) {
    positionByPid.set(row.playerId, parsePosition(row.position));
  }
  const playerIdsInThisField = new Set(positionByPid.keys());

  const soleLeader = leaderboard.find(
    (r) => r.position === "1" && r.thru === "F",
  );
  if (!soleLeader) {
    return NextResponse.json(
      {
        error: "no-sole-winner-found",
        tournamentId,
        leaderTop: leaderboard.slice(0, 5).map((r) => ({
          name: r.displayName,
          pos: r.position,
          thru: r.thru,
        })),
      },
      { status: 400 },
    );
  }
  const winnerToPar = parseInt(soleLeader.total ?? "0", 10) || 0;
  const winnerStrokes = par + winnerToPar;

  // Tournament window for winning-score attribution.
  const admin = getSupabaseAdmin();
  // Pull the start date so we can window winning-score bets.
  // Heuristic: take the earliest placed_at of an outright bet on a
  // player in this field, fall back to "now minus 21 days".
  const { data: pendingBetsRaw } = await admin
    .from("bets")
    .select("id, user_id, kind, data, placed_at")
    .is("removed_at", null)
    .is("settled_at", null);
  const pending = (pendingBetsRaw ?? []) as Array<{
    id: string;
    user_id: string;
    kind: string;
    data: Record<string, unknown>;
    placed_at: string;
  }>;

  // Best-effort estimate of tournament start: earliest pending bet on a
  // player in this field. Lets the winning-score window auto-anchor.
  let tournamentStart: number | null = null;
  for (const b of pending) {
    const pid = b.data.playerId as string | undefined;
    if (
      pid &&
      playerIdsInThisField.has(pid) &&
      (b.kind === "outright" || b.kind === "top-finish")
    ) {
      const t = new Date(b.placed_at).getTime();
      if (tournamentStart === null || t < tournamentStart)
        tournamentStart = t;
    }
  }

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  let inspected = 0;
  let settled = 0;
  let won = 0;
  const skipped: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of pending) {
    inspected++;
    const bet = row.data;
    let result: { won: boolean } | null = null;

    if (bet.kind === "outright") {
      const pid = bet.playerId as string;
      if (!pid || !playerIdsInThisField.has(pid)) {
        skipped.push(row.id);
        continue;
      }
      result = { won: pid === soleLeader.playerId };
    } else if (bet.kind === "top-finish") {
      const pid = bet.playerId as string;
      const cutoff = bet.cutoff as number;
      if (!pid || !playerIdsInThisField.has(pid)) {
        skipped.push(row.id);
        continue;
      }
      const pos = positionByPid.get(pid);
      result = { won: pos !== null && pos !== undefined && pos <= cutoff };
    } else if (bet.kind === "winning-score") {
      // Anchored to placed_at being within the tournament window.
      if (tournamentStart === null) {
        skipped.push(row.id);
        continue;
      }
      const placedAt = new Date(row.placed_at).getTime();
      if (
        placedAt < tournamentStart - 24 * 60 * 60 * 1000 ||
        placedAt > tournamentStart + windowMs
      ) {
        skipped.push(row.id);
        continue;
      }
      const side = bet.side as string;
      const line = bet.line as number;
      if (typeof line !== "number") {
        skipped.push(row.id);
        continue;
      }
      result =
        side === "under"
          ? { won: winnerStrokes < line }
          : { won: winnerStrokes >= line };
    } else {
      // round-score has its own per-round settlement path; not
      // touched here.
      skipped.push(row.id);
      continue;
    }

    if (result) {
      const { error } = await admin
        .from("bets")
        .update({
          settled_at: new Date().toISOString(),
          settled_won: result.won,
        } as never)
        .eq("id", row.id);
      if (error) {
        errors.push({ id: row.id, error: error.message });
      } else {
        settled++;
        if (result.won) won++;
      }
    }
  }

  return NextResponse.json({
    tournamentId,
    par,
    soleWinner: {
      playerId: soleLeader.playerId,
      name: soleLeader.displayName,
      totalToPar: winnerToPar,
      totalStrokes: winnerStrokes,
    },
    inspectedPending: inspected,
    settled,
    won,
    skipped: skipped.length,
    errors,
  });
}
