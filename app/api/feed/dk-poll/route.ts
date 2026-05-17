import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getCachedLeaderboard } from "@/lib/feed/store";
import { pushDKTopOdds, type TopCutoff } from "@/lib/feed/dk-store";
import { getTopFinishMarkets } from "@/lib/draftkings/client";
import {
  discoverDKEvent,
  getCachedDKEvent,
} from "@/lib/draftkings/event-discovery";

/**
 * GET /api/feed/dk-poll
 *
 * Cron-triggered: pull DraftKings top-5 / top-10 / top-20 markets for
 * the active PGA tournament, snapshot each player's decimal odds into
 * a rolling Redis buffer per (player, cutoff). Used by the
 * top-finish bet's current value + trajectory chart.
 *
 * Recommended cadence: every minute during live play (DK re-prices
 * within seconds of leaderboard moves).
 *
 * Auth: when CRON_SECRET is set, Authorization: Bearer <secret>.
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

  let event = await getCachedDKEvent(tournamentId);
  if (!event) {
    try {
      event = await discoverDKEvent(tournamentId, active.tournament.name);
    } catch (err) {
      console.error("[dk-poll] discoverDKEvent failed", err);
      return NextResponse.json(
        {
          error: "dk-discover-failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  }
  if (!event) {
    return NextResponse.json({ skipped: "dk-event-not-found" });
  }

  let markets;
  try {
    markets = await getTopFinishMarkets(event.eventGroupId);
  } catch (err) {
    console.error("[dk-poll] getTopFinishMarkets failed", err);
    return NextResponse.json(
      {
        error: "dk-fetch-failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const lbByName = new Map<string, string>();
  for (const r of leaderboard) {
    lbByName.set(normalizeName(r.displayName), r.playerId);
  }

  const now = Date.now();
  const summary: Record<string, { matched: number; updated: number }> = {};
  for (const m of markets) {
    const latest: Record<string, number> = {};
    for (const o of m.odds) {
      const pid = lbByName.get(normalizeName(o.playerName));
      if (!pid) continue;
      latest[pid] = o.decimalOdds;
    }
    const result = await pushDKTopOdds(
      tournamentId,
      m.cutoff as TopCutoff,
      latest,
      now,
    );
    summary[`top${m.cutoff}`] = {
      matched: Object.keys(latest).length,
      updated: result.updated,
    };
  }

  return NextResponse.json({
    polled: true,
    tournament: tournamentId,
    dkEventGroupId: event.eventGroupId,
    dkEventName: event.eventGroupName,
    markets: summary,
  });
}
