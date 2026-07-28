/**
 * TEMPORARY debug endpoint.
 * GET /api/course-history/debug-normalise?raw=<courseName>
 * Returns { input, output } so we can verify normaliser aliases
 * are live in prod.
 *
 * DELETE ME once the split-personality debug is done.
 */

import { NextResponse } from "next/server";
import { normaliseCourseNameForDebug } from "@/lib/course-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("raw") ?? "";
  return NextResponse.json({
    input: raw,
    output: normaliseCourseNameForDebug(raw),
  });
}
