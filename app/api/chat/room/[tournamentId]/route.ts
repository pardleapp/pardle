import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  addChatMessage,
  getChatMessages,
  CHAT_MESSAGE_MAX_LEN,
  type ChatMessage,
} from "@/lib/feed/store";

export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();
const CHAT_RATE_SECONDS = 4;

function newId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clean(s: string, max: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

interface Params {
  params: Promise<{ tournamentId: string }>;
}

/** GET — fetch the most recent messages (oldest first for display). */
export async function GET(_req: Request, { params }: Params) {
  const { tournamentId } = await params;
  if (!tournamentId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const messages = await getChatMessages(tournamentId, 60);
  return NextResponse.json({ ok: true, messages });
}

/**
 * POST — send a message to the tournament room.
 * Body: { text, authorName, authorKey }
 *
 * No sign-in: same anonymous cookie-key pattern the comment thread
 * uses. Rate-limited to one message per 4s per author (chat is
 * quicker than per-event comments, so we allow a tighter cadence).
 */
export async function POST(req: Request, { params }: Params) {
  const { tournamentId } = await params;
  if (!tournamentId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let body: {
    text?: string;
    authorName?: string;
    authorKey?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const text = clean(body.text ?? "", CHAT_MESSAGE_MAX_LEN);
  const authorName = clean(body.authorName ?? "", 30);
  const authorKey = (body.authorKey ?? "").trim();

  if (
    !text ||
    !authorName ||
    authorKey.length < 8 ||
    authorKey.length > 64
  ) {
    return NextResponse.json({ ok: false, error: "bad-input" }, { status: 400 });
  }

  const rateOk = await redis.set(
    `feed:chat-rate:${authorKey}`,
    "1",
    { nx: true, ex: CHAT_RATE_SECONDS },
  );
  if (rateOk !== "OK") {
    return NextResponse.json(
      { ok: false, error: "slow-down" },
      { status: 429 },
    );
  }

  const message: ChatMessage = {
    id: newId(),
    tournamentId,
    ts: Date.now(),
    authorName,
    authorKey,
    text,
  };
  await addChatMessage(message);
  return NextResponse.json({ ok: true, message });
}
