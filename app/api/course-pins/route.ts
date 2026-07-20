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
import { getCoursePins, type CoursePinSheet } from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const TTL_SECONDS = 6 * 60 * 60;

function cacheKey(tournamentId: string): string {
  return `feed:pins:${tournamentId}`;
}

export async function GET(req: Request) {
  const tournamentId = new URL(req.url).searchParams.get("tournamentId");
  if (!tournamentId) {
    return NextResponse.json(
      { ok: false, error: "tournamentId required" },
      { status: 400 },
    );
  }

  // Cache lookup first — pin data is stable for the day.
  try {
    const cached = await redis.get<CoursePinSheet>(cacheKey(tournamentId));
    if (cached) {
      return NextResponse.json({ ok: true, cached: true, pins: cached });
    }
  } catch {
    /* cache-miss safe to ignore */
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
