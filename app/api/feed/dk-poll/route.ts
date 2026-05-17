import { NextResponse } from "next/server";

/**
 * GET /api/feed/dk-poll — DISABLED.
 *
 * DraftKings rejects server-side requests from data-centre IPs with
 * Cloudflare bot detection (verified empirically — 403 even on their
 * public golf HTML page, never mind the JSON API). Top-X pricing
 * now comes from our internal Monte Carlo model, computed in
 * /api/feed and surfaced as `topFinishCurrent` / `topFinishHistory`.
 *
 * Route kept as a no-op so any cron-job.org schedules still pointing
 * at it return 200 instead of 404/500. Safe to remove the schedule
 * from cron-job.org at your convenience.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    disabled: true,
    reason: "DK direct scrape blocked; top-X now served by internal model",
  });
}
