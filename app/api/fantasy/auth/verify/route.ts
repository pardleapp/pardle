import { NextResponse } from "next/server";
import {
  consumeMagicToken,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  upsertUserByEmail,
} from "@/lib/fantasy/auth";

/**
 * GET /api/fantasy/auth/verify?token=…
 *
 * Consumes a one-time magic-link token. On success, upserts the user,
 * mints a session, sets the session cookie, and redirects to /fantasy.
 * On failure (expired or unknown token) redirects to /fantasy/auth with
 * an error query param.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const origin = url.origin;

  if (!token) {
    return NextResponse.redirect(`${origin}/fantasy/auth?error=missing`);
  }

  const email = await consumeMagicToken(token);
  if (!email) {
    return NextResponse.redirect(`${origin}/fantasy/auth?error=expired`);
  }

  const user = await upsertUserByEmail(email);
  const sid = await createSession(user.id);

  const res = NextResponse.redirect(`${origin}/fantasy`);
  res.cookies.set(SESSION_COOKIE, sid, sessionCookieOptions());
  return res;
}
