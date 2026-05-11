import { NextResponse } from "next/server";
import { publicRoomView, startRoom } from "@/lib/faces-duel/server";

export const runtime = "edge";

interface Params {
  params: Promise<{ roomId: string }>;
}

interface StartPayload {
  hostToken: string;
}

function isValid(body: unknown): body is StartPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return typeof b.hostToken === "string" && b.hostToken.length > 0;
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
    const room = await startRoom({ roomId, ...body });
    if (!room) {
      return NextResponse.json(
        { error: "not_found_or_unauthorized" },
        { status: 404 },
      );
    }
    return NextResponse.json({ room: publicRoomView(room) });
  } catch (err) {
    console.error("faces-duel start failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
