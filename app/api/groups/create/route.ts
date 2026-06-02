import { NextResponse } from "next/server";
import { createGroup } from "@/lib/groups/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { name?: unknown };
    if (typeof body.name !== "string") {
      return NextResponse.json(
        { error: "Group name is required" },
        { status: 400 },
      );
    }
    const group = await createGroup(body.name);
    return NextResponse.json({
      id: group.id,
      name: group.name,
      invite_code: group.invite_code,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status =
      message === "Not signed in"
        ? 401
        : message === "Group name is required"
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
