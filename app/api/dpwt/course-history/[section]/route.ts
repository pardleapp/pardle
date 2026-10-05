/**
 * GET /api/dpwt/course-history/{trait-fit|archetype|forecast|specialists}
 *
 * These course-history sections are built on launch-monitor tee-shot
 * data the DP World Tour doesn't publish, so they decline with a
 * reason the tool shows in place of the section.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "This section isn't available for DP World Tour courses yet." },
    { status: 200 },
  );
}
