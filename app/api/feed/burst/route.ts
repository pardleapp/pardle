import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { pushBurst } from "@/lib/feed/store";

export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();

/** The only emojis the burst bar offers — keep it tight + on-brand. */
const ALLOWED_EMOJI = new Set(["🔥", "😱", "⛳", "👏", "💀", "🐐"]);
const BURST_RATE_SECONDS = 2; // one burst per visitor per 2s

/**
 * POST /api/feed/burst
 * Body: { emoji: string, visitorId: string }
 *
 * Records an ephemeral "burst" — a floating emoji every watcher sees.
 * Rate-limited per visitor so a single tapper can't spam the screen.
 */
export async function POST(req: Request) {
  let body: { emoji?: string; visitorId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const emoji = body.emoji ?? "";
  const visitorId = (body.visitorId ?? "").trim();
  if (!ALLOWED_EMOJI.has(emoji) || visitorId.length < 8) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Rate limit per visitor.
  const rateOk = await redis.set(
    `feed:burst-rate:${visitorId}`,
    "1",
    { nx: true, ex: BURST_RATE_SECONDS },
  );
  if (rateOk !== "OK") {
    return NextResponse.json({ ok: false, error: "slow-down" }, { status: 429 });
  }

  const active = await getActiveTournament();
  if (!active) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const burst = await pushBurst(active.tournament.id, emoji);
  return NextResponse.json({ ok: true, burst });
}
