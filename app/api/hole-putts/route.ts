/**
 * /api/hole-putts?tournamentId=R2025525
 *
 * Fetches every on-green stroke across the top-N players of the
 * tournament × every round, so the pin-sheet modal can overlay
 * putt paths as an approximation of green contours (we can't
 * afford real StrackaLine data; this is the next best thing).
 *
 * Slow on first fetch — pulls shotDetailsV3 for 60 players × 4
 * rounds = 240 calls, batched 3-wide inside getShotDetailsBatch =
 * ~80 orchestrator round-trips. Redis-cached 6h so the second and
 * every subsequent open is instant.
 */

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  getTournamentPutts,
  type TournamentPuttSheet,
} from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const TTL_SECONDS = 6 * 60 * 60;
const DEFAULT_PLAYER_LIMIT = 60;

// Version tag on the cache key — bump when the shape of the response
// or the derivation of any field changes so stale entries expire
// immediately instead of poisoning the next 6h of reads.
// v4 — v3 fresh computes for 2019-2022 still stored 0 putts
// because the shot-detail parser only read enhancedX/Y which are
// the -1 sentinel on those seasons. Parser now falls back to raw
// x/y; bump so the empty v3 rows get thrown away and a fresh
// compute picks up the (previously ignored) on-green strokes.
const CACHE_VERSION = "v4";
function cacheKey(tournamentId: string, limit: number): string {
  return `feed:putts:${CACHE_VERSION}:${tournamentId}:${limit}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tournamentId = url.searchParams.get("tournamentId");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(10, Math.min(156, Number(limitParam))) : DEFAULT_PLAYER_LIMIT;
  if (!tournamentId) {
    return NextResponse.json(
      { ok: false, error: "tournamentId required" },
      { status: 400 },
    );
  }

  try {
    const cached = await redis.get<TournamentPuttSheet>(
      cacheKey(tournamentId, limit),
    );
    if (cached) {
      return NextResponse.json({ ok: true, cached: true, putts: cached });
    }
  } catch {
    /* cache-miss non-fatal */
  }

  let fresh: TournamentPuttSheet;
  try {
    fresh = await getTournamentPutts(tournamentId, limit);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
  try {
    await redis.set(cacheKey(tournamentId, limit), fresh, { ex: TTL_SECONDS });
  } catch {
    /* write-through failure not fatal */
  }
  return NextResponse.json({ ok: true, cached: false, putts: fresh });
}
