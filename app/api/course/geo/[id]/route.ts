import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * GET /api/course/geo/[id]
 *
 * Streams per-course geometry JSON (extracted from OpenStreetMap
 * via scripts/extract-courses.mjs) to the client when the visitor
 * opens the visual map view of /course. The JSON files are bundled
 * with the deployment under lib/data/courses/{id}.json.
 *
 * Served via an API route (rather than statically imported) so the
 * 100-400 KB of course geometry only lands on devices that
 * actually view the map — visitors who stay on the grid view, or
 * who never touch /course, never pay that bandwidth.
 *
 * Edge-cached for an hour since the data is immutable per
 * extraction run.
 */
export const dynamic = "force-dynamic";
export const revalidate = 3600;

const ID_RE = /^[a-z0-9-]{2,64}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "bad-id" }, { status: 400 });
  }
  try {
    const filePath = path.join(
      process.cwd(),
      "lib",
      "data",
      "courses",
      `${id}.json`,
    );
    const raw = await readFile(filePath, "utf8");
    return new NextResponse(raw, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
