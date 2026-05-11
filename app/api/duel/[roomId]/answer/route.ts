import { NextResponse } from "next/server";
import { publicRoomView, submitAnswer } from "@/lib/duel/server";

export const runtime = "edge";

interface Params {
  params: Promise<{ roomId: string }>;
}

interface AnswerPayload {
  playerToken: string;
  questionIndex: number;
  answerIndex: number;
}

function isValid(body: unknown): body is AnswerPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.playerToken === "string" &&
    b.playerToken.length > 0 &&
    b.playerToken.length <= 64 &&
    typeof b.questionIndex === "number" &&
    Number.isInteger(b.questionIndex) &&
    b.questionIndex >= 0 &&
    b.questionIndex < 10 &&
    typeof b.answerIndex === "number" &&
    Number.isInteger(b.answerIndex) &&
    b.answerIndex >= 0 &&
    b.answerIndex < 4
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
    const room = await submitAnswer({ roomId, ...body });
    if (!room) {
      return NextResponse.json({ error: "not_found_or_unauthorized" }, { status: 404 });
    }
    return NextResponse.json({ room: publicRoomView(room) });
  } catch (err) {
    console.error("duel answer failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
