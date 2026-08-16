/**
 * POST /api/odds-compare/ingest
 *
 * Receives cross-book round-score quotes from Tom's home Playwright
 * scraper (see scripts/local-odds-scraper/). The scraper runs
 * FanDuel / Caesars / BetMGM in real Chrome from a residential IP —
 * the only path around Datadome's server-IP fingerprint block —
 * and POSTs the parsed quotes here. We validate a shared secret,
 * write per-book payloads into Redis, and the /api/odds-compare
 * aggregator merges them alongside the direct DK/Kalshi/DFS fetchers.
 *
 * Per-book TTL is 3 min: if the scraper stops posting (laptop
 * closed, book scraper broken), the aggregator's read stops seeing
 * that book within one poll cycle, so the UI honestly shows a
 * stale-column indicator rather than silently rendering hours-old
 * prices.
 */

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import type { BookKey, RoundScoreQuote } from "@/lib/odds-compare/types";
import {
  ingestKey,
  INGEST_TTL_SECONDS,
  INGEST_ALLOWED_BOOKS,
} from "@/lib/odds-compare/ingest-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();

interface IngestBody {
  book: string;
  quotes: unknown;
}

function isRoundScoreQuote(v: unknown): v is RoundScoreQuote {
  if (!v || typeof v !== "object") return false;
  const q = v as Record<string, unknown>;
  return (
    typeof q.book === "string" &&
    typeof q.playerName === "string" &&
    q.playerName.length > 0 &&
    typeof q.round === "number" &&
    q.round >= 1 &&
    q.round <= 4 &&
    typeof q.line === "number" &&
    Number.isFinite(q.line) &&
    (q.over == null || (typeof q.over === "number" && q.over > 1)) &&
    (q.under == null || (typeof q.under === "number" && q.under > 1)) &&
    typeof q.lastUpdatedAt === "string"
  );
}

export async function POST(req: Request) {
  const expectedSecret = process.env.ODDS_INGEST_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "ingest not configured" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-ingest-secret");
  if (!provided || provided !== expectedSecret) {
    // Constant-time compare skipped intentionally — this is a low-
    // sensitivity feed shim, not an auth-critical endpoint.
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const book = body.book as BookKey;
  if (!INGEST_ALLOWED_BOOKS.includes(book)) {
    return NextResponse.json(
      { ok: false, error: `book not accepted for ingest: ${book}` },
      { status: 400 },
    );
  }

  const raw = Array.isArray(body.quotes) ? body.quotes : [];
  const valid: RoundScoreQuote[] = [];
  const invalid: unknown[] = [];
  for (const q of raw) {
    if (isRoundScoreQuote(q) && q.book === book) valid.push(q);
    else invalid.push(q);
  }

  const payload = {
    book,
    receivedAt: new Date().toISOString(),
    quotes: valid,
  };
  try {
    await redis.set(ingestKey(book), payload, { ex: INGEST_TTL_SECONDS });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : "redis write failed",
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    book,
    accepted: valid.length,
    rejected: invalid.length,
  });
}
