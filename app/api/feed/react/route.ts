import { NextResponse } from "next/server";
import { react } from "@/lib/feed/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/feed/react
 * Body: { eventId: string, dir: "up" | "down", authorKey: string }
 *
 * authorKey is a client-generated, locally-persisted id — not secure,
 * but reactions are low-stakes and this keeps the feature zero-friction
 * (no sign-in). One reaction per authorKey per event; flipping
 * direction moves the count.
 */
export async function POST(req: Request) {
  let body: { eventId?: string; dir?: string; authorKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { eventId, dir, authorKey } = body;
  if (
    !eventId ||
    !authorKey ||
    authorKey.length < 8 ||
    authorKey.length > 64 ||
    (dir !== "up" && dir !== "down")
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const counts = await react(eventId, authorKey, dir);
  // counts === null means the reaction was a no-op (same dir already).
  return NextResponse.json({ ok: true, counts });
}
