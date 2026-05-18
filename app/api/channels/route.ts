import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { validateSlug } from "@/lib/channels/reserved-slugs";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels — create a tipster page.
 *
 * Body: { slug, name, bio?, isPublic? }
 *
 * Returns the created row plus the invite code (so the owner can
 * share the join link immediately). The caller becomes the owner
 * automatically and is added to channel_followers with role='owner'.
 */
interface CreateBody {
  slug?: string;
  name?: string;
  bio?: string;
  isPublic?: boolean;
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not-signed-in" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const slug = (body.slug ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim();
  if (!name || name.length > 60) {
    return NextResponse.json(
      { error: "bad-name", reason: "Name must be 1–60 characters" },
      { status: 400 },
    );
  }
  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) {
    return NextResponse.json(
      { error: "bad-slug", reason: slugCheck.reason },
      { status: 400 },
    );
  }

  // Insert the channel. RLS enforces owner_id = auth.uid() via the
  // "channels: owner inserts own" policy.
  const { data: created, error: insertErr } = await supabase
    .from("channels")
    .insert({
      slug,
      name,
      owner_id: user.id,
      bio: body.bio?.trim() ? body.bio.trim() : null,
      is_public: !!body.isPublic,
    })
    .select("id, slug, name, owner_id, bio, is_public, invite_code, created_at")
    .single();
  if (insertErr || !created) {
    if (insertErr?.code === "23505") {
      return NextResponse.json(
        { error: "slug-taken", reason: "That handle is already taken" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "insert-failed", message: insertErr?.message },
      { status: 500 },
    );
  }

  // Auto-add owner to the followers table so RLS reads behave
  // consistently (the membership helper is_channel_follower returns
  // true for them everywhere).
  const { error: followerErr } = await supabase
    .from("channel_followers")
    .insert({
      channel_id: created.id,
      user_id: user.id,
      role: "owner",
      notify_on_new_tip: false, // owner sees their own posts; don't push
    });
  if (followerErr) {
    // Best-effort cleanup. If this fails we're in a weird state but
    // the channel exists; surface the error rather than silently
    // succeed.
    return NextResponse.json(
      { error: "owner-follower-insert-failed", message: followerErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    channel: {
      id: created.id,
      slug: created.slug,
      name: created.name,
      ownerId: created.owner_id,
      bio: created.bio,
      isPublic: created.is_public,
      inviteCode: created.invite_code,
      createdAt: created.created_at,
    },
  });
}
