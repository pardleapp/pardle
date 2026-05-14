import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE } from "@/lib/fantasy/auth";

/** POST /api/fantasy/auth/logout — clears the session and redirects to /fantasy. */
export async function POST(req: Request) {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (sid) {
    await destroySession(sid);
  }
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(`${origin}/fantasy`, { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
