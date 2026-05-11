import { NextResponse } from "next/server";
import { loadChallenge } from "@/lib/trivia-challenge-store";

export const runtime = "edge";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  try {
    const payload = await loadChallenge(id);
    if (!payload) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ payload });
  } catch (err) {
    console.error("trivia challenge load failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
