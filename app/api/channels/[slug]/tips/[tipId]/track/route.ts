import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels/[slug]/tips/[tipId]/track
 *
 * Clone a tip into the calling user's own bet tracker. The new bet
 * inherits the tip's full payload (player, odds, stake, side, line,
 * cutoff, etc) and links back via source_tip_id so the bet row can
 * be rendered with a "tracking @tipster" badge.
 *
 * Behaviour:
 *   - Caller must be a follower or owner of the channel (RLS on the
 *     SELECT enforces this implicitly — the tip is invisible to
 *     non-members).
 *   - A user can only track the same tip once. The new bet's id is
 *     deterministic: `track:{tipId}:{userId}` so a retry no-ops.
 *   - The owner CAN call this on their own tip if they want to put
 *     it in their personal tracker (useful when their tip and their
 *     own bet are the same trade).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ slug: string; tipId: string }> },
) {
  const { slug, tipId } = await ctx.params;
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not-signed-in" }, { status: 401 });
  }

  // Find the channel + the tip. RLS will hide the tip from
  // non-members, returning null — which we surface as 403.
  const { data: channel } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "channel-not-found" }, { status: 404 });
  }
  const { data: tip } = await supabase
    .from("bets")
    .select("id, kind, data, channel_id")
    .eq("id", tipId)
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (!tip) {
    // Either the tip doesn't exist or RLS is hiding it because the
    // caller isn't a member. Either way, refuse.
    return NextResponse.json(
      {
        error: "tip-unavailable",
        reason: "Follow the tipster to track their picks.",
      },
      { status: 403 },
    );
  }

  // Clone. The cloned bet gets a new deterministic id, the caller as
  // owner, no channel_id (it's a personal bet), and source_tip_id
  // links back so the BetTracker can render the "via @tipster" badge.
  const trackedId = `track:${tipId}:${user.id}`;
  const tipData = tip.data as Record<string, unknown>;
  const trackedData = {
    ...tipData,
    id: trackedId,
    placedAt: Date.now(),
  };
  const { error: insertErr } = await supabase.from("bets").upsert(
    {
      id: trackedId,
      user_id: user.id,
      kind: tip.kind as string,
      data: trackedData,
      placed_at: new Date().toISOString(),
      source_tip_id: tipId,
    },
    { onConflict: "id" },
  );
  if (insertErr) {
    return NextResponse.json(
      { error: "insert-failed", message: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    trackedBetId: trackedId,
  });
}
