import { NextResponse } from "next/server";
import { joinRoom, loadRoom, maybeAdvance, publicRoomView } from "@/lib/duel/server";

export const runtime = "edge";

interface Params {
  params: Promise<{ roomId: string }>;
}

/** Polling — both players hit this every ~1s to see current room state. */
export async function GET(_req: Request, { params }: Params) {
  const { roomId } = await params;
  if (!roomId || typeof roomId !== "string") {
    return NextResponse.json({ error: "invalid_room_id" }, { status: 400 });
  }
  // Opportunistically advance to the next question if enough time has
  // elapsed since the last resolution. Cheaper than a separate cron.
  const advanced = await maybeAdvance(roomId);
  const room = advanced ?? (await loadRoom(roomId));
  if (!room) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ room: publicRoomView(room) });
}

/** Join a room as the 2nd player (or reconnect as p1/p2 by token). */
interface JoinPayload {
  playerToken: string;
  playerName: string;
}

function isValidJoin(body: unknown): body is JoinPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.playerToken === "string" &&
    b.playerToken.length > 0 &&
    b.playerToken.length <= 64 &&
    typeof b.playerName === "string" &&
    b.playerName.length > 0 &&
    b.playerName.length <= 30
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
  if (!isValidJoin(body)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  try {
    const room = await joinRoom({ roomId, ...body });
    if (!room) {
      return NextResponse.json({ error: "room_full_or_missing" }, { status: 404 });
    }
    return NextResponse.json({ room: publicRoomView(room) });
  } catch (err) {
    console.error("duel join failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
