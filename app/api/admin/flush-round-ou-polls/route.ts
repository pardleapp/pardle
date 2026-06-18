import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { flushRoundOverUnderPolls } from "@/lib/feed/prediction-polls";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/flush-round-ou-polls
 *
 * One-shot admin: closes every currently-open round-over-under
 * prediction poll for the active tournament so the engine reopens
 * them on the next pollAndDiff tick with the latest line formula.
 *
 * Used after a model change (e.g. the field-over-par fix that
 * moved Scheffler's US Open R1 line from 66.5 to 71.5 — bets
 * already opened at 66.5 stay stuck on that line until next
 * round's dedup window without a flush).
 *
 * Votes on the deleted polls are lost. Use sparingly. Idempotent —
 * safe to call multiple times.
 *
 * Auth: same CRON_SECRET bearer the notify-poll cron uses, since
 * this also touches live state.
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron-disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const active = await getActiveTournament().catch(() => null);
  if (!active) {
    return NextResponse.json({ flushed: 0, reason: "no-active-tournament" });
  }
  const flushed = await flushRoundOverUnderPolls(active.tournament.id);
  return NextResponse.json({
    flushed,
    tournament: active.tournament.id,
    name: active.tournament.name,
  });
}
