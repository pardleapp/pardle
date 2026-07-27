/**
 * GET /api/course-history/courses
 *
 * Returns the searchable list of PGA Tour courses that have hosted a
 * sg-categorised event in the historical window (2019-2025). Each
 * entry carries `hostingEvents` and `totalRounds` so the UI can hint
 * at sample size and show which events actually played there.
 *
 * First cold hit warms the whole Redis cache by fetching per-year
 * baselines for every year in the historical window — that can take
 * ~60 seconds. Every subsequent call is instant.
 */

import { NextResponse } from "next/server";
import { getCuratedCourses } from "@/lib/course-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cold warmup walks ~280 event-year pairs. Most are Redis cache
// hits after our earlier per-event fetches, but the very first hit
// on a brand-new deploy needs headroom to complete without being
// cut off by Vercel's timeout.
export const maxDuration = 300;

export async function GET() {
  try {
    const courses = await getCuratedCourses();
    return NextResponse.json({ ok: true, courses });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "failed to load course list",
      },
      { status: 500 },
    );
  }
}
