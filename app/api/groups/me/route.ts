import { NextResponse } from "next/server";
import { listMyGroups } from "@/lib/groups/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/groups/me — list the signed-in user's groups. Used by
 *  surfaces outside /groups (e.g. the bet-detail "On this bet"
 *  chat thread) to pick which group to attach a comment to. */
export async function GET() {
  const groups = await listMyGroups();
  return NextResponse.json({ groups });
}
