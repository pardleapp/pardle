import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { addComment, getComments } from "@/lib/feed/store";
import { COMMENT_MAX_LEN, type FeedComment } from "@/lib/feed/types";

export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();
const COMMENT_RATE_SECONDS = 8;

function newId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clean(s: string, max: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * GET /api/feed/comment?eventId=…  — list comments for an event (oldest first).
 */
export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const comments = await getComments(eventId, 100);
  return NextResponse.json({ ok: true, comments });
}

/**
 * POST /api/feed/comment
 * Body: { eventId, text, authorName, authorKey }
 *
 * No sign-in: authorName is a cookie-stored display name, authorKey a
 * locally-persisted browser id used only for rate-limiting. One comment
 * per author per 8 seconds.
 */
export async function POST(req: Request) {
  let body: {
    eventId?: string;
    text?: string;
    authorName?: string;
    authorKey?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const eventId = body.eventId ?? "";
  const text = clean(body.text ?? "", COMMENT_MAX_LEN);
  const authorName = clean(body.authorName ?? "", 30);
  const authorKey = (body.authorKey ?? "").trim();

  if (
    !eventId ||
    !text ||
    !authorName ||
    authorKey.length < 8 ||
    authorKey.length > 64
  ) {
    return NextResponse.json({ ok: false, error: "bad-input" }, { status: 400 });
  }

  // Rate limit: one comment per author per COMMENT_RATE_SECONDS.
  const rateOk = await redis.set(
    `feed:comment-rate:${authorKey}`,
    "1",
    { nx: true, ex: COMMENT_RATE_SECONDS },
  );
  if (rateOk !== "OK") {
    return NextResponse.json(
      { ok: false, error: "slow-down" },
      { status: 429 },
    );
  }

  const comment: FeedComment = {
    id: newId(),
    eventId,
    ts: Date.now(),
    authorName,
    authorKey,
    text,
  };
  await addComment(comment);

  return NextResponse.json({ ok: true, comment });
}
