import { NextResponse } from "next/server";
import { createRoom, publicRoomView } from "@/lib/duel/server";

export const runtime = "edge";

const VALID_DIFFICULTIES = ["easy", "medium", "hard"] as const;
type Difficulty = (typeof VALID_DIFFICULTIES)[number];

interface CreatePayload {
  difficulty: Difficulty;
  hostToken: string;
  hostName: string;
}

function isValid(body: unknown): body is CreatePayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.difficulty === "string" &&
    (VALID_DIFFICULTIES as readonly string[]).includes(b.difficulty) &&
    typeof b.hostToken === "string" &&
    b.hostToken.length > 0 &&
    b.hostToken.length <= 64 &&
    typeof b.hostName === "string" &&
    b.hostName.length > 0 &&
    b.hostName.length <= 30
  );
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
    const room = await createRoom(body);
    return NextResponse.json({ room: publicRoomView(room) });
  } catch (err) {
    console.error("duel create failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
