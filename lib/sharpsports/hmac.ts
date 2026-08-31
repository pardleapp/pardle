/**
 * HMAC signature verification for SharpSports webhooks.
 *
 * SharpSports added webhook HMAC auth (their reply, point 1) and the
 * scheme is in their docs — but their docs are subscriber-only, so we
 * haven't seen the exact header/format yet. This module builds a
 * generic HMAC-SHA256 verifier plus adapters for the two common shapes
 * we're likely to encounter:
 *
 *   - **Direct** — one header (e.g. `x-sharpsports-signature`) whose
 *     value is `hex(hmac_sha256(secret, raw_body))`. Simple, no
 *     replay protection.
 *
 *   - **Timestamped (Stripe-style)** — header value is a comma-
 *     separated list of `t=<unix>,v1=<hex>` where the signed
 *     payload is `<t>.<raw_body>`. Adds replay protection via a
 *     freshness window on the timestamp.
 *
 * Pick the adapter that matches once we can see the docs; both are
 * unit-tested here so switching is a one-line change in the route.
 *
 * Verification is CONSTANT-TIME (`timingSafeEqual`) — the whole point
 * of HMAC auth is defeating timing attacks that a naive `===` string
 * compare would leak.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Compute the hex HMAC-SHA256 of a payload with the given secret. */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Constant-time compare of two hex strings. Returns false when
 *  lengths differ (a length mismatch is a legitimate failure but
 *  we still exit fast). */
function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// ── Direct signature adapter ───────────────────────────────────────

/** Verify a `hex(hmac_sha256(secret, raw_body))` signature.
 *  Returns `{ ok: true }` on match, or `{ ok: false, reason }` on
 *  mismatch — the reason string is for logging, never surface it
 *  back to the caller (leaks a bit about our internals). */
export function verifyDirectSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!signatureHeader) return { ok: false, reason: "missing-header" };
  const expected = hmacSha256Hex(secret, rawBody);
  return safeHexEqual(expected, signatureHeader.trim())
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}

// ── Timestamped signature adapter (Stripe-style) ──────────────────

/** Verify a signature header of the form
 *    `t=<unix_seconds>,v1=<hex(hmac_sha256(secret, "<t>.<rawBody>"))>`
 *
 *  Rejects if timestamp is older than `toleranceSec` (default 5 min)
 *  or in the future beyond `toleranceSec`. Multiple `v1=` values are
 *  supported for zero-downtime secret rotation — any one match wins. */
export function verifyTimestampedSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
  {
    toleranceSec = 300,
    now = Math.floor(Date.now() / 1000),
  }: { toleranceSec?: number; now?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!signatureHeader) return { ok: false, reason: "missing-header" };
  const parts = signatureHeader.split(",").map((p) => p.trim());
  let ts: number | null = null;
  const sigs: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=", 2).map((s) => s?.trim() ?? "");
    if (k === "t") ts = Number(v);
    else if (k === "v1") sigs.push(v);
  }
  if (ts == null || !Number.isFinite(ts)) return { ok: false, reason: "no-timestamp" };
  if (sigs.length === 0) return { ok: false, reason: "no-v1" };
  if (Math.abs(now - ts) > toleranceSec) return { ok: false, reason: "stale-timestamp" };

  const expected = hmacSha256Hex(secret, `${ts}.${rawBody}`);
  for (const s of sigs) {
    if (safeHexEqual(expected, s)) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}
