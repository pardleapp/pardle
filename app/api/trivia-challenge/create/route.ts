import { NextResponse } from "next/server";
import { saveChallenge } from "@/lib/trivia-challenge-store";
import type { TriviaChallengePayload } from "@/lib/trivia-challenge";

export const runtime = "edge";

function isValid(body: unknown): body is TriviaChallengePayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.d !== "easy" && b.d !== "medium" && b.d !== "hard") return false;
  if (typeof b.n !== "number" || !Number.isInteger(b.n) || b.n < 1) return false;
  if (typeof b.p !== "string" || b.p.length === 0 || b.p.length > 30) return false;
  if (!Array.isArray(b.a) || b.a.length !== 10) return false;
  for (const v of b.a) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < -1 || v > 3) {
      return false;
    }
  }
  if (typeof b.s !== "number" || !Number.isInteger(b.s) || b.s < 0 || b.s > 10) {
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isValid(body)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  try {
    const id = await saveChallenge(body);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("trivia challenge save failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
