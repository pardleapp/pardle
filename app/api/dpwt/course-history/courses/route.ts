/** GET /api/dpwt/course-history/courses — DP World Tour venues with shot-tracked rounds. */
import { NextResponse } from "next/server";
import { getDpwtCourses } from "@/lib/dpwt/course-history";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, courses: getDpwtCourses() });
}
