/**
 * Shared helper for the odds-compare ingest pipeline. Kept out of
 * app/api/odds-compare/ingest/route.ts because Next.js's App Router
 * only registers route.ts files that export nothing but HTTP
 * handlers — exporting a helper from one and importing it into
 * a sibling route file de-registers it and the URL 404s.
 */
import type { BookKey } from "./types";

/** Redis key for one book's most-recent ingest payload. Read by
 *  the aggregator, written by /api/odds-compare/ingest. */
export function ingestKey(book: BookKey): string {
  return `feed:odds-compare:ingest:v1:${book}`;
}

/** TTL long enough to survive one missed poll but short enough
 *  that a genuinely-dead scraper drops out of the aggregator
 *  inside a couple of minutes. */
export const INGEST_TTL_SECONDS = 180;

export const INGEST_ALLOWED_BOOKS: BookKey[] = [
  "fanduel",
  "caesars",
  "betmgm",
];
