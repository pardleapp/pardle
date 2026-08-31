/**
 * SharpSports REST client — for the endpoints we call OUT to (as
 * opposed to their inbound webhooks). Two use cases so far:
 *
 *   1. **BetSlips endpoint with pagination** — SharpSports returns
 *      202 on our webhook when the initial-dump payload is too large;
 *      we then poll this endpoint with a `refreshResponse` cursor to
 *      pull the slips.
 *   2. **Webhook Logs endpoint** — nightly reconciliation. Lists every
 *      webhook SharpSports sent and whether our receiver returned 2xx.
 *      Any non-2xx we haven't since caught up on gets re-fetched via
 *      the BetSlips endpoint.
 *
 * Auth: `SHARPSPORTS_API_KEY` env var (their standard Bearer token).
 * Base URL: `https://api.sharpsports.io/v1` — check their docs to
 * confirm; env-overridable via `SHARPSPORTS_API_BASE`.
 */

import type { SSBetSlip } from "./types";

const DEFAULT_BASE = "https://api.sharpsports.io/v1";

function apiBase(): string {
  return (process.env.SHARPSPORTS_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
}

function apiKey(): string {
  const k = process.env.SHARPSPORTS_API_KEY;
  if (!k) throw new Error("SHARPSPORTS_API_KEY is not set");
  return k;
}

async function ssFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey()}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SharpSports ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ── BetSlips (paginated fetch) ────────────────────────────────────

/** Response shape from the BetSlips endpoint. `next` cursor is null
 *  when we've reached the end. */
interface BetSlipsPage {
  results: SSBetSlip[];
  next: string | null;
}

/** Fetch every slip for a given refreshResponse cursor — used for
 *  the 202 initial-dump follow-up. Iterates until `next` is null,
 *  yielding one page at a time. */
export async function* iterateBetSlipsForRefresh(
  refreshResponse: string,
): AsyncGenerator<SSBetSlip[], void, void> {
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ refreshResponse });
    if (cursor) qs.set("cursor", cursor);
    const page = await ssFetch<BetSlipsPage>(`/betSlips?${qs.toString()}`);
    yield page.results ?? [];
    cursor = page.next;
  } while (cursor);
}

/** Fetch slips by bettor account for reconciliation. Same pagination
 *  contract. `since` filters to slips created after that ISO
 *  timestamp — used by the reconciliation cron to only pull recent
 *  activity, not the full history each run. */
export async function* iterateBetSlipsForAccount(
  bettorAccountId: string,
  since?: string,
): AsyncGenerator<SSBetSlip[], void, void> {
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ bettorAccount: bettorAccountId });
    if (since) qs.set("timePlacedGte", since);
    if (cursor) qs.set("cursor", cursor);
    const page = await ssFetch<BetSlipsPage>(`/betSlips?${qs.toString()}`);
    yield page.results ?? [];
    cursor = page.next;
  } while (cursor);
}

// ── Webhook Logs (reconciliation) ────────────────────────────────

/** One row of SharpSports' webhook-delivery log. Real field names
 *  to be verified against their docs (subscriber-only); the shape
 *  here matches typical webhook-log APIs — id, timestamp, our
 *  response status, and the source refreshResponse we can use to
 *  refetch the slips they tried to deliver. */
export interface WebhookLogEntry {
  id: string;
  timestamp: string; // ISO
  responseStatus: number;
  refreshResponse: string;
  bettorAccount?: string | null;
  eventType?: string;
  attempts?: number;
}

interface WebhookLogsPage {
  results: WebhookLogEntry[];
  next: string | null;
}

/** Pull the webhook-delivery log within a time window. Iterates
 *  pages so the caller can filter without holding the whole history
 *  in memory. */
export async function* iterateWebhookLogs(
  { since, until }: { since: string; until?: string },
): AsyncGenerator<WebhookLogEntry[], void, void> {
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ since });
    if (until) qs.set("until", until);
    if (cursor) qs.set("cursor", cursor);
    const page = await ssFetch<WebhookLogsPage>(`/webhookLogs?${qs.toString()}`);
    yield page.results ?? [];
    cursor = page.next;
  } while (cursor);
}
