/**
 * Kalshi round-score fetcher.
 *
 * Kalshi is a prediction-market exchange. Round scores live in one
 * series, KXPGAROUNDSCORE: one contract per player per round, titled
 * "Will Ryan Gerard shoot under 67.5 in Round 1?", so YES = under and
 * NO = over. Open contracts are only ever the current PGA Tour event.
 *
 * Public API, no auth, no proxy needed.
 */

import "server-only";
import type { BookKey, RoundScoreQuote } from "../types";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES = "KXPGAROUNDSCORE";

/** An ask this high means nobody is really offering the side (the book
 *  is a 4c bid against a 95c ask), so it isn't a price worth comparing. */
const MAX_ASK = 0.9;

export interface KalshiMarket {
  ticker: string;
  title?: string;
  yes_ask_dollars?: string;
  no_ask_dollars?: string;
  yes_bid_dollars?: string;
}

function askToDecimal(ask: string | undefined): number | null {
  const p = Number(ask);
  if (!Number.isFinite(p) || p <= 0 || p > MAX_ASK) return null;
  return 1 / p;
}

function parseTitle(
  title: string,
): { player: string; round: number; line: number } | null {
  const m = title.match(/^Will\s+(.+?)\s+shoot\s+under\s+(\d+(?:\.\d+)?)\s+in\s+Round\s+(\d)/i);
  if (!m) return null;
  const round = Number(m[3]);
  if (round < 1 || round > 4) return null;
  return { player: m[1].trim(), round, line: Number(m[2]) };
}

export function quotesFromMarkets(
  markets: KalshiMarket[],
  round: number,
  now: string,
): RoundScoreQuote[] {
  const BOOK: BookKey = "kalshi";
  const out: RoundScoreQuote[] = [];
  for (const m of markets) {
    const parsed = parseTitle(m.title ?? "");
    if (!parsed || parsed.round !== round) continue;
    const under = askToDecimal(m.yes_ask_dollars);
    const over = askToDecimal(m.no_ask_dollars);
    if (under == null && over == null) continue;
    out.push({
      book: BOOK,
      playerName: parsed.player,
      round,
      line: parsed.line,
      over,
      under,
      lastUpdatedAt: now,
    });
  }
  return out;
}

export async function fetchKalshiRoundScoreQuotes(
  round: number,
): Promise<RoundScoreQuote[]> {
  const res = await fetch(
    `${BASE}/markets?series_ticker=${SERIES}&status=open&limit=1000`,
    { cache: "no-store", headers: { "User-Agent": "pardle-odds-compare/1.0" } },
  );
  if (!res.ok) throw new Error(`Kalshi ${res.status}`);
  const j = (await res.json()) as { markets?: KalshiMarket[] };
  return quotesFromMarkets(j.markets ?? [], round, new Date().toISOString());
}
