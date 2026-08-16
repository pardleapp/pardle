/**
 * Common normalized types for the odds-compare tool.
 *
 * Every bookmaker source produces `RoundScoreQuote` records; the
 * aggregator groups them by (player, round, line) so the UI can
 * lay each book side-by-side and highlight the best price per
 * side.
 *
 * Odds always carried as decimal (2.0 = evens) — the UI can render
 * as American or fractional as a display choice. Decimal is the
 * only representation that survives arithmetic (implied prob =
 * 1/decimal) cleanly and matches DataGolf's convention.
 */

/** Sources the compare tool aggregates. Two flavours:
 *  - Direct: DK/PrizePicks/Underdog/Kalshi are reachable from Vercel
 *    via ScraperAPI / public APIs and fetched server-side.
 *  - Ingested: FanDuel/Caesars/BetMGM require a real-Chrome session
 *    from a residential IP (Datadome blocks server IPs). Those are
 *    scraped from a home Playwright runner and POSTed to
 *    /api/odds-compare/ingest, then merged in by the aggregator. */
export type BookKey =
  | "draftkings"
  | "fanduel"
  | "caesars"
  | "betmgm"
  | "prizepicks"
  | "underdog"
  | "kalshi";

export interface BookMeta {
  key: BookKey;
  label: string;
  /** Short tag under the column header explaining the source
   *  class — bettors read "sportsbook" vs "DFS pick'em" vs
   *  "exchange" differently. */
  kindLabel: string;
}

export const BOOKS: BookMeta[] = [
  { key: "draftkings", label: "DraftKings", kindLabel: "Sportsbook" },
  { key: "fanduel", label: "FanDuel", kindLabel: "Sportsbook" },
  { key: "caesars", label: "Caesars", kindLabel: "Sportsbook" },
  { key: "betmgm", label: "BetMGM", kindLabel: "Sportsbook" },
  { key: "prizepicks", label: "PrizePicks", kindLabel: "DFS pick'em" },
  { key: "underdog", label: "Underdog", kindLabel: "DFS pick'em" },
  { key: "kalshi", label: "Kalshi", kindLabel: "Exchange" },
];

/** One O/U price on a specific round-score line at one book. */
export interface RoundScoreQuote {
  book: BookKey;
  /** Player display name as the book lists it. Aggregator resolves
   *  to a canonical playerId separately. */
  playerName: string;
  /** Round number 1-4. */
  round: number;
  /** Half-integer line, e.g. 67.5. Books occasionally post a whole
   *  number ("even at 68") — we keep the raw value and let the UI
   *  render it. */
  line: number;
  /** Decimal odds for the OVER. Null when the book only prices one
   *  side. */
  over: number | null;
  /** Decimal odds for the UNDER. */
  under: number | null;
  /** When the book last updated this line (ISO 8601). Powers the
   *  "changed just now" pulse on the table. */
  lastUpdatedAt: string;
}

/** Aggregator-level record: one player + one line, all books that
 *  price it stacked as an array of quotes. */
export interface CompareRow {
  playerName: string;
  /** Best-effort canonical id when we resolve; falls back to the
   *  book's raw name when we can't match. */
  playerId?: string;
  round: number;
  line: number;
  quotes: RoundScoreQuote[];
}

/** Full API response for the compare page. */
export interface OddsCompareResponse {
  ok: boolean;
  tournamentId: string | null;
  tournamentName: string | null;
  round: number;
  generatedAt: string;
  /** Per-book fetch health: helps the UI badge a source as stale /
   *  missing rather than silently hiding it. */
  bookStatus: Record<
    BookKey,
    { ok: boolean; error?: string; playerCount: number }
  >;
  rows: CompareRow[];
}
