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

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:hello@pardle.app";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys missing — set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
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
