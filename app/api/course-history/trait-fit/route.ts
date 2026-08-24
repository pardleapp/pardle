/**
 * GET /api/course-history/trait-fit?course=East%20Lake%20Golf%20Club
 *
 * What KIND of player a course rewards, as opposed to which specific
 * players have played well here before. Returns the venue's payoff for
 * prior off-the-tee and approach skill against the tour-wide baseline,
 * plus the size of the resulting per-player adjustment so the client
 * can state the effect honestly.
 *
 * See lib/course-history/trait-fit for what the archive actually
 * supports — the short version is that this is a real effect worth
 * about a sixth of a stroke over 72 holes, and the approach half of it
 * is indistinguishable from noise.
 */

import { NextResponse } from "next/server";
import { getCourseTraitFit } from "@/lib/course-history/trait-fit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cold path pools every course in the archive to fit the tour-wide
// reference; warm path is two Redis reads.
export const maxDuration = 300;

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
    const fit = await getCourseTraitFit(course);
    if (!fit) {
      return NextResponse.json(
        { ok: false, error: "not enough history at this course" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, ...fit });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "failed to compute trait fit",
      },
      { status: 500 },
    );
  }
}
