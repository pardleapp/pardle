import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  getAuthUserId,
  listGroupMessages,
  postGroupMessage,
} from "@/lib/groups/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Caller must be signed in AND a member of the group. */
async function gateMembership(groupId: string): Promise<string | null> {
  const userId = await getAuthUserId();
  if (!userId) return null;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? userId : null;
}

/** GET /api/groups/[id]/messages?limit=100[&bet_id=X]
 *  Returns recent messages for the group, ascending. Optional
 *  bet_id filter scopes to messages referencing one bet (used by
 *  the "On this bet" thread on the bet-detail page). */
export async function GET(req: Request, { params }: Params) {
  const { id: groupId } = await params;
  const userId = await gateMembership(groupId);
  if (!userId) {
    return NextResponse.json({ error: "not-a-member" }, { status: 403 });
  }
  const url = new URL(req.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));
  const betFilter = url.searchParams.get("bet_id");
  const all = await listGroupMessages(groupId, limit);
  const filtered = betFilter
    ? all.filter((m) => m.bet_id === betFilter)
    : all;
  return NextResponse.json({ messages: filtered });
}

/** POST /api/groups/[id]/messages { body, betId? } */
export async function POST(req: Request, { params }: Params) {
  const { id: groupId } = await params;
  const userId = await gateMembership(groupId);
  if (!userId) {
    return NextResponse.json({ error: "not-a-member" }, { status: 403 });
  }
  let payload: { body?: unknown; betId?: unknown };
  try {
    payload = (await req.json()) as { body?: unknown; betId?: unknown };
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  if (typeof payload.body !== "string") {
    return NextResponse.json({ error: "bad-body" }, { status: 400 });
  }
  const betId =
    typeof payload.betId === "string" && payload.betId.length > 0
      ? payload.betId
      : null;
  try {
    const message = await postGroupMessage(groupId, payload.body, betId);
    return NextResponse.json({ message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
