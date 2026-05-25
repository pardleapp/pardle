import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getUserStats } from "@/lib/feed/putt-iq";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/[slug] — fetch a tipster page's metadata.
 *
 * RLS controls who can read the channel row:
 *   - public channels: visible to everyone
 *   - private channels: visible only to owner + followers
 *
 * Returns the channel, follower count, and the viewer's membership
 * status. invite_code only included when the viewer is the owner.
 *
 * PATCH /api/channels/[slug] — owner updates name/bio/is_public, or
 * regenerates invite_code (?regenerate=1).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: channel, error } = await supabase
    .from("channels")
    .select(
      "id, slug, name, owner_id, bio, is_public, invite_code, owner_author_key, created_at",
    )
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: "fetch-failed", message: error.message },
      { status: 500 },
    );
  }
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  // Follower count — count(*) under RLS would be gated by the
  // followers-read policy. Either anyone can count or only members.
  // Public count is fine to show on a landing page, so do it via
  // the head:true count which returns just the row count.
  const { count: followerCount } = await supabase
    .from("channel_followers")
    .select("user_id", { count: "exact", head: true })
    .eq("channel_id", channel.id);

  let viewer: {
    isOwner: boolean;
    isFollower: boolean;
    notifyOnNewTip: boolean;
  } | null = null;
  if (user) {
    const isOwner = user.id === channel.owner_id;
    const { data: f } = await supabase
      .from("channel_followers")
      .select("notify_on_new_tip")
      .eq("channel_id", channel.id)
      .eq("user_id", user.id)
      .maybeSingle();
    viewer = {
      isOwner,
      isFollower: !!f,
      notifyOnNewTip: f?.notify_on_new_tip ?? false,
    };
  }

  // Hide invite code from non-owners.
  const showInviteCode = viewer?.isOwner === true;

  // Putt-IQ credibility chip: owner's accuracy/streak as a public-
  // facing trust signal. Only fires once the owner has cast at least
  // one putt-poll vote AND has linked their cookie via the
  // author-key endpoint. Falls back silently when either is missing.
  let ownerPuttIq: {
    total: number;
    correct: number;
    accuracy: number;
    currentStreak: number;
    tournamentRank: number | null;
    tournamentTotal: number;
    tournamentCorrect: number;
  } | null = null;
  const ownerAuthorKey = (channel as { owner_author_key?: string | null })
    .owner_author_key;
  if (ownerAuthorKey) {
    const active = await getActiveTournament().catch(() => null);
    const stats = await getUserStats(
      ownerAuthorKey,
      active?.tournament.id,
    ).catch(() => null);
    if (stats && stats.total > 0) {
      ownerPuttIq = {
        total: stats.total,
        correct: stats.correct,
        accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
        currentStreak: stats.currentStreak,
        tournamentRank: stats.tournamentRank ?? null,
        tournamentTotal: stats.tournament?.total ?? 0,
        tournamentCorrect: stats.tournament?.correct ?? 0,
      };
    }
  }

  return NextResponse.json({
    channel: {
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      ownerId: channel.owner_id,
      bio: channel.bio,
      isPublic: channel.is_public,
      inviteCode: showInviteCode ? channel.invite_code : undefined,
      createdAt: channel.created_at,
      ownerPuttIq,
    },
    followerCount: followerCount ?? 0,
    viewer,
  });
}

interface PatchBody {
  name?: string;
  bio?: string | null;
  isPublic?: boolean;
}

export async function PATCH(
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

  const url = new URL(req.url);
  const regenerate = url.searchParams.get("regenerate") === "1";

  let body: PatchBody = {};
  if (!regenerate) {
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: "bad-json" }, { status: 400 });
    }
  }

  // Owner check — RLS will block non-owner writes regardless, but we
  // return a cleaner 403 instead of an opaque RLS error.
  const { data: channel } = await supabase
    .from("channels")
    .select("id, owner_id")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (channel.owner_id !== user.id) {
    return NextResponse.json({ error: "not-owner" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (n.length < 1 || n.length > 60) {
      return NextResponse.json(
        { error: "bad-name", reason: "Name must be 1–60 characters" },
        { status: 400 },
      );
    }
    patch.name = n;
  }
  if (body.bio !== undefined) {
    patch.bio = body.bio?.toString().trim() ? body.bio.toString().trim() : null;
  }
  if (typeof body.isPublic === "boolean") {
    patch.is_public = body.isPublic;
  }
  if (regenerate) {
    // Postgres-side: substr(md5(random()::text), 1, 10) — 10 char hex.
    patch.invite_code = Array.from({ length: 10 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no-changes" }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from("channels")
    .update(patch)
    .eq("id", channel.id)
    .select("id, slug, name, owner_id, bio, is_public, invite_code, created_at")
    .single();
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: "update-failed", message: updateErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    channel: {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      ownerId: updated.owner_id,
      bio: updated.bio,
      isPublic: updated.is_public,
      inviteCode: updated.invite_code,
      createdAt: updated.created_at,
    },
  });
}
