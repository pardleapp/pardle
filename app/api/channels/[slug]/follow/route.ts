import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels/[slug]/follow
 *
 * Follow a tipster page. For public channels this is a no-arg call.
 * For private channels the body must include { inviteCode }; the
 * server validates it matches the channel's current invite_code
 * before letting the insert through.
 *
 * RLS allows self-insert on channel_followers — the server validates
 * the invite_code precondition since RLS can't read the channel row
 * mid-insert.
 */
interface FollowBody {
  inviteCode?: string;
}

export async function POST(
  req: Request,
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

  let body: FollowBody = {};
  try {
    body = (await req.json()) as FollowBody;
  } catch {
    // Empty body is fine for public channels.
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id, is_public, invite_code")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  if (!channel.is_public) {
    if (!body.inviteCode || body.inviteCode.trim() !== channel.invite_code) {
      return NextResponse.json(
        {
          error: "invite-required",
          reason:
            "This page is invite-only. Ask the tipster for an invite link.",
        },
        { status: 403 },
      );
    }
  }

  const { error: insertErr } = await supabase
    .from("channel_followers")
    .insert({
      channel_id: channel.id,
      user_id: user.id,
      role: "follower",
      notify_on_new_tip: true,
    });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ ok: true, alreadyFollowing: true });
    }
    return NextResponse.json(
      { error: "follow-failed", message: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
