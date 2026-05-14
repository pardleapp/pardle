import { NextResponse } from "next/server";
import { BRAND } from "@/lib/brand";
import { mintMagicToken } from "@/lib/fantasy/auth";
import { magicLinkEmail, sendEmail } from "@/lib/fantasy/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/fantasy/auth/request
 * Body: { email: string }
 *
 * Always responds 200, regardless of whether the email exists or was
 * rate-limited. This prevents an attacker enumerating valid emails
 * by watching response codes.
 */
export async function POST(req: Request) {
  let body: { email?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "bad email" }, { status: 400 });
  }

  const { token, rateLimited } = await mintMagicToken(email);
  if (rateLimited || !token) {
    return NextResponse.json({ ok: true });
  }

  const origin = new URL(req.url).origin;
  // In dev or preview the origin will be localhost/vercel preview; in
  // production it's pardle.app. Either way, the link works.
  const magicUrl = `${origin || BRAND.url}/api/fantasy/auth/verify?token=${token}`;

  const { subject, html, text } = magicLinkEmail(magicUrl);
  try {
    await sendEmail({ to: email, subject, html, text });
  } catch (err) {
    // Logging only — never echo the failure to the client since that
    // would also enable enumeration.
    console.error("[fantasy/auth] sendEmail failed", err);
  }
  return NextResponse.json({ ok: true });
}
