/**
 * Server-side push dispatch. Wraps the web-push library with our
 * VAPID config and a tolerant send helper that swallows the common
 * "gone" / 410 / 404 errors (browser unsubscribed) and surfaces the
 * subscription id so the caller can prune it from the table.
 *
 * Server-only.
 */
import "server-only";
import webpush from "web-push";

let configured = false;

/** Trim + strip any non-base64-url characters from a VAPID key env
 *  var value. Catches the common pasting hazards: trailing
 *  whitespace, accidental newlines, zero-width chars, surrounding
 *  quotes. Anything outside [A-Za-z0-9_-] is dropped. */
function sanitizeVapidKey(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/[^A-Za-z0-9_-]/g, "");
}

function ensureConfigured() {
  if (configured) return;
  const rawPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const rawPriv = process.env.VAPID_PRIVATE_KEY;
  const publicKey = sanitizeVapidKey(rawPub);
  const privateKey = sanitizeVapidKey(rawPriv);
  const subject = (process.env.VAPID_SUBJECT || "mailto:hello@pardle.app").trim();
  if (!publicKey || !privateKey) {
    throw new Error(
      `VAPID keys missing — pub_raw=${rawPub?.length ?? "undef"} pub_clean=${publicKey.length} priv_raw=${rawPriv?.length ?? "undef"} priv_clean=${privateKey.length}`,
    );
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    // Surface the sanitised key shape so we can tell whether the env
    // var arrived in the expected form or if Vercel's mangling it.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `setVapidDetails failed: ${msg} | pub_len=${publicKey.length} pub_head=${publicKey.slice(0, 4)} pub_tail=${publicKey.slice(-4)} priv_len=${privateKey.length} priv_head=${privateKey.slice(0, 4)} priv_tail=${privateKey.slice(-4)}`,
    );
  }
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface SubscriptionLike {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export interface SendResult {
  id: string;
  ok: boolean;
  gone: boolean;
  status?: number;
}

export async function sendPush(
  sub: SubscriptionLike,
  payload: PushPayload,
): Promise<SendResult> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    return { id: sub.id, ok: true, gone: false };
  } catch (err) {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode?: number }).statusCode)
        : undefined;
    const gone = status === 404 || status === 410;
    if (!gone) {
      console.error("[push] send failed", status, err);
    }
    return { id: sub.id, ok: false, gone, status };
  }
}
