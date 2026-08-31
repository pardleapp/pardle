/**
 * GET /api/sharpsports/reconcile
 *
 * Nightly reconciliation — pulls the SharpSports webhook-delivery log
 * for the last window, spots any webhook they SAY they sent that our
 * receiver acked with a non-2xx (or that we don't have in our slip
 * store), and re-fetches those slips via the BetSlips endpoint.
 *
 * Why we need this: SharpSports doesn't retry failed webhooks (per
 * their reply, point 9). If our receiver was down for 30 minutes,
 * every slip they tried to deliver in that window is dropped
 * silently. This cron reads their log, filters to any status !=
 * 2xx, and re-fetches those slips using `refreshResponse` cursors so
 * every dropped slip lands eventually.
 *
 * Runs on Vercel cron once a day. Idempotent — re-fetched slips
 * just overwrite the existing entry with the latest state.
 *
 * Guarded by `SHARPSPORTS_API_KEY` — a no-op when SharpSports isn't
 * wired up yet.
 */

import { NextResponse } from "next/server";
import { iterateWebhookLogs, iterateBetSlipsForRefresh } from "@/lib/sharpsports/api-client";
import { parseSlip } from "@/lib/sharpsports/parser";
import { buildParseContext } from "@/lib/sharpsports/lookups";
import { saveSlips } from "@/lib/sharpsports/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
// Reconciliation may fan out a lot of paginated fetches on a bad
// day; give it headroom.
export const maxDuration = 300;

interface ReconcileSummary {
  ok: boolean;
  scannedLogs: number;
  failedDeliveries: number;
  refetchedSlips: number;
  parsedSlips: number;
  storedSlips: number;
  unknownFieldSlips: number;
  skipped?: string;
  errors?: string[];
}

export async function GET() {
  if (!process.env.SHARPSPORTS_API_KEY) {
    return NextResponse.json<ReconcileSummary>({
      ok: true,
      scannedLogs: 0,
      failedDeliveries: 0,
      refetchedSlips: 0,
      parsedSlips: 0,
      storedSlips: 0,
      unknownFieldSlips: 0,
      skipped: "SHARPSPORTS_API_KEY not configured",
    });
  }

  const summary: ReconcileSummary = {
    ok: true,
    scannedLogs: 0,
    failedDeliveries: 0,
    refetchedSlips: 0,
    parsedSlips: 0,
    storedSlips: 0,
    unknownFieldSlips: 0,
    errors: [],
  };

  // Look back 36 hours. Cron runs daily, so 36h gives us a healthy
  // overlap window in case one run is skipped (or the cron drifts).
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

  // 1. Scan the delivery log and collect any refreshResponse cursors
  //    with a non-2xx response we need to catch up on.
  const failedRefreshes = new Set<string>();
  try {
    for await (const page of iterateWebhookLogs({ since })) {
      for (const entry of page) {
        summary.scannedLogs++;
        if (entry.responseStatus < 200 || entry.responseStatus >= 300) {
          summary.failedDeliveries++;
          if (entry.refreshResponse) failedRefreshes.add(entry.refreshResponse);
        }
      }
    }
  } catch (err) {
    summary.ok = false;
    summary.errors!.push(
      `webhook-logs fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(summary, { status: 500 });
  }

  if (failedRefreshes.size === 0) {
    return NextResponse.json(summary);
  }

  // 2. Build parse context once — shared across all re-fetches.
  const ctx = await buildParseContext().catch((err) => {
    summary.errors!.push(
      `context build failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  });
  if (!ctx) {
    summary.ok = false;
    return NextResponse.json(summary, { status: 500 });
  }

  // 3. For each failed refresh, iterate the BetSlips endpoint and
  //    re-store. Parse errors on a single slip don't stop the batch.
  for (const refresh of failedRefreshes) {
    try {
      for await (const page of iterateBetSlipsForRefresh(refresh)) {
        summary.refetchedSlips += page.length;
        const golfy = page.filter((s) =>
          (s.bets ?? []).some((b) => b.event?.sport === "Golf"),
        );
        if (golfy.length === 0) continue;
        const parsed = golfy.map((s) => parseSlip(s, ctx));
        summary.parsedSlips += parsed.length;
        summary.unknownFieldSlips += parsed.filter((p) => p.hasUnknownFields).length;
        await saveSlips(parsed);
        summary.storedSlips += parsed.length;
      }
    } catch (err) {
      summary.errors!.push(
        `refresh ${refresh}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return NextResponse.json(summary);
}
