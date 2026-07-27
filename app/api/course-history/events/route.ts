/**
 * GET /api/course-history/events
 *
 * Returns the curated list of PGA Tour recurring events (deduped by
 * event_id, filtered to those DataGolf carries SG-by-category on)
 * that the client's course-picker consumes.
 */

import { NextResponse } from "next/server";
import { getCuratedEvents } from "@/lib/course-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const events = await getCuratedEvents();
    return NextResponse.json({ ok: true, events });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "failed to load event list",
      },
      { status: 500 },
    );
  }
}
