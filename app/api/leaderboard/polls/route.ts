/**
 * GET /api/leaderboard/polls
 *
 * Top putt-prediction callers for the currently active tournament,
 * sorted by correct count with the LEADERBOARD_MIN_POLLS floor
 * applied. The caller's own stats + rank are returned alongside so
 * the page can render a "you" row even when the caller hasn't
 * qualified for the public list.
 *
 * Anonymous: identity is the same authorKey cookie used by the feed.
 */
import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import {
  getTopCallers,
  getUserStats,
  LEADERBOARD_MIN_POLLS,
} from "@/lib/feed/putt-iq";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const authorKey = url.searchParams.get("v") ?? "";
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));

  // Resolve the tournament — leaderboard is per-tournament so the
  // page makes sense even between weeks.
  let tournamentId: string | null = null;
  let tournamentName: string | null = null;
  try {
    const active = await getActiveTournament();
    if (active?.tournament?.id) {
      tournamentId = active.tournament.id;
      tournamentName = active.tournament.name;
    }
  } catch {
    // Continue with null — endpoint still returns a coherent shape.
  }
  if (!tournamentId) {
    return NextResponse.json({
      ok: true,
      tournament: null,
      rows: [],
      me: null,
      minPolls: LEADERBOARD_MIN_POLLS,
    });
  }

  const [rows, me] = await Promise.all([
    getTopCallers(tournamentId, limit),
    authorKey ? getUserStats(authorKey, tournamentId) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    tournament: { id: tournamentId, name: tournamentName },
    rows,
    me,
    minPolls: LEADERBOARD_MIN_POLLS,
  });
}
