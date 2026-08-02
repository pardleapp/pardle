/**
 * GET /api/analysis/tournaments
 *
 * Lists every tournament we've onboarded to the analysis pages —
 * derived from data/historical/{slug}-{year}.json plus the
 * currently-live event from the PGA Tour orchestrator. Powers the
 * tournament switcher on /analysis/tee-time-scoring so bettors can
 * cross-compare years/venues without hunting through the file
 * system.
 */

import { NextResponse } from "next/server";
import { listTournamentConfigs } from "@/lib/scoring-model/tournament-config";
import { getActiveTournament } from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const configs = await listTournamentConfigs();
  const active = await getActiveTournament().catch(() => null);
  const activeTournamentId = active?.tournament?.id ?? null;

  const tournaments = configs
    .map((c) => ({
      slug: c.slug,
      eventName: c.eventName,
      historicalYears: c.historicalYears,
      historicalTournamentIds: c.historicalTournamentIds,
      /** The tournament id we'd expect for the current calendar year
       *  at this venue (auto-derived from the last known suffix). */
      liveTournamentIdGuess:
        c.tournamentIdSuffix && c.historicalYears.length > 0
          ? `R${c.historicalYears[c.historicalYears.length - 1] + 1}${c.tournamentIdSuffix}`
          : null,
      /** True when the currently-active tour event's id maps to this
       *  slug. The UI can badge this as "Live". */
      isLiveNow:
        activeTournamentId != null &&
        (Object.values(c.historicalTournamentIds).includes(activeTournamentId) ||
          (c.tournamentIdSuffix &&
            activeTournamentId ===
              `R${new Date().getUTCFullYear()}${c.tournamentIdSuffix}`)),
    }))
    // Live entries first; then alphabetical by event name.
    .sort((a, b) => {
      if (a.isLiveNow !== b.isLiveNow) return a.isLiveNow ? -1 : 1;
      return a.eventName.localeCompare(b.eventName);
    });

  return NextResponse.json({
    ok: true,
    activeTournamentId,
    activeTournamentName: active?.tournament?.name ?? null,
    tournaments,
  });
}
