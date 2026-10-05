/** GET /api/dpwt/course-pin-birdies?tournamentId=D2025134 — scoring by pin position across every edition at the venue. */
import { NextResponse } from "next/server";
import { getDpwtPinBirdies } from "@/lib/dpwt/pins";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("tournamentId");
  if (!id) return NextResponse.json({ ok: false, error: "tournamentId required" }, { status: 400 });
  const payload = await getDpwtPinBirdies(id);
  if (!payload) return NextResponse.json({ ok: false, error: "no data available" }, { status: 404 });
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
