import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { voteOnPredictionPoll } from "@/lib/feed/prediction-polls";

/**
 * POST /api/predictions/vote
 * Body: { pollId, authorKey, optionKey }
 *
 * Cast a vote on an open head-to-head or hold-the-lead poll.
 * Anonymous via authorKey. Per-author rate-limited (4s) to
 * prevent flicker-spam.
 */
export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();
const RATE_SECONDS = 4;
const AUTHOR_KEY_RE = /^[A-Za-z0-9]{8,128}$/;
const POLL_ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const OPTION_KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;

export async function POST(req: Request) {
  let body: { pollId?: string; authorKey?: string; optionKey?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const pollId = body.pollId ?? "";
  const authorKey = body.authorKey ?? "";
  const optionKey = body.optionKey ?? "";
  if (!POLL_ID_RE.test(pollId)) {
    return NextResponse.json({ error: "bad-pollId" }, { status: 400 });
  }
  if (!AUTHOR_KEY_RE.test(authorKey)) {
    return NextResponse.json({ error: "bad-authorKey" }, { status: 400 });
  }
  if (!OPTION_KEY_RE.test(optionKey)) {
    return NextResponse.json({ error: "bad-optionKey" }, { status: 400 });
  }

  const rateOk = await redis.set(
    `pred:vote-rate:${authorKey}`,
    "1",
    { nx: true, ex: RATE_SECONDS },
  );
  if (rateOk !== "OK") {
    return NextResponse.json(
      { error: "slow-down" },
      { status: 429 },
    );
  }

  const counts = await voteOnPredictionPoll(pollId, authorKey, optionKey);
  if (!counts) {
    return NextResponse.json(
      { error: "poll-closed-or-missing" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, counts });
}
