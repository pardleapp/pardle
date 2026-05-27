import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getCachedLeaderboard } from "@/lib/feed/store";

/**
 * GET /api/feed/img-heartbeat
 *
 * Health check for the home daemon that posts IMG Arena shots into
 * /api/feed/img-ingest. The ingest endpoint writes a timestamp every
 * time it accepts a body; we read that timestamp here and decide if
 * the daemon's still alive.
 *
 * Designed to be hit by cron-job.org every 1–2 minutes with "send
 * email on failure" enabled. Returns:
 *
 *   200 + { ok: true, ... }          → daemon alive, or no tournament to worry about
 *   503 + { error: "ingest-stale" }  → tournament is live but no ingest in N minutes
 *
 * The 503 trips cron-job.org's email notification so the operator
 * sees the failure within ~2 min of the daemon going silent.
 *
 * Auth: when CRON_SECRET is set, requires Authorization: Bearer <secret>.
 */
export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();

/** How long without a daemon POST before we call the feed stale.
 *  Sized to be longer than realistic between-group gaps (3–5 min)
 *  but short enough to catch a dead daemon mid-final-round. */
const STALE_MS = 10 * 60 * 1000;

export async function GET(req: Request) {
  // Fail closed when the secret isn't configured.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron-disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const active = await getActiveTournament().catch(() => null);
  if (!active || !active.isLive) {
    // Off-tournament hours — daemon not expected to be running.
    return NextResponse.json({ ok: true, skipped: "no-live-tournament" });
  }

  const tournamentId = active.tournament.id;

  // `isLive` is a coarse flag based on the schedule window (Thu-Sun);
  // it stays true between rounds and during dead hours. Tighten it
  // here by checking the leaderboard for at least one player who's
  // currently on the course. If everyone's finished or cut, we're
  // between rounds or post-tournament — daemon not expected to be
  // posting, no alert.
  const INACTIVE_STATES = new Set([
    "CUT",
    "MC",
    "WD",
    "DQ",
    "DNS",
    "COMPLETE",
    "FINISHED",
  ]);
  const leaderboard = await getCachedLeaderboard(tournamentId).catch(
    () => [],
  );
  const stillPlaying = leaderboard.some((r) => {
    if (INACTIVE_STATES.has(r.playerState)) return false;
    // Active player: blank/empty thru means pre-round (daemon should
    // be running for the upcoming wave); a number 0-17 means mid-round.
    // Only thru="F" or playerState=COMPLETE counts as done.
    return r.thru !== "F" && r.thru !== "—";
  });
  if (leaderboard.length > 0 && !stillPlaying) {
    return NextResponse.json({
      ok: true,
      skipped: "no-active-play",
      tournament: tournamentId,
    });
  }

  const lastTs = await redis.get<number>(
    `feed:img-last-ingest:${tournamentId}`,
  );
  const now = Date.now();
  const ageMs = lastTs ? now - lastTs : null;

  if (lastTs && ageMs !== null && ageMs < STALE_MS) {
    return NextResponse.json({
      ok: true,
      tournament: tournamentId,
      lastIngestAgeSeconds: Math.round(ageMs / 1000),
    });
  }

  // Tournament is live AND we haven't seen an ingest body in too
  // long. Return 503 so cron-job.org's "alert on failure" emails
  // the operator.
  return NextResponse.json(
    {
      error: "ingest-stale",
      tournament: tournamentId,
      lastIngestAgeSeconds: ageMs !== null ? Math.round(ageMs / 1000) : null,
      threshold: STALE_MS / 1000,
      hint:
        "Home daemon is not POSTing. Check Chrome is running with --remote-debugging-port=9222 and the Betfred event page is open with the IMG iframe visible.",
    },
    { status: 503 },
  );
}
