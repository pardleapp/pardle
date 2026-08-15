/**
 * Kalshi round-score fetcher.
 *
 * Kalshi is a prediction-market exchange rather than a sportsbook,
 * so their per-tournament coverage of round-score contracts is
 * thin (mostly majors and rare high-profile events). For 90% of
 * PGA weeks this returns an empty list — the aggregator surfaces
 * that as a dashed column, which is honest.
 *
 * When a contract IS available, it looks like:
 *   Ticker: KXPGARDSCORE-<TOURNAMENT>-<PLAYER>-R<N>-<LINE>
 *   Two sides: YES + NO with prices in cents (0-100)
 *
 * We normalise the YES price to a decimal-odds Over and NO to a
 * decimal-odds Under. Kalshi's convention: YES = "player will
 * score UNDER the line" is the common phrasing on their contracts
 * (they typically frame "player finishes under X strokes"). Check
 * the market question at read-time to invert if needed.
 *
 * Public API — no auth, no proxy needed.
 */

import "server-only";
import type { BookKey, RoundScoreQuote } from "../types";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";

interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title?: string;
  yes_sub_title?: string;
  status?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
}
interface KalshiMarketsResponse {
  cursor?: string;
  markets?: KalshiMarket[];
}

/** Convert Kalshi's cents-price (0-100) to decimal odds. A YES
 *  contract trading at 60 cents implies 60% probability → decimal
 *  odds 1.667. */
function priceToDecimal(cents: number | undefined): number | null {
  if (cents == null || !Number.isFinite(cents) || cents <= 0 || cents >= 100) {
    return null;
  }
  const prob = cents / 100;
  return 1 / prob;
}

/** Parse the round + player + line out of Kalshi's contract
 *  metadata. Kalshi uses long human-readable titles like
 *  "Will Scottie Scheffler shoot under 68 in Round 3 of FedEx
 *  St. Jude Championship?". Regex-parse to structured. */
function parseTitle(title: string): {
  player: string;
  round: number;
  line: number;
} | null {
  const m = title.match(
    /Will\s+([A-Z][A-Za-z.\-'\s]+?)\s+shoot\s+(over|under)\s+(\d+(?:\.\d+)?)\s+in\s+Round\s+(\d)/i,
  );
  if (!m) return null;
  const line = Number(m[3]);
  const round = Number(m[4]);
  if (round < 1 || round > 4) return null;
  return { player: m[1].trim(), round, line };
}

/** Search Kalshi for a tournament's markets. Filters events by
 *  ticker prefix (KXPGA*, KXSTJUDE*, tournament-name substring).
 *  Returns any round-score contracts on that tournament. */
export async function fetchKalshiRoundScoreQuotes(
  tournamentName: string,
  round: number,
): Promise<RoundScoreQuote[]> {
  // First: find events tagged for this tournament.
  const target = tournamentName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const res = await fetch(
    `${BASE}/events?category=Sports&limit=200`,
    {
      cache: "no-store",
      headers: {
        "User-Agent": "pardle-odds-compare/1.0",
      },
    },
  );
  if (!res.ok) return [];
  const j = (await res.json()) as {
    events?: Array<{
      event_ticker: string;
      title?: string;
      sub_title?: string;
      status?: string;
    }>;
  };
  const matchedEvents = (j.events ?? []).filter((e) => {
    const hay = `${e.event_ticker} ${e.title ?? ""} ${e.sub_title ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return hay.includes(target);
  });
  if (matchedEvents.length === 0) return [];

  // Then pull each event's markets and parse round-score contracts.
  const BOOK: BookKey = "kalshi";
  const now = new Date().toISOString();
  const out: RoundScoreQuote[] = [];
  for (const ev of matchedEvents) {
    const mres = await fetch(
      `${BASE}/markets?event_ticker=${encodeURIComponent(ev.event_ticker)}&limit=200`,
      { cache: "no-store", headers: { "User-Agent": "pardle-odds-compare/1.0" } },
    );
    if (!mres.ok) continue;
    const mj = (await mres.json()) as KalshiMarketsResponse;
    for (const m of mj.markets ?? []) {
      if (m.status !== "active") continue;
      const parsed = parseTitle(m.title ?? "");
      if (!parsed) continue;
      if (parsed.round !== round) continue;
      // Kalshi's YES-title usually reads "Under X" — YES = under,
      // NO = over. Use the yes/no *ask* prices (what you'd pay to
      // buy that side) converted to decimal odds.
      const underDec = priceToDecimal(m.yes_ask);
      const overDec = priceToDecimal(m.no_ask);
      out.push({
        book: BOOK,
        playerName: parsed.player,
        round: parsed.round,
        line: parsed.line,
        over: overDec,
        under: underDec,
        lastUpdatedAt: now,
      });
    }
  }
  return out;
}
