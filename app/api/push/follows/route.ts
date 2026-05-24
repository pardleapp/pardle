import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/follows
 *
 * Body: { endpoint: string, follows: string[] }
 *
 * Updates the follows list on a single push subscription belonging to
 * the signed-in user. Called by the client whenever the user follows
 * or unfollows a player, so the next time the notify-poll cron looks
 * for "events involving any followed player", the latest set is on
 * the row.
 *
 * No-op when the device isn't subscribed yet — the follows then get
 * picked up at subscribe-time via the optional `follows` field on the
 * subscribe payload.
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: { endpoint?: string; follows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const endpoint = body.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    return NextResponse.json({ error: "missing-endpoint" }, { status: 400 });
  }
  const follows = Array.isArray(body.follows)
    ? body.follows
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .slice(0, 200)
    : [];

  const { error } = await supabase
    .from("push_subscriptions")
    .update({ follows })
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: follows.length });
}
