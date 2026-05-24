import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/subscribe
 *
 * Body: the JSON-serialised PushSubscription object returned by
 * `registration.pushManager.subscribe()`. Stored against the
 * signed-in user so the cron can address it later.
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    expirationTime?: unknown;
    /** Optional list of playerIds the device is following at the moment
     *  of subscription. Lets the cron address followed-player events
     *  (birdie, eagle, blow-up, putt-poll open) without needing a join
     *  to a separate follows table. The client refreshes this via the
     *  follows-sync endpoint when the user follows/unfollows later. */
    follows?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const authKey = body.keys?.auth;
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "invalid-subscription" }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? null;
  const follows = Array.isArray(body.follows)
    ? body.follows
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .slice(0, 200)
    : [];

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth_key: authKey,
        user_agent: ua,
        last_seen_at: new Date().toISOString(),
        follows,
      },
      { onConflict: "endpoint" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
