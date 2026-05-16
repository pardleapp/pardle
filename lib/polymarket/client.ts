/**
 * Polymarket gamma-api client (read-only).
 *
 * Polymarket is a public prediction-market exchange (built on
 * Polygon). The gamma-api returns event + market data with no auth
 * and no geo-block, which is why it works from Vercel's data centers
 * where Betfair's edge refuses requests with HTTP 403.
 *
 * For Pardle we use ONE endpoint:
 *   GET https://gamma-api.polymarket.com/events/{id}
 *
 * The event for a golf major like "2026 PGA Championship Winner" has
 * ~120 child markets, one yes/no per player. The `lastTradePrice` on
 * each child is the latest implied win probability for that player.
 * Decimal odds = 1 / lastTradePrice.
 */

import "server-only";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

export interface PolymarketEventSummary {
  id: number;
  title: string;
  slug?: string;
  volume?: number;
  liquidity?: number;
  closed?: boolean;
}

export interface PolymarketChildMarket {
  id: string;
  question: string;
  /** "yes" implied probability — last traded price, in [0, 1]. May be null if no trades yet. */
  lastTradePrice: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  volume?: number;
}

export interface PolymarketEvent extends PolymarketEventSummary {
  markets: PolymarketChildMarket[];
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    throw new Error(`Polymarket ${url} returned ${r.status}: ${await r.text()}`);
  }
  return (await r.json()) as T;
}

/** List active golf-tagged events (the winner markets for current tournaments). */
export async function listGolfEvents(): Promise<PolymarketEventSummary[]> {
  const data = await getJson<unknown>(
    `${GAMMA_BASE}/events?tag_slug=golf&active=true&closed=false&limit=100`,
  );
  const evs = Array.isArray(data)
    ? (data as PolymarketEventSummary[])
    : ((data as { data?: PolymarketEventSummary[] }).data ?? []);
  return evs;
}

/** Full event with child markets (one per player). */
export async function getEvent(eventId: number | string): Promise<PolymarketEvent> {
  // The raw response is fairly noisy — extract just the bits we need.
  // Polymarket sends prices as numeric strings; coerce to number here.
  const raw = await getJson<{
    id: number;
    title: string;
    slug?: string;
    volume?: number | string;
    liquidity?: number | string;
    closed?: boolean;
    markets?: {
      id: string;
      question: string;
      lastTradePrice?: number | string | null;
      bestBid?: number | string | null;
      bestAsk?: number | string | null;
      volume?: number | string;
    }[];
  }>(`${GAMMA_BASE}/events/${eventId}`);

  const num = (v: number | string | null | undefined): number | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    id: raw.id,
    title: raw.title,
    slug: raw.slug,
    volume: num(raw.volume) ?? undefined,
    liquidity: num(raw.liquidity) ?? undefined,
    closed: raw.closed,
    markets: (raw.markets ?? []).map((m) => ({
      id: m.id,
      question: m.question,
      lastTradePrice: num(m.lastTradePrice),
      bestBid: num(m.bestBid),
      bestAsk: num(m.bestAsk),
      volume: num(m.volume) ?? undefined,
    })),
  };
}

/**
 * Best mid-price estimate for a child market in decimal odds form
 * (1/p). Falls back through lastTradePrice → bestAsk → bestBid, since
 * a market with no trades but a live book is still useful. Returns
 * null when none of those are available.
 */
export function midOddsFromMarket(m: PolymarketChildMarket): number | null {
  // Prefer mid-of-book if we have both sides; otherwise lastTraded;
  // otherwise either single side. All probabilities in [0,1].
  let probability: number | null = null;
  if (m.bestBid != null && m.bestAsk != null) {
    probability = (m.bestBid + m.bestAsk) / 2;
  } else {
    probability = m.lastTradePrice ?? m.bestAsk ?? m.bestBid ?? null;
  }
  if (probability == null || probability <= 0 || probability >= 1) return null;
  return 1 / probability;
}
