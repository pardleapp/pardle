/**
 * /api/tee-shot-profile?playerId=48081
 *
 * Returns the aggregated driving profile for one player: mean + std
 * across every radar dimension, the mean trajectory polynomial (so
 * the UI can draw a single "average ball flight" arc), a down-sampled
 * shot cloud for the scatter, and the ranked-player index the picker
 * uses.
 *
 * Reads raw records populated by scripts/backfill-tee-shots.mjs from
 * Redis; no orchestrator calls at request time.
 */

import { NextResponse } from "next/server";
import {
  getTeeShots,
  getPlayerName,
  listRankedPlayers,
} from "@/lib/feed/tee-shots-store";
import { buildProfile } from "@/lib/feed/tee-shots-profile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const playerId = url.searchParams.get("playerId");
  // The picker asks for the ranked-player index without a playerId.
  const wantsIndex = !playerId;

  if (wantsIndex) {
    const ranked = await listRankedPlayers(300);
    const withNames = await Promise.all(
      ranked.map(async (r) => ({
        ...r,
        name: (await getPlayerName(r.playerId)) ?? r.playerId,
      })),
    );
    return NextResponse.json({
      ok: true,
      players: withNames,
    });
  }

  const records = await getTeeShots(playerId!);
  if (!records || records.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no records", playerId },
      { status: 404 },
    );
  }
  const name = (await getPlayerName(playerId!)) ?? playerId!;
  const profile = buildProfile(playerId!, name, records);
  return NextResponse.json({ ok: true, profile });
}
