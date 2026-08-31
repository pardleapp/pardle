/**
 * GET /api/sharpsports/bets
 *
 * Returns the current user's canonical bet slips from our store.
 *
 * Query params:
 *   - account: bettorAccount id ("BACT_xxx"). Required for now until
 *     we wire pardle-side user auth to their SharpSports link.
 *   - tournament: PGA orchestrator tournamentId. Optional filter.
 *   - player: DataGolf dg_id. Optional filter.
 *   - limit: page size (default 50, max 100)
 *   - cursor: unix-ms score cursor for "next page" (from a previous
 *     response's `nextCursor`).
 *
 * The response contains only the canonical Pardle shape — no raw
 * SharpSports payload leaks to the client.
 */

import { NextResponse } from "next/server";
import {
  getSlipsByAccount,
  getSlipsByPlayer,
  getSlipsByTournament,
} from "@/lib/sharpsports/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  const tournament = url.searchParams.get("tournament");
  const player = url.searchParams.get("player");
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const cursorParam = url.searchParams.get("cursor");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitParam) ? limitParam : 50));
  const cursor = cursorParam ? Number(cursorParam) : undefined;

  try {
    let slips;
    // Prefer the tightest filter; combined filters would need
    // intersection which we can add if it becomes a real use case.
    if (tournament) {
      slips = await getSlipsByTournament(tournament, { limit, cursor });
    } else if (player) {
      const dgId = Number(player);
      if (!Number.isFinite(dgId)) {
        return NextResponse.json(
          { ok: false, error: "player must be a dg_id number" },
          { status: 400 },
        );
      }
      slips = await getSlipsByPlayer(dgId, { limit, cursor });
    } else if (account) {
      slips = await getSlipsByAccount(account, { limit, cursor });
    } else {
      return NextResponse.json(
        { ok: false, error: "one of account, tournament, or player is required" },
        { status: 400 },
      );
    }

    // Next-page cursor = oldest placedAt in this page, minus 1 ms.
    const nextCursor =
      slips.length === limit && slips[slips.length - 1]?.placedAt
        ? Date.parse(slips[slips.length - 1].placedAt) - 1
        : null;

    return NextResponse.json({
      ok: true,
      slips,
      nextCursor,
    });
  } catch (err) {
    console.error("[sharpsports:bets] fetch failed:", err);
    return NextResponse.json(
      { ok: false, error: "internal" },
      { status: 500 },
    );
  }
}
