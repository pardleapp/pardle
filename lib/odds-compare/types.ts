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

export type BookKey =
  | "draftkings"
  | "fanduel"
  | "caesars"
  | "betmgm"
  | "kalshi";

export interface BookMeta {
  key: BookKey;
  label: string;
}

export const BOOKS: BookMeta[] = [
  { key: "draftkings", label: "DraftKings" },
  { key: "fanduel", label: "FanDuel" },
  { key: "caesars", label: "Caesars" },
  { key: "betmgm", label: "BetMGM" },
  { key: "kalshi", label: "Kalshi" },
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
