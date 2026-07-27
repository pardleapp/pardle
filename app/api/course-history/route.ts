/**
 * GET /api/course-history?eventId=525
 *
 * Returns per-player aggregated ballstriking stats at the course
 * hosting the given event, across the historical window
 * (2019-2025):
 *   - roundsPlayed / yearsPlayed
 *   - atCourseSgOtt / atCourseSgApp / atCourseCombined
 *   - baselineSgOtt / baselineSgApp / baselineCombined (from DG
 *     current skill ratings)
 *   - outperformanceSgOtt / outperformanceSgApp / outperformanceCombined
 *     (at-course − baseline; the course-fit signal)
 *
 * Default sort: outperformanceCombined descending — top of the list
 * is the best course-fit ballstrikers, not just the best players.
 */

import { NextResponse } from "next/server";
import { getCourseHistory } from "@/lib/course-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cold-cache computation for a course fans out ~40 DataGolf event
// fetches per year × 7 years = up to 280 API calls before we can
// respond. Even at concurrency 20 that can bump against Vercel's
// default 15s serverless timeout, so allow up to 60s here — after
// the first hit everything is served out of Redis.
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const eventIdRaw = url.searchParams.get("eventId");
  if (!eventIdRaw) {
    return NextResponse.json(
      { ok: false, error: "missing eventId query param" },
      { status: 400 },
    );
  }
  const eventId = Number(eventIdRaw);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json(
      { ok: false, error: "invalid eventId" },
      { status: 400 },
    );
  }
  try {
    const data = await getCourseHistory(eventId);
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "no historical data for this event" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "failed to fetch course history",
      },
      { status: 500 },
    );
  }
}
