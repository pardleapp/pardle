import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getCachedLeaderboard } from "@/lib/feed/store";
import { pushOddsSamples } from "@/lib/feed/odds-store";
import { getEvent, midOddsFromMarket } from "@/lib/polymarket/client";
import {
  discoverWinnerEvent,
  getCachedWinnerEvent,
} from "@/lib/polymarket/winner-market";

/**
 * GET /api/feed/odds-poll
 *
 * Cron-triggered: read the Polymarket winner event for the active PGA
 * tournament, convert each player's `lastTradePrice` / best-of-book
 * into decimal odds, snapshot the readings into a rolling Redis buffer
 * per player.
 *
 * Polymarket > Betfair for our use case because:
 *   - Public gamma-api with no auth
 *   - No geo-block on data-center IPs (Betfair 403s from Vercel)
 *   - $4M+ volume on major-tournament winner markets — plenty for
 *     directional shift detection
 *
 * Auth: when CRON_SECRET is set, the caller must send
 * `Authorization: Bearer <secret>` (same convention as /api/feed/poll).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Fail closed when the secret isn't configured.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron-disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
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

  // Look up (or re-discover) the Polymarket winner event for this
  // tournament. Re-discovery hits the gamma-api list endpoint once
  // per cache TTL (24h) — every other poll uses the cache.
  let winner = await getCachedWinnerEvent(tournamentId);
  if (!winner) {
    try {
      winner = await discoverWinnerEvent(
        tournamentId,
        active.tournament.name,
        leaderboard,
      );
    } catch (err) {
      console.error("[odds-poll] discoverWinnerEvent failed", err);
      return NextResponse.json(
        {
          error: "polymarket-discover-failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  }
  if (!winner) {
    return NextResponse.json({ skipped: "polymarket-event-not-found" });
  }

  // Pull the latest event payload (child-market prices).
  let event;
  try {
    event = await getEvent(winner.eventId);
  } catch (err) {
    console.error("[odds-poll] getEvent failed", err);
    return NextResponse.json(
      { error: "polymarket-fetch-failed", message: String(err) },
      { status: 502 },
    );
  }

  // Convert market lastTradePrice → decimal odds, keyed by playerId.
  const latest: Record<string, number> = {};
  for (const m of event.markets) {
    const pid = winner.marketToPlayer[m.id];
    if (!pid) continue;
    const odds = midOddsFromMarket(m);
    if (odds == null) continue;
    latest[pid] = odds;
  }

  const now = Date.now();
  const result = await pushOddsSamples(tournamentId, latest, now);

  return NextResponse.json({
    polled: true,
    tournament: tournamentId,
    polymarketEvent: winner.eventId,
    polymarketTitle: winner.eventTitle,
    seenMarkets: event.markets.length,
    mappedPlayers: Object.keys(latest).length,
    bufferUpdated: result.updated,
  });
}
