import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { pollAndDiff } from "@/lib/feed/engine";
import { acquirePollLock } from "@/lib/feed/store";

/**
 * GET /api/feed/poll
 *
 * Pollable endpoint that runs the same diff engine as the
 * viewer-triggered path in /api/feed, but with no presence side
 * effects. Use it to keep the feed warm between visitor sessions so
 * the first viewer to land sees an up-to-date stream.
 *
 * Coalesces with viewer-triggered polls via the same Redis lock, so
 * cron + viewer activity never double-poll the orchestrator.
 *
 * How to trigger:
 * - Vercel Pro: add a cron entry in vercel.json at "* * * * *"
 *   (Hobby plan rejects minute-level crons at build time)
 * - Any external scheduler (cron-job.org, GitHub Actions, Upstash
 *   QStash) hitting this URL on the cadence you want
 * - Manually for testing
 *
 * Authorisation: if CRON_SECRET is set, the caller must send
 * `Authorization: Bearer <secret>`. Without the env var set, the
 * endpoint runs for any caller (local/preview convenience).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
  }

  const active = await getActiveTournament().catch(() => null);
  if (!active || !active.isLive) {
    return NextResponse.json({ skipped: "no-live-tournament" });
  }

  const gotLock = await acquirePollLock(active.tournament.id);
  if (!gotLock) {
    return NextResponse.json({ skipped: "coalesced-with-viewer-poll" });
  }

  try {
    const result = await pollAndDiff(active.tournament.id);
    return NextResponse.json({
      polled: true,
      tournament: active.tournament.id,
      newEvents: result.newEvents.length,
      activePlayers: result.activePlayers,
    });
  } catch (err) {
    console.error("[feed/poll] pollAndDiff failed", err);
    return NextResponse.json(
      { error: "poll-failed", message: String(err) },
      { status: 500 },
    );
  }
}
