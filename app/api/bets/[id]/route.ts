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
