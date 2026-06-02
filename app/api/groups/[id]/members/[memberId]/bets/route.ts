import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  getAuthUserId,
  getMemberOpenBets,
} from "@/lib/groups/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string; memberId: string }>;
}

/** GET /api/groups/[id]/members/[memberId]/bets
 *  Returns the open non-private bets for one member of a group.
 *  Caller must be signed in AND a member of [id]; [memberId] must
 *  also be a member of [id]. Privacy is enforced inside
 *  getMemberOpenBets (isPrivate filter). */
export async function GET(_req: Request, { params }: Params) {
  const { id: groupId, memberId } = await params;
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  // Caller must be a member of the group.
  const { data: callerRow } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!callerRow) {
    return NextResponse.json({ error: "not-a-member" }, { status: 403 });
  }
  // Target must also be a member (otherwise this endpoint would let
  // any group member fish for any user's bets by ID).
  const { data: targetRow } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", memberId)
    .maybeSingle();
  if (!targetRow) {
    return NextResponse.json({ error: "not-a-member" }, { status: 403 });
  }
  const bets = await getMemberOpenBets(groupId, memberId);
  return NextResponse.json({ bets });
}
