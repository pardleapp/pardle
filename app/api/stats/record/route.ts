import { NextResponse } from "next/server";
import {
  recordPlay,
  STATS_GAMES,
  type StatsGameId,
} from "@/lib/stats-backend";

export const runtime = "edge";

interface RecordPayload {
  game: StatsGameId;
  variant?: string;
  day: number;
  userToken: string;
  isWin: boolean;
  score: number;
}

function isValidPayload(body: unknown): body is RecordPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const variantOk =
    b.variant === undefined ||
    (typeof b.variant === "string" &&
      b.variant.length > 0 &&
      b.variant.length <= 24 &&
      /^[a-z0-9_-]+$/.test(b.variant));
  return (
    typeof b.game === "string" &&
    (STATS_GAMES as readonly string[]).includes(b.game) &&
    variantOk &&
    typeof b.day === "number" &&
    Number.isInteger(b.day) &&
    b.day >= 0 &&
    typeof b.userToken === "string" &&
    b.userToken.length > 0 &&
    b.userToken.length <= 64 &&
    typeof b.isWin === "boolean" &&
    typeof b.score === "number" &&
    Number.isInteger(b.score) &&
    b.score >= 0 &&
    b.score <= 50
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const recorded = await recordPlay(body);
    return NextResponse.json({ recorded });
  } catch (err) {
    console.error("stats record failed", err);
    return NextResponse.json({ error: "backend_failure" }, { status: 500 });
  }
}
