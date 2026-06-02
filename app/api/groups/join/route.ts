import { NextResponse } from "next/server";
import { joinGroupByCode } from "@/lib/groups/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { code?: unknown };
    if (typeof body.code !== "string") {
      return NextResponse.json(
        { error: "Invite code is required" },
        { status: 400 },
      );
    }
    const code = body.code.trim().toUpperCase();
    const groupId = await joinGroupByCode(code);
    return NextResponse.json({ group_id: groupId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status =
      message === "Not signed in"
        ? 401
        : message === "Invalid invite code" ||
            message === "Invite code doesn't match any group"
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
