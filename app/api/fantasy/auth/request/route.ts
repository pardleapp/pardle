import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { BRAND } from "@/lib/brand";
import { mintMagicToken, sanitizeNext } from "@/lib/fantasy/auth";
import { magicLinkEmail, sendEmail } from "@/lib/fantasy/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const redis = Redis.fromEnv();
/** Per-IP magic-link request cap. mintMagicToken's per-email limit
 *  blocks a single address being spammed, but an attacker rotating
 *  emails from one machine would otherwise bill our email provider
 *  for thousands of bounces and land "you signed up for Pardle"
 *  spam in random inboxes. */
const IP_RATE_WINDOW_SECONDS = 60 * 60;
const IP_RATE_MAX = 5;

/**
 * POST /api/fantasy/auth/request
 * Body: { email: string }
 *
 * Always responds 200, regardless of whether the email exists or was
 * rate-limited. This prevents an attacker enumerating valid emails
 * by watching response codes.
 */
export async function POST(req: Request) {
  let body: { email?: string; next?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "bad email" }, { status: 400 });
  }

  // Per-IP rate limit. Best-effort via x-forwarded-for (Vercel/edge
  // forwards client IP). Still returns 200 on exhaust to preserve
  // the no-enumeration property.
  const ip =
    (req.headers.get("x-forwarded-for") ?? "")
      .split(",")[0]
      .trim() || "unknown";
  const ipKey = `fauth:ip:${ip}`;
  const count = await redis.incr(ipKey);
  if (count === 1) {
    await redis.expire(ipKey, IP_RATE_WINDOW_SECONDS);
  }
  if (count > IP_RATE_MAX) {
    return NextResponse.json({ ok: true });
  }

  const next = sanitizeNext(body.next);
  const { token, rateLimited } = await mintMagicToken(email, next);
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
