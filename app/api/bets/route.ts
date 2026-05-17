import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/bets — list the signed-in user's bets (active only).
 */
export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ bets: [] });
  }
  const { data, error } = await supabase
    .from("bets")
    .select("id, kind, data, placed_at")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .order("placed_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const bets = (data ?? []).map((row) => ({
    ...(row.data as Record<string, unknown>),
    id: row.id,
    kind: row.kind,
    placedAt: new Date(row.placed_at).getTime(),
  }));
  return NextResponse.json({ bets });
}

/**
 * POST /api/bets — create a bet. Body is the full bet payload as
 * already shaped by the client (id, kind, placedAt, …kind-specific).
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let bet: Record<string, unknown>;
  try {
    bet = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const id = bet.id;
  const kind = bet.kind;
  const placedAt = bet.placedAt;
  if (
    typeof id !== "string" ||
    typeof kind !== "string" ||
    typeof placedAt !== "number" ||
    !["outright", "round-score", "winning-score", "top-finish"].includes(kind)
  ) {
    return NextResponse.json({ error: "invalid-bet" }, { status: 400 });
  }
  const { error } = await supabase.from("bets").upsert(
    {
      id,
      user_id: user.id,
      kind,
      data: bet,
      placed_at: new Date(placedAt).toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
