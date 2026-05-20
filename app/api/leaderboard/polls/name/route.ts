/**
 * POST /api/leaderboard/polls/name
 *
 * Set the display name shown on the putt-call leaderboard. Anonymous,
 * keyed by the same cookie authorKey used for voting. Per-tournament
 * — a fresh tournament starts with a blank slate so a name set
 * during Charles Schwab doesn't bleed into Memorial.
 *
 * Body: { authorKey: string, name: string }
 */
import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { setUserName } from "@/lib/feed/putt-iq";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { authorKey?: string; name?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }
  const authorKey = (body.authorKey ?? "").trim();
  const name = (body.name ?? "").trim().slice(0, 30);
  if (!authorKey || authorKey.length < 8 || !name) {
    return NextResponse.json(
      { ok: false, error: "bad-input" },
      { status: 400 },
    );
  }

  const active = await getActiveTournament().catch(() => null);
  if (!active?.tournament?.id) {
    return NextResponse.json(
      { ok: false, error: "no-tournament" },
      { status: 503 },
    );
  }
  await setUserName(active.tournament.id, authorKey, name);
  return NextResponse.json({ ok: true });
}
