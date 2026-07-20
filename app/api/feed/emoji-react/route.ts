/**
 * POST /api/feed/emoji-react
 * Body: { eventId, emoji, dir: "add" | "remove", visitorId }
 *
 * Server-persisted emoji reactions. Global count per (event, emoji);
 * per-user "mine" tracking is client-side (localStorage) so a viewer
 * can send add/remove deltas without the server keeping identity
 * state. Rate-limited per visitorId to prevent one tab from spamming.
 *
 * Response: { ok, count } — the new count for the requested emoji,
 * for optimistic reconciliation on the client.
 */

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { emojiReactApply } from "@/lib/feed/store";

export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();
const RATE_SECONDS = 1; // one reaction per visitor per second

// Same allow-list as /api/feed/burst so users can only send emojis
// the UI actually offers. Prevents mystery-emoji spam.
const ALLOWED_EMOJI = new Set([
  "🔥",
  "😱",
  "⛳",
  "👏",
  "💀",
  "🐐",
  "😬",
  "🎯",
]);

export async function POST(req: Request) {
  let body: { eventId?: string; emoji?: string; dir?: string; visitorId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-body" }, { status: 400 });
  }

  const eventId = (body.eventId ?? "").trim();
  const emoji = (body.emoji ?? "").trim();
  const dir = body.dir === "remove" ? "remove" : "add";
  const visitorId = (body.visitorId ?? "").trim();

  if (
    !eventId ||
    !ALLOWED_EMOJI.has(emoji) ||
    visitorId.length < 8 ||
    visitorId.length > 64
  ) {
    return NextResponse.json({ ok: false, error: "bad-input" }, { status: 400 });
  }

  const rateOk = await redis.set(
    `feed:emoji-rate:${visitorId}`,
    "1",
    { nx: true, ex: RATE_SECONDS },
  );
  if (rateOk !== "OK") {
    return NextResponse.json({ ok: false, error: "slow-down" }, { status: 429 });
  }

  const count = await emojiReactApply(eventId, emoji, dir);
  return NextResponse.json({ ok: true, count });
}
