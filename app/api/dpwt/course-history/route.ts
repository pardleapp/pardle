/** GET /api/dpwt/course-history?course=... — DP World Tour course fit (SG: OTT + APP vs baseline). */
import { NextResponse } from "next/server";
import { getDpwtCourseHistory } from "@/lib/dpwt/course-history";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const course = new URL(req.url).searchParams.get("course");
  if (!course) return NextResponse.json({ ok: false, error: "missing course query param" }, { status: 400 });
  try {
    const data = await getDpwtCourseHistory(course);
    if (!data) return NextResponse.json({ ok: false, error: "no historical data for this course" }, { status: 404 });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
