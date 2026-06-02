import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/bets/[id] — fetch a single bet by id (signed-in user only). */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("bets")
    .select("id, kind, data, placed_at, removed_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ bet: null }, { status: 404 });
  }
  return NextResponse.json({
    bet: {
      ...(data.data as Record<string, unknown>),
      id: data.id,
      kind: data.kind,
      placedAt: new Date(data.placed_at).getTime(),
    },
  });
}

/** PATCH /api/bets/[id] — toggle the bet's private flag (the only
 *  mutable field for now; the rest of the bet payload is immutable
 *  post-placement). Sets data.isPrivate in the JSONB blob. Owner-
 *  only via RLS — even brute-forcing a bet id can't patch someone
 *  else's row because the user-session client carries auth.uid()
 *  and the bets RLS policy filters on user_id = auth.uid(). */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let body: { isPrivate?: unknown };
  try {
    body = (await req.json()) as { isPrivate?: unknown };
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  if (typeof body.isPrivate !== "boolean") {
    return NextResponse.json({ error: "bad-isPrivate" }, { status: 400 });
  }
  const { data: row } = await supabase
    .from("bets")
    .select("data")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const current = (row.data as Record<string, unknown> | null) ?? {};
  const next = { ...current, isPrivate: body.isPrivate };
  const { error } = await supabase
    .from("bets")
    .update({ data: next } as never)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, isPrivate: body.isPrivate });
}

/** DELETE /api/bets/[id] — soft-remove (sets removed_at). */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const { error } = await supabase
    .from("bets")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
