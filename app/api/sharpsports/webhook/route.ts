/**
 * POST /api/sharpsports/webhook
 *
 * Receives bet-slip updates from SharpSports BetSync. Verifies HMAC,
 * parses the payload into Pardle's canonical shape (golf legs only),
 * and stores in Redis.
 *
 * Contract with SharpSports:
 *   - Body is JSON; content-type application/json.
 *   - A signature header carries HMAC-SHA256. Which header + format
 *     is confirmed once we can see their docs — for now the route
 *     supports both direct (`x-sharpsports-signature`) and
 *     Stripe-style timestamped (`x-sharpsports-signature-timestamped`)
 *     via an env-flag switch.
 *   - Response codes:
 *       200 — accepted, all slips stored.
 *       202 — accepted but too large; we return this ourselves when
 *             an initial-dump webhook indicates pagination is needed.
 *             (See SharpSports reply point 5.)
 *       400 — malformed body.
 *       401 — bad signature.
 *       500 — internal error; SharpSports will retry per their retry
 *             policy (currently: none, per their reply — we
 *             reconcile via the Webhook Logs endpoint nightly).
 *
 * Env vars:
 *   SHARPSPORTS_WEBHOOK_SECRET       — the shared HMAC secret
 *   SHARPSPORTS_WEBHOOK_SCHEME       — "direct" | "timestamped"
 *                                       (default: "direct")
 *   SHARPSPORTS_WEBHOOK_SIG_HEADER   — override the signature header
 *                                       name (defaults per scheme)
 */

import { NextResponse } from "next/server";
import type { SSWebhookPayload } from "@/lib/sharpsports/types";
import { parseSlip } from "@/lib/sharpsports/parser";
import { buildParseContext } from "@/lib/sharpsports/lookups";
import {
  saveSlips,
  markAccountRefreshed,
} from "@/lib/sharpsports/store";
import {
  verifyDirectSignature,
  verifyTimestampedSignature,
} from "@/lib/sharpsports/hmac";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs"; // node:crypto for HMAC

const DEFAULT_HEADER_DIRECT = "x-sharpsports-signature";
const DEFAULT_HEADER_TIMESTAMPED = "x-sharpsports-signature";

/** Verify the request signature against the configured scheme.
 *  Returns null on success, an error string on failure (for
 *  logging — never surfaced to the caller). */
function verify(
  rawBody: string,
  headers: Headers,
): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.SHARPSPORTS_WEBHOOK_SECRET;
  if (!secret) {
    // Fail-closed if the secret isn't configured — refuse rather
    // than accept-unsigned. In prod, SHARPSPORTS_WEBHOOK_SECRET must
    // be set before enabling the SharpSports integration.
    return { ok: false, reason: "no-secret-configured" };
  }
  const scheme =
    (process.env.SHARPSPORTS_WEBHOOK_SCHEME ?? "direct").toLowerCase();
  const headerName =
    process.env.SHARPSPORTS_WEBHOOK_SIG_HEADER ??
    (scheme === "timestamped" ? DEFAULT_HEADER_TIMESTAMPED : DEFAULT_HEADER_DIRECT);
  const sig = headers.get(headerName);
  if (scheme === "timestamped") {
    return verifyTimestampedSignature(secret, rawBody, sig);
  }
  return verifyDirectSignature(secret, rawBody, sig);
}

export async function POST(req: Request) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unreadable body" },
      { status: 400 },
    );
  }

  const verification = verify(rawBody, req.headers);
  if (!verification.ok) {
    // Log the reason for debugging, but return a generic 401 to
    // avoid leaking internals about the signature scheme.
    console.warn("[sharpsports:webhook] rejected:", verification.reason);
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let payload: SSWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SSWebhookPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  // Initial-dump pattern — SharpSports may indicate the payload is
  // too large and expects us to poll their BetSlips endpoint with
  // pagination. We ACK the notification here; the poller runs
  // separately.
  if (payload.paginated === true) {
    // TODO(reconciliation): enqueue a paginated fetch keyed by
    // payload.refreshResponse. For now the 202 response tells
    // SharpSports we understood.
    return NextResponse.json(
      { ok: true, mode: "paginated-ack", refreshResponse: payload.refreshResponse ?? null },
      { status: 202 },
    );
  }

  const slips = payload.betSlips ?? [];
  if (slips.length === 0) {
    return NextResponse.json({ ok: true, stored: 0 });
  }

  // Filter to slips that touch golf; SharpSports may push mixed
  // batches. Cheaper to filter here than in the parser.
  const golfy = slips.filter((s) =>
    (s.bets ?? []).some((b) => b.event?.sport === "Golf"),
  );
  if (golfy.length === 0) {
    // Not our sport — ACK but store nothing.
    return NextResponse.json({ ok: true, stored: 0, filtered: slips.length });
  }

  let ctx;
  try {
    ctx = await buildParseContext();
  } catch (err) {
    console.error("[sharpsports:webhook] context build failed:", err);
    return NextResponse.json(
      { ok: false, error: "internal" },
      { status: 500 },
    );
  }

  const parsed = golfy.map((s) => parseSlip(s, ctx));
  try {
    await saveSlips(parsed);
  } catch (err) {
    console.error("[sharpsports:webhook] save failed:", err);
    return NextResponse.json(
      { ok: false, error: "internal" },
      { status: 500 },
    );
  }

  // Touch last-refreshed marker on each unique account so the
  // reconciliation job can detect silent accounts.
  const uniqueAccounts = new Set(parsed.map((p) => p.bettorAccountId));
  await Promise.all(
    [...uniqueAccounts].map((aid) => markAccountRefreshed(aid).catch(() => null)),
  );

  const unknownCount = parsed.filter((p) => p.hasUnknownFields).length;
  return NextResponse.json({
    ok: true,
    stored: parsed.length,
    unknownFieldSlips: unknownCount,
    accountsTouched: uniqueAccounts.size,
  });
}
