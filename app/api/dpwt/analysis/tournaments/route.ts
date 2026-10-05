/**
 * GET /api/dpwt/analysis/tournaments
 *
 * DP World Tour counterpart of /api/analysis/tournaments: venues
 * onboarded under data/dpwt/historical, plus whichever is this week's
 * event (from _live-tournaments.json round dates).
 */
import { NextResponse } from "next/server";
import { listTournamentConfigs } from "@/lib/scoring-model/tournament-config";
import { getDpwtActive, loadDpwtLiveEntries } from "@/lib/dpwt/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const [configs, active, live] = await Promise.all([
    listTournamentConfigs("dpwt"),
    getDpwtActive(),
    loadDpwtLiveEntries(),
  ]);
  const tournaments = configs
    .map((c) => ({
      slug: c.slug,
      eventName: c.eventName,
      historicalYears: c.historicalYears,
      historicalTournamentIds: c.historicalTournamentIds,
      liveTournamentIdGuess: live[c.slug]?.tournamentId ?? null,
      isLiveNow: active?.slug === c.slug,
    }))
    .sort((a, b) => {
      if (a.isLiveNow !== b.isLiveNow) return a.isLiveNow ? -1 : 1;
      return a.eventName.localeCompare(b.eventName);
    });
  return NextResponse.json({
    ok: true,
    activeTournamentId: active?.tournamentId ?? null,
    activeTournamentName: active ? configs.find((c) => c.slug === active.slug)?.eventName ?? null : null,
    tournaments,
  });
}
