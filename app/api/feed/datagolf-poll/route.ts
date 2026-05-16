import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getInPlayWinProbs } from "@/lib/golf-api/datagolf";
import { getCachedLeaderboard } from "@/lib/feed/store";
import { pushDgProbSamples } from "@/lib/feed/dg-store";

/**
 * GET /api/feed/datagolf-poll
 *
 * Cron-triggered: hit DataGolf's /preds/in-play, write each player's
 * current model win probability into a rolling Redis buffer keyed on
 * the PGA Tour playerId (name-matched at write time). Used as the
 * outright-bet chart's fallback line when Polymarket is thin for a
 * given player. Typical cadence: every 3 minutes during a live
 * tournament.
 *
 * Auth: when CRON_SECRET is set, the caller must send
 * `Authorization: Bearer <secret>`.
 */
export const dynamic = "force-dynamic";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
  }

  const active = await getActiveTournament().catch(() => null);
  if (!active || !active.isLive) {
    return NextResponse.json({ skipped: "no-live-tournament" });
  }

  const tournamentId = active.tournament.id;
  const leaderboard = await getCachedLeaderboard(tournamentId);
  if (leaderboard.length === 0) {
    return NextResponse.json({ skipped: "no-leaderboard-yet" });
  }

  let probs;
  try {
    probs = await getInPlayWinProbs();
  } catch (err) {
    console.error("[datagolf-poll] fetch failed", err);
    return NextResponse.json(
      {
        error: "datagolf-fetch-failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const lbByName = new Map<string, string>();
  for (const r of leaderboard) {
    lbByName.set(normalizeName(r.displayName), r.playerId);
  }

  const latest: Record<string, number> = {};
  for (const p of probs) {
    const pid = lbByName.get(normalizeName(p.name));
    if (!pid) continue;
    latest[pid] = p.winProb;
  }

  const now = Date.now();
  const result = await pushDgProbSamples(tournamentId, latest, now);

  return NextResponse.json({
    polled: true,
    tournament: tournamentId,
    fetchedRows: probs.length,
    matched: Object.keys(latest).length,
    bufferUpdated: result.updated,
  });
}
