/**
 * GET /api/dpwt/hole-putts?tournamentId=...
 *
 * The DP World Tour feed has no putt start/end coordinates on the green,
 * so there are no putt traces. Returns an empty sheet in the PGA shape
 * so the pin tool renders without them.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tournamentId = new URL(req.url).searchParams.get("tournamentId") ?? "";
  return NextResponse.json({
    ok: true,
    cached: false,
    putts: { tournamentId, playersRequested: 0, playerRoundsReturned: 0, greenImageByHole: {}, puttsByHole: {} },
  });
}
