import { NextResponse } from "next/server";
import { publicRoomView, submitClaim } from "@/lib/faces-duel/server";
import { ROUNDS_PER_DUEL } from "@/lib/faces-duel/types";

export const runtime = "edge";

interface Params {
  params: Promise<{ roomId: string }>;
}

interface ClaimPayload {
  playerToken: string;
  roundIndex: number;
  text: string;
}

function isValid(body: unknown): body is ClaimPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.playerToken === "string" &&
    b.playerToken.length > 0 &&
    b.playerToken.length <= 64 &&
    typeof b.roundIndex === "number" &&
    Number.isInteger(b.roundIndex) &&
    b.roundIndex >= 0 &&
    b.roundIndex < ROUNDS_PER_DUEL &&
    typeof b.text === "string" &&
    b.text.length > 0 &&
    b.text.length <= 60
  );
}

export async function POST(req: Request, { params }: Params) {
  const { roomId } = await params;
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
    const room = await submitClaim({ roomId, ...body });
    if (!room) {
      return NextResponse.json(
        { error: "not_found_or_unauthorized" },
        { status: 404 },
      );
    }
    return NextResponse.json({ room: publicRoomView(room) });
  } catch (err) {
    console.error("faces-duel claim failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
