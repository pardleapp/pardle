import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels/[slug]/unfollow
 *
 * Remove the current user's follower row. Owners can't unfollow
 * their own page (they'd have to delete the channel for that —
 * separate flow we haven't built yet).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not-signed-in" }, { status: 401 });
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id, owner_id")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (channel.owner_id === user.id) {
    return NextResponse.json(
      { error: "owner-cannot-unfollow" },
      { status: 400 },
    );
  }

  const { error: delErr } = await supabase
    .from("channel_followers")
    .delete()
    .eq("channel_id", channel.id)
    .eq("user_id", user.id);
  if (delErr) {
    return NextResponse.json(
      { error: "unfollow-failed", message: delErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
