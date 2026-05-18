import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/[slug]/messages
 *
 * List the most-recent messages for the channel. RLS gates this to
 * followers/owner — non-members get 403.
 *
 * POST /api/channels/[slug]/messages
 *
 * Post a chat message. RLS gates to followers/owner. Body is
 * { text, refBetId? } — refBetId optionally pins the message to a
 * tip (so the UI can render "↳ replying to this pick" inline).
 */

interface PostBody {
  text?: string;
  refBetId?: string | null;
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

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { error: "empty", reason: "Message can't be empty" },
      { status: 400 },
    );
  }
  if (text.length > 1000) {
    return NextResponse.json(
      { error: "too-long", reason: "Maximum 1000 characters" },
      { status: 400 },
    );
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("channel_messages")
    .insert({
      channel_id: channel.id,
      author_id: user.id,
      text,
      ref_bet_id: body.refBetId ?? null,
    })
    .select("id, channel_id, author_id, ts, text, ref_bet_id")
    .single();
  if (insertErr || !inserted) {
    // RLS rejection comes back as a generic permission error — surface
    // a clean 403 so the UI knows to prompt "follow to chat".
    if (insertErr?.code === "42501") {
      return NextResponse.json(
        {
          error: "not-a-follower",
          reason: "Follow the tipster to join the chat.",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "insert-failed", message: insertErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: {
      id: inserted.id,
      channelId: inserted.channel_id,
      authorId: inserted.author_id,
      ts: new Date(inserted.ts as string).getTime(),
      text: inserted.text,
      refBetId: inserted.ref_bet_id,
    },
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") ?? "100")),
  );
  const supabase = await getSupabaseServer();

  const { data: channel } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const { data: rows, error } = await supabase
    .from("channel_messages")
    .select("id, channel_id, author_id, ts, text, ref_bet_id")
    .eq("channel_id", channel.id)
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) {
    // RLS rejection on a non-member: return an empty list, not an
    // error. The client can decide to render an "unlock by following"
    // CTA based on the empty state + the channel's privacy flag.
    return NextResponse.json({ messages: [] });
  }

  // Build a tiny author profile map so the UI can render display
  // names without an extra round-trip per message.
  const authorIds = Array.from(
    new Set((rows ?? []).map((r) => r.author_id as string)),
  );
  let authors: Record<string, { displayName: string | null }> = {};
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", authorIds);
    if (profiles) {
      authors = Object.fromEntries(
        profiles.map((p) => [
          p.user_id as string,
          { displayName: (p.display_name as string | null) ?? null },
        ]),
      );
    }
  }

  return NextResponse.json({
    // Oldest-first for the UI render (avoid an extra reverse on the client).
    messages: (rows ?? []).reverse().map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      authorName: authors[r.author_id as string]?.displayName ?? null,
      ts: new Date(r.ts as string).getTime(),
      text: r.text,
      refBetId: r.ref_bet_id,
    })),
  });
}
