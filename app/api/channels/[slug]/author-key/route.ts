import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels/[slug]/author-key
 * Body: { authorKey: string }
 *
 * Records the channel owner's anonymous Pardle authorKey so the
 * channel page can display their Putt-IQ stats as a credibility
 * chip. Idempotent — same authorKey re-posted is a no-op.
 *
 * Authenticated, owner-only. The client calls this once when the
 * owner first lands on their own channel page (and again if the
 * authorKey ever changes — e.g. localStorage clear, new device).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not-signed-in" }, { status: 401 });
  }

  let body: { authorKey?: unknown };
  try {
    body = (await req.json()) as { authorKey?: unknown };
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const authorKey = typeof body.authorKey === "string" ? body.authorKey : "";
  if (!authorKey || authorKey.length < 8 || authorKey.length > 64) {
    return NextResponse.json(
      { error: "bad-author-key" },
      { status: 400 },
    );
  }

  // RLS on channels enforces owner_id = auth.uid() for updates, so
  // any non-owner trying to PATCH another channel's row will get an
  // empty update with no rows touched.
  const { data, error } = await supabase
    .from("channels")
    .update({ owner_author_key: authorKey })
    .eq("slug", slug)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "not-owner-or-missing" },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
