import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { sendPush, type SubscriptionLike } from "@/lib/notifications/web-push";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels/[slug]/tips — owner posts a tip.
 *
 * Body: { bet, rationale? }
 *   bet       — full client-shaped bet payload (id, kind, playerId,
 *               oddsTaken, stake, …), same shape as POST /api/bets
 *   rationale — optional "why I like it" blurb shown to followers
 *
 * Behaviour:
 *   1. Verify caller is the channel owner
 *   2. Insert into bets with channel_id + rationale + user_id=caller
 *   3. Fan out a push notification to all followers with
 *      notify_on_new_tip = true
 *
 * GET /api/channels/[slug]/tips — list tips in the channel (RLS
 *   gates: followers + owner only).
 */

interface PostTipBody {
  bet?: Record<string, unknown>;
  rationale?: string;
}

const VALID_KINDS = new Set([
  "outright",
  "round-score",
  "winning-score",
  "top-finish",
]);

const ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN ??
  process.env.VERCEL_URL?.replace(/^https?:\/\//, "") ??
  "https://pardle.app";

function originUrl(): string {
  return ORIGIN.startsWith("http") ? ORIGIN : `https://${ORIGIN}`;
}

function summariseBet(bet: Record<string, unknown>): string {
  const kind = bet.kind as string;
  const oddsLabel = (bet.oddsTakenLabel as string) ?? "";
  const stake = bet.stake as number;
  const stakeStr = Number.isFinite(stake)
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(stake)
    : "";
  if (kind === "outright") {
    return `${(bet.playerName as string) ?? "Pick"} to win${oddsLabel ? ` @ ${oddsLabel}` : ""}${stakeStr ? ` · ${stakeStr}` : ""}`;
  }
  if (kind === "top-finish") {
    return `${(bet.playerName as string) ?? "Pick"} top ${bet.cutoff ?? "?"}${oddsLabel ? ` @ ${oddsLabel}` : ""}`;
  }
  if (kind === "round-score") {
    return `${(bet.playerName as string) ?? "Pick"} R${bet.round ?? "?"} ${bet.side ?? ""} ${bet.line ?? ""}${oddsLabel ? ` @ ${oddsLabel}` : ""}`;
  }
  if (kind === "winning-score") {
    return `Winning score ${bet.side ?? ""} ${bet.line ?? ""}${oddsLabel ? ` @ ${oddsLabel}` : ""}`;
  }
  return "New tip";
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

  let body: PostTipBody;
  try {
    body = (await req.json()) as PostTipBody;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const bet = body.bet ?? {};
  if (
    typeof bet.id !== "string" ||
    typeof bet.kind !== "string" ||
    typeof bet.placedAt !== "number" ||
    !VALID_KINDS.has(bet.kind as string)
  ) {
    return NextResponse.json({ error: "invalid-bet" }, { status: 400 });
  }
  const rationale =
    typeof body.rationale === "string" && body.rationale.trim().length > 0
      ? body.rationale.trim().slice(0, 500)
      : null;

  // Owner check.
  const { data: channel } = await supabase
    .from("channels")
    .select("id, name, owner_id, slug")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (channel.owner_id !== user.id) {
    return NextResponse.json({ error: "not-owner" }, { status: 403 });
  }

  // Insert the tip. Use upsert so a client retry with the same id
  // doesn't error.
  const { error: insertErr } = await supabase.from("bets").upsert(
    {
      id: bet.id as string,
      user_id: user.id,
      kind: bet.kind as string,
      data: bet,
      placed_at: new Date(bet.placedAt as number).toISOString(),
      channel_id: channel.id,
      rationale,
    },
    { onConflict: "id" },
  );
  if (insertErr) {
    return NextResponse.json(
      { error: "insert-failed", message: insertErr.message },
      { status: 500 },
    );
  }

  // Push fanout: every follower (excluding the owner) with
  // notify_on_new_tip = true gets a push. Use the admin client to
  // bypass RLS — we need to read across users for the fanout.
  void fanoutTipPush({
    channelId: channel.id,
    channelName: channel.name,
    channelSlug: channel.slug,
    ownerId: user.id,
    betSummary: summariseBet(bet),
    rationale,
  }).catch((err) => {
    console.error("[tips] fanout failed", err);
  });

  return NextResponse.json({ ok: true });
}

async function fanoutTipPush(args: {
  channelId: string;
  channelName: string;
  channelSlug: string;
  ownerId: string;
  betSummary: string;
  rationale: string | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: followers } = await admin
    .from("channel_followers")
    .select("user_id, notify_on_new_tip")
    .eq("channel_id", args.channelId)
    .eq("notify_on_new_tip", true)
    .neq("user_id", args.ownerId);
  const userIds = (followers ?? []).map((f) => f.user_id as string);
  if (userIds.length === 0) return;

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key, user_id")
    .in("user_id", userIds);
  if (!subs || subs.length === 0) return;

  const url = `${originUrl()}/${args.channelSlug}`;
  const title = `@${args.channelSlug} just posted a tip`;
  const body = args.rationale
    ? `${args.betSummary} — ${args.rationale.slice(0, 100)}`
    : args.betSummary;

  for (const s of subs as Array<SubscriptionLike & { user_id: string }>) {
    const res = await sendPush(s, {
      title,
      body,
      url,
      tag: `tip-${args.channelId}`,
    });
    if (res.gone) {
      await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const supabase = await getSupabaseServer();

  const { data: channel } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  // RLS on bets gates to channel followers/owner via the updated
  // "Bets: read own or channel follower" policy. Non-members get
  // an empty list rather than 403 — they can see the channel landing
  // but not the tip contents.
  const { data: tips, error } = await supabase
    .from("bets")
    .select("id, kind, data, placed_at, rationale")
    .eq("channel_id", channel.id)
    .is("removed_at", null)
    .order("placed_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json(
      { error: "fetch-failed", message: error.message },
      { status: 500 },
    );
  }

  const out = (tips ?? []).map((row) => ({
    ...(row.data as Record<string, unknown>),
    id: row.id,
    kind: row.kind,
    placedAt: new Date(row.placed_at).getTime(),
    rationale: row.rationale,
  }));
  return NextResponse.json({ tips: out });
}
