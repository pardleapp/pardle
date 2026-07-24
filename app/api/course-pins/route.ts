/**
 * /api/course-pins?tournamentId=R2026525
 *
 * Returns a per-hole × per-round pin sheet for a tournament, plus the
 * PGA Tour green-diagram image URL for each hole. Powers the pin
 * modal in the course-heatmap analysis page.
 *
 * Cache: 6-hour Redis TTL. Pin positions are set overnight and
 * unchanged during play; a 6-hour cache keeps the orchestrator hit
 * rate low without going stale.
 */

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  getCoursePins,
  getCoursePinsWithDiag,
  type CoursePinSheet,
} from "@/lib/golf-api/pgatour";
import {
  augmentYardsFromHistorical,
  cachedSheetLooksStale,
} from "@/lib/pin-sheet-augment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const TTL_SECONDS = 6 * 60 * 60;

function cacheKey(tournamentId: string): string {
  // v9 — v8 caches were populated by /api/course-pin-birdies going
  // straight to getCoursePins() without the augmentYardsFromHistorical
  // step, so cached entries for pre-2023 events kept the replicated
  // per-round pins that made all four round dots stack on top of each
  // other in the birdie-history modal. Both routes now share the
  // shared augment helper; bump the key so poisoned v8 rows are
  // discarded and a fresh compute reads the JSON-backed pins.
  return `feed:pins:v9:${tournamentId}`;
}

// historicalRefFor, HistFile, cachedSheetLooksStale, and
// augmentYardsFromHistorical moved to lib/pin-sheet-augment.ts so
// /api/course-pin-birdies can apply the same augment step before it
// caches pin sheets — otherwise pre-2023 events kept caching the
// raw replicated pins and both routes' caches drifted apart.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tournamentId = url.searchParams.get("tournamentId");
  const debug = url.searchParams.get("debug") === "1";
  if (!tournamentId) {
    return NextResponse.json(
      { ok: false, error: "tournamentId required" },
      { status: 400 },
    );
  }

  // Cache lookup first — pin data is stable for the day. Skip when
  // ?debug=1 so we can inspect the raw orchestrator response.
  //
  // Defensive: reject a cached sheet whose pinByRound looks
  // "replicated" (all four rounds coincide) IF a historical file
  // that could have supplied real per-round pins exists on disk.
  // That guards against cache poisoning during deploy windows
  // when the code+data land in different commits — a fresh
  // compute against the current bundle takes over automatically.
  if (!debug) {
    try {
      const cached = await redis.get<CoursePinSheet>(cacheKey(tournamentId));
      if (cached) {
        const stale = await cachedSheetLooksStale(cached, tournamentId);
        if (!stale) {
          return NextResponse.json({ ok: true, cached: true, pins: cached });
        }
      }
    } catch {
      /* cache-miss safe to ignore */
    }
  }

  if (debug) {
    // Bypass cache and surface the raw payload so we can debug when
    // parsing returns null. Not part of the normal client flow.
    const result = await getCoursePinsWithDiag(tournamentId);
    return NextResponse.json({
      ok: result.sheet != null,
      pins: result.sheet,
      raw: result.raw,
    });
  }

  let fresh: CoursePinSheet | null;
  try {
    fresh = await getCoursePins(tournamentId);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
  if (!fresh) {
    return NextResponse.json(
      { ok: false, error: "no pin data available" },
      { status: 404 },
    );
  }
  // Fill per-round yardage from data/historical/*.json when the
  // orchestrator returned a roundless-only courseStats (2019-2022).
  // A no-op for years already carrying yardsByRound.
  fresh = await augmentYardsFromHistorical(fresh, tournamentId);
  try {
    await redis.set(cacheKey(tournamentId), fresh, { ex: TTL_SECONDS });
  } catch {
    /* write-through failure is not fatal */
  }
  return NextResponse.json({ ok: true, cached: false, pins: fresh });
}
