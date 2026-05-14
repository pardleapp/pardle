/**
 * Resend email sender — thin wrapper, no SDK dependency.
 *
 * Set RESEND_API_KEY in Vercel env. While we don't have a verified
 * sender domain, we send from Resend's default address. Once we add
 * DNS records for pardle.app, change FROM_ADDRESS to noreply@pardle.app.
 */

import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "Pardle Fantasy <onboarding@resend.dev>";
const REPLY_TO = "pardle.app@gmail.com";

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [args.to],
      reply_to: REPLY_TO,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

export function magicLinkEmail(
  magicUrl: string,
): { subject: string; html: string; text: string } {
  const subject = "Sign in to Pardle Fantasy";
  const text = [
    "Tap the link below to sign in to Pardle Fantasy. It expires in 15 minutes.",
    "",
    magicUrl,
    "",
    "If you didn't request this, ignore the email.",
  ].join("\n");
  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#1f1f1f;">
  <h1 style="font-size:24px;margin:0 0 12px;">Sign in to Pardle Fantasy</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px;">
    Tap the button below to sign in. The link expires in 15 minutes.
  </p>
  <a href="${magicUrl}"
     style="display:inline-block;background:#7BAE3F;color:white;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:8px;letter-spacing:0.3px;">
    Sign in
  </a>
  <p style="font-size:13px;color:#666;margin:24px 0 0;line-height:1.5;">
    Or paste this link into your browser:<br>
    <a href="${magicUrl}" style="color:#7BAE3F;word-break:break-all;">${magicUrl}</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
  <p style="font-size:12px;color:#999;margin:0;">
    If you didn't request this, just ignore the email — no action needed.
  </p>
</body></html>`;
  return { subject, html, text };
}
