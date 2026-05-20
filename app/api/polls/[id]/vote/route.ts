/**
 * POST /api/polls/[id]/vote
 *
 * Cast or change a vote on a putt prediction poll. Anonymous via the
 * client-supplied `authorKey` (same cookie id used for reactions /
 * comments). One vote per author per poll; flipping yes↔no adjusts
 * both counters.
 *
 * Body: { vote: "yes" | "no", authorKey: string }
 * Response: { ok: true, counts: { yes, no } } on success
 *          { ok: false, error: "..." } on bad input / closed poll
 */
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  getPuttPoll,
  getPuttPollCounts,
  votePuttPoll,
} from "@/lib/feed/putt-polls";

export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();
const VOTE_RATE_SECONDS = 1;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing-id" }, { status: 400 });
  }

  let body: { vote?: string; authorKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }
  const vote = body.vote === "yes" ? "yes" : body.vote === "no" ? "no" : null;
  const authorKey = (body.authorKey ?? "").trim();
  if (!vote || authorKey.length < 8 || authorKey.length > 64) {
    return NextResponse.json(
      { ok: false, error: "bad-input" },
      { status: 400 },
    );
  }

  // Light rate-limit to stop a single client hammering the endpoint —
  // changing your mind is fine, but only once a second.
  const rateOk = await redis.set(
    `feed:puttpoll-rate:${authorKey}`,
    "1",
    { nx: true, ex: VOTE_RATE_SECONDS },
  );
  if (rateOk !== "OK") {
    return NextResponse.json(
      { ok: false, error: "slow-down" },
      { status: 429 },
    );
  }

  const poll = await getPuttPoll(id);
  if (!poll) {
    return NextResponse.json(
      { ok: false, error: "not-found" },
      { status: 404 },
    );
  }
  if (poll.closedAt != null) {
    return NextResponse.json(
      { ok: false, error: "closed", counts: await getPuttPollCounts(id) },
      { status: 409 },
    );
  }

  const counts = await votePuttPoll(id, authorKey, vote);
  // votePuttPoll returns null when the vote is a no-op (same direction
  // already recorded). Surface current counts either way.
  return NextResponse.json({
    ok: true,
    counts: counts ?? (await getPuttPollCounts(id)),
    vote,
  });
}
