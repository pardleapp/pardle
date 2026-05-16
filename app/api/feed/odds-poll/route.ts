import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getCachedLeaderboard } from "@/lib/feed/store";
import { pushOddsSamples } from "@/lib/feed/odds-store";
import { listMarketBook, midPrice } from "@/lib/betfair/client";
import { withBetfairAuth } from "@/lib/betfair/session";
import {
  discoverWinnerMarket,
  getCachedWinnerMarket,
} from "@/lib/betfair/winner-market";

/**
 * GET /api/feed/odds-poll
 *
 * Cron-triggered: read the Betfair winner market for the active PGA
 * tournament, convert each runner's best back/lay into a mid-price,
 * snapshot the readings into a rolling Redis buffer per player.
 *
 * Coalesces gracefully with `/api/feed/poll`: each route owns its own
 * data source and there's no lock contention between them — feed
 * polling and odds polling can run on separate cron schedules.
 *
 * Auth: when CRON_SECRET is set, the caller must send
 * `Authorization: Bearer <secret>` (same convention as /api/feed/poll).
 */
export const dynamic = "force-dynamic";

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

  // Need the cached leaderboard to map Betfair runners → playerIds.
  const leaderboard = await getCachedLeaderboard(tournamentId);
  if (leaderboard.length === 0) {
    return NextResponse.json({ skipped: "no-leaderboard-yet" });
  }

  // Look up (or re-discover) the Betfair winner market for this event.
  let market = await getCachedWinnerMarket(tournamentId);
  if (!market) {
    try {
      market = await discoverWinnerMarket(
        tournamentId,
        active.tournament.name,
        leaderboard,
      );
    } catch (err) {
      console.error("[odds-poll] discoverWinnerMarket failed", err);
      return NextResponse.json(
        {
          error: "betfair-discover-failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  }
  if (!market) {
    return NextResponse.json({ skipped: "betfair-market-not-found" });
  }

  // Pull the live market book.
  let books;
  try {
    books = await withBetfairAuth((auth) =>
      listMarketBook(auth, [market!.marketId]),
    );
  } catch (err) {
    console.error("[odds-poll] listMarketBook failed", err);
    return NextResponse.json(
      { error: "betfair-fetch-failed", message: String(err) },
      { status: 502 },
    );
  }
  const book = books[0];
  if (!book) {
    return NextResponse.json({ skipped: "empty-market-book" });
  }

  // Convert runner mid-prices into a playerId-keyed map.
  const latest: Record<string, number> = {};
  for (const runner of book.runners) {
    const pid = market.runnerToPlayer[String(runner.selectionId)];
    if (!pid) continue;
    const mid = midPrice(runner);
    if (mid == null) continue;
    latest[pid] = mid;
  }

  const now = Date.now();
  const result = await pushOddsSamples(tournamentId, latest, now);

  return NextResponse.json({
    polled: true,
    tournament: tournamentId,
    betfairMarket: market.marketId,
    seenRunners: book.runners.length,
    mappedPlayers: Object.keys(latest).length,
    bufferUpdated: result.updated,
  });
}
