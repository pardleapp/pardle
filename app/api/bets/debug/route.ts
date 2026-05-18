import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/bets/debug
 *
 * Returns the signed-in user's bet rows with all settlement-relevant
 * columns visible — used to diagnose "this bet isn't showing as
 * settled on the home tracker" type problems. Tells you exactly
 * whether a bet is in the DB at all and what its settled_at /
 * settled_won values are.
 */
export async function GET() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not-signed-in" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("bets")
    .select(
      "id, kind, placed_at, settled_at, settled_won, removed_at, channel_id, data",
    )
    .eq("user_id", user.id)
    .order("placed_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }
  // Strip data jsonb to a compact summary so the response stays readable.
  const summary = (data ?? []).map((row) => {
    const d = row.data as Record<string, unknown>;
    return {
      id: row.id,
      kind: row.kind,
      playerName: d.playerName ?? null,
      playerId: d.playerId ?? null,
      stake: d.stake ?? null,
      oddsTaken: d.oddsTaken ?? null,
      cutoff: d.cutoff ?? null,
      side: d.side ?? null,
      line: d.line ?? null,
      round: d.round ?? null,
      placedAt: row.placed_at,
      settledAt: row.settled_at,
      settledWon: row.settled_won,
      removedAt: row.removed_at,
      channelId: row.channel_id,
    };
  });
  return NextResponse.json({
    userId: user.id,
    rowCount: summary.length,
    bets: summary,
  });
}
