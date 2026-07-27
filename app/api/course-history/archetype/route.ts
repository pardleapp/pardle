/**
 * GET /api/course-history/archetype?course=<name>
 *
 * Physical ballstriking archetype of players who out-perform their
 * baseline off-the-tee at the given course. Cross-references the
 * course-history OTT outperformer list with each player's stored
 * driver ball-flight profile (ballSpeed, apex, launch, spin, curve,
 * etc.) and reports the dimensions where the group is materially
 * different from the tour-wide mean.
 *
 * Response is cached in Redis for 6h; cold-cache computation is
 * dominated by the tour-stats warm-up (~5-15s the first time).
 */

import { NextResponse } from "next/server";
import { getCourseArchetype } from "@/lib/course-history/archetype";

export const dynamic = "force-dynamic";
export const revalidate = 0;
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
    const data = await getCourseArchetype(course);
    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "not enough matched-and-profiled outperformers to build an archetype",
        },
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
            : "failed to compute course archetype",
      },
      { status: 500 },
    );
  }
}
