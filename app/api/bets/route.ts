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
  // Fetch ALL the user's bets (including removed ones) so we can
  // tell the client which IDs to prune from its localStorage cache.
  // A bet removed on device A leaves a zombie in device B's local
  // store until we explicitly say "drop this id".
  const { data, error } = await supabase
    .from("bets")
    .select("id, kind, data, placed_at, settled_at, settled_won, removed_at")
    .eq("user_id", user.id)
    .order("placed_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const allRows = data ?? [];
  const removedIds = allRows
    .filter((row) => row.removed_at != null)
    .map((row) => row.id as string);
  const bets = allRows
    .filter((row) => row.removed_at == null)
    .map((row) => ({
      ...(row.data as Record<string, unknown>),
      id: row.id,
      kind: row.kind,
      placedAt: new Date(row.placed_at).getTime(),
      // Settlement state from notify-poll. The bet tracker reads these
      // for bets from past tournaments — the client-side detector only
      // works against the active leaderboard, so once the resolver
      // rolls forward it loses sight of "did this PGA bet win?" without
      // these columns.
      settledAt: row.settled_at
        ? new Date(row.settled_at as string).getTime()
        : null,
      settledWon: (row.settled_won as boolean | null) ?? null,
    }));
  return NextResponse.json({ bets, removedIds });
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
