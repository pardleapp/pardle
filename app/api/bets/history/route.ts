import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/bets/history
 *
 * Returns every bet the signed-in user has ever placed (settled +
 * pending), oldest-first by placed_at so the /history page can plot
 * a cumulative-P&L chart without re-sorting. Excludes removed bets.
 *
 * Each row includes the settlement fields (settled_at, settled_won)
 * written by /api/feed/notify-poll once the tournament wraps. For
 * pending bets these are null and the UI labels them "Pending".
 */
export async function GET() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ bets: [] });
  }
  const { data, error } = await supabase
    .from("bets")
    .select(
      "id, kind, data, placed_at, settled_at, settled_won, rationale, channel_id, source_tip_id",
    )
    .eq("user_id", user.id)
    .is("removed_at", null)
    .order("placed_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const bets = (data ?? []).map((row) => {
    const payload = row.data as Record<string, unknown>;
    return {
      ...payload,
      id: row.id as string,
      kind: row.kind as string,
      placedAt: new Date(row.placed_at as string).getTime(),
      settledAt: row.settled_at
        ? new Date(row.settled_at as string).getTime()
        : null,
      settledWon: row.settled_won as boolean | null,
      rationale: (row.rationale as string | null) ?? null,
      channelId: (row.channel_id as string | null) ?? null,
      sourceTipId: (row.source_tip_id as string | null) ?? null,
    };
  });
  return NextResponse.json({ bets });
}
