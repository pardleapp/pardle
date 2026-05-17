import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/bets/migrate — accept the user's localStorage bet array
 * (sent from the browser on first sign-in) and upsert them into the
 * server bets table under the signed-in user's id. Re-running is
 * safe: id is the primary key so re-posting the same bet is a no-op
 * via onConflict.
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let payload: { bets?: unknown };
  try {
    payload = (await req.json()) as { bets?: unknown };
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const bets = Array.isArray(payload.bets) ? payload.bets : [];
  if (bets.length === 0) {
    return NextResponse.json({ migrated: 0 });
  }

  const rows: Array<{
    id: string;
    user_id: string;
    kind: string;
    data: unknown;
    placed_at: string;
  }> = [];
  for (const raw of bets) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const id = b.id;
    const kind = b.kind;
    const placedAt = b.placedAt;
    if (
      typeof id !== "string" ||
      typeof kind !== "string" ||
      typeof placedAt !== "number" ||
      !["outright", "round-score", "winning-score", "top-finish"].includes(
        kind,
      )
    ) {
      continue;
    }
    rows.push({
      id,
      user_id: user.id,
      kind,
      data: b,
      placed_at: new Date(placedAt).toISOString(),
    });
  }
  if (rows.length === 0) {
    return NextResponse.json({ migrated: 0 });
  }
  const { error } = await supabase
    .from("bets")
    .upsert(rows, { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ migrated: rows.length });
}
