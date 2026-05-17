import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getCachedLeaderboard } from "@/lib/feed/store";
import {
  getOutrights,
  matchTournamentToSportKey,
} from "@/lib/odds-api/client";
import { pushBookOdds, type BookKey } from "@/lib/feed/book-odds-store";

/**
 * GET /api/feed/odds-api-poll
 *
 * Cron-triggered: pull DraftKings + FanDuel outright winner prices
 * via The Odds API (https://the-odds-api.com) for the active golf
 * tournament. Writes per-player per-book decimal odds into a rolling
 * Redis buffer that the outright bet chart merges alongside the
 * Polymarket buffer.
 *
 * Only majors (PGA Championship, The Open, US Open) are covered —
 * The Odds API doesn't carry regular Tour stops or top-X props. The
 * cron skips with `skipped: "non-major"` outside those weeks.
 *
 * Recommended cadence: every minute during live play. Free tier
 * budget is 500 calls/month so ~12h × 4 days = 2.9K — needs the $30
 * Starter plan once we go live for a full tournament.
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

  if (!process.env.ODDS_API_KEY) {
    return NextResponse.json({ error: "ODDS_API_KEY-missing" }, { status: 500 });
  }

  const active = await getActiveTournament().catch(() => null);
  if (!active || !active.isLive) {
    return NextResponse.json({ skipped: "no-live-tournament" });
  }

  const sportKey = matchTournamentToSportKey(active.tournament.name);
  if (!sportKey) {
    return NextResponse.json({
      skipped: "non-major",
      tournament: active.tournament.name,
    });
  }

  const leaderboard = await getCachedLeaderboard(active.tournament.id);
  if (leaderboard.length === 0) {
    return NextResponse.json({ skipped: "no-leaderboard-yet" });
  }

  let events;
  try {
    events = await getOutrights(sportKey);
  } catch (err) {
    console.error("[odds-api-poll] fetch failed", err);
    return NextResponse.json(
      {
        error: "odds-api-fetch-failed",
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
  for (const ev of events) {
    for (const bm of ev.bookmakers) {
      if (bm.key !== "draftkings" && bm.key !== "fanduel") continue;
      const latest: Record<string, number> = {};
      for (const m of bm.markets) {
        if (m.key !== "outrights") continue;
        for (const o of m.outcomes) {
          const pid = lbByName.get(normalizeName(o.name));
          if (!pid) continue;
          if (!Number.isFinite(o.price) || o.price <= 1) continue;
          latest[pid] = o.price;
        }
      }
      const result = await pushBookOdds(
        active.tournament.id,
        bm.key as BookKey,
        latest,
        now,
      );
      summary[bm.key] = {
        matched: Object.keys(latest).length,
        updated: result.updated,
      };
    }
  }

  return NextResponse.json({
    polled: true,
    sportKey,
    summary,
  });
}
