import { NextResponse } from "next/server";
import { getOrCreateSharpShareToken } from "@/lib/feed/sharp-score";

/**
 * POST /api/sharp/share-token
 *
 * Body: { authorKey: string }
 * Response: { token: string }
 *
 * Given the caller's authorKey (which we never want in a URL), mint
 * (or fetch the existing) opaque public token they can use as the
 * /share/sharp/[token] route's identifier. Idempotent — same author
 * always gets the same token back.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { authorKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const authorKey = (body.authorKey ?? "").trim();
  if (!authorKey || authorKey.length > 200) {
    return NextResponse.json({ error: "bad-author-key" }, { status: 400 });
  }
  const token = await getOrCreateSharpShareToken(authorKey);
  if (!token) {
    return NextResponse.json({ error: "no-token" }, { status: 500 });
  }
  return NextResponse.json({ token });
}
