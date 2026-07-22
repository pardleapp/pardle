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

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const TTL_SECONDS = 6 * 60 * 60;

function cacheKey(tournamentId: string): string {
  // v2 — pgatour.parseCoursePinsPayload now falls back to raw coords
  // when enhanced are absent (unlocks 2023) and replicates roundless
  // pins across R1-R4 (unlocks 2019-2022). Old cached sheets for
  // those years have empty pinByRound; bump the key so a fresh
  // orchestrator pull runs through the new parser.
  return `feed:pins:v2:${tournamentId}`;
}

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
  if (!debug) {
    try {
      const cached = await redis.get<CoursePinSheet>(cacheKey(tournamentId));
      if (cached) {
        return NextResponse.json({ ok: true, cached: true, pins: cached });
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
  try {
    await redis.set(cacheKey(tournamentId), fresh, { ex: TTL_SECONDS });
  } catch {
    /* write-through failure is not fatal */
  }
  return NextResponse.json({ ok: true, cached: false, pins: fresh });
}
