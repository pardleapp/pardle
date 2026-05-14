import { NextResponse } from "next/server";
import { castVote } from "@/lib/feed/polls";

export const dynamic = "force-dynamic";

/**
 * POST /api/feed/vote
 * Body: { pollId: string, optionId: string, visitorId: string }
 *
 * One vote per visitor per poll, changeable. No sign-in — visitorId is
 * the same locally-persisted browser id used for reactions.
 */
export async function POST(req: Request) {
  let body: { pollId?: string; optionId?: string; visitorId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { pollId, optionId, visitorId } = body;
  if (
    !pollId ||
    !optionId ||
    !visitorId ||
    visitorId.length < 8 ||
    visitorId.length > 64
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const votes = await castVote(pollId, visitorId, optionId);
  if (votes === null) {
    return NextResponse.json(
      { ok: false, error: "bad-poll-or-option" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, votes });
}
