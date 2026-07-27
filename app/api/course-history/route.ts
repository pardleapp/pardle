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
import { getCourseHistoryByCourse } from "@/lib/course-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cold-cache computation for a course fans out DataGolf event fetches
// for the course-index warm-up. After the first hit everything is
// served out of Redis in <200ms.
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const course = url.searchParams.get("course");
  if (!course) {
    return NextResponse.json(
      { ok: false, error: "missing course query param" },
      { status: 400 },
    );
  }
  try {
    const data = await getCourseHistoryByCourse(course);
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "no historical data for this course" },
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
