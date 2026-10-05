/** GET /api/dpwt/course-pins?tournamentId=D2025134 — DP World Tour pin sheet. */
import { NextResponse } from "next/server";
import { getDpwtPinSheet } from "@/lib/dpwt/pins";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("tournamentId");
  if (!id) return NextResponse.json({ ok: false, error: "tournamentId required" }, { status: 400 });
  const pins = await getDpwtPinSheet(id);
  if (!pins) return NextResponse.json({ ok: false, error: "no pin data available" }, { status: 404 });
  return NextResponse.json({ ok: true, cached: false, pins });
}
