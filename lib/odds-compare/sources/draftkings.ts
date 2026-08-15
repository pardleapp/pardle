/**
 * DraftKings round-score O/U fetcher.
 *
 * Endpoint tree (as of 2026-08 discovery via proxied fetch):
 *   /api/sportscontent/dkuswv/v1/leagues/{leagueId}/categories/1129
 *
 * `dkuswv` is the West-Virginia state slug — the DK sportsbook API
 * shards by regulated jurisdiction, and WV is the one ScraperAPI's
 * US residential pool exits through. Other state slugs (dkusva,
 * dkusnj, dkusny) return the same market data but sometimes 404
 * depending on which state the exit IP resolves to; dkuswv is
 * stable across every exit we've tested.
 *
 * Category 1129 = "Round Props". Within it, subcategoryId 11786 is
 * "Player Round Score" — the round-score O/U pool we want.
 *
 * Response schema is flat: {events, markets, selections}. Markets
 * carry name ("Corey Conners Player Round Score - Round 2 O/U"),
 * subcategoryId, eventId. Selections join to markets via marketId
 * and carry (label: "Over"|"Under", points: 68.5, displayOdds).
 *
 * League ids are per-tournament and change every week; we discover
 * the current one by scanning DK's golf league list for a fuzzy
 * name match.
 */

import "server-only";
import type { BookKey, RoundScoreQuote } from "../types";
import { proxiedFetch } from "../proxied-fetch";

const BASE = "https://sportsbook-nash.draftkings.com/api/sportscontent/dkuswv";
const GOLF_SPORT_ID = "12";
/** Category id for "Round Props" — parent of the round-score O/U
 *  subcategory. Constants pinned to what the discovery pass on
 *  2026-08 returned; if DK reshuffles their taxonomy the fetch
 *  will surface as zero-quotes and the debug endpoint reveals the
 *  new tree. */
const ROUND_PROPS_CATEGORY_ID = "1129";
/** Subcategory id for "Player Round Score" O/U. */
const PLAYER_ROUND_SCORE_SUBCATEGORY_ID = 11786;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/123.0.0.0 Safari/537.36";

async function dkFetch<T>(path: string): Promise<T> {
  const res = await proxiedFetch(`${BASE}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `DraftKings ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

interface DKSelection {
  id: string;
  marketId: string;
  label: string; // "Over" | "Under"
  displayOdds?: {
    american?: string;
    decimal?: string;
    fractional?: string;
  };
  trueOdds?: number;
  points?: number;
  outcomeType?: string;
  participants?: Array<{ name?: string }>;
}
interface DKMarket {
  id: string;
  eventId: string;
  leagueId: string;
  name: string;
  subcategoryId?: number;
  isSuspended?: boolean;
  marketType?: { id?: string; name?: string };
}
interface DKEvent {
  id: string;
  name?: string;
  startEventDate?: string;
}
interface DKCategoryPayload {
  markets?: DKMarket[];
  selections?: DKSelection[];
  events?: DKEvent[];
}

/** Discover the current DK leagueId for a tournament by scraping
 *  the /leagues/golf SPA page — it embeds a
 *  { eventGroupId, eventGroupName } tuple per active tournament in
 *  the initial state blob. One HTML request per week is cheap and
 *  survives DK's periodic API-tree shuffles.
 *
 *  Falls back to null when no fuzzy match — the aggregator surfaces
 *  that as bookStatus.draftkings.ok=false so we know to look. */
export async function findLeagueId(tournamentName: string): Promise<number | null> {
  const target = tournamentName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const res = await proxiedFetch("https://sportsbook.draftkings.com/leagues/golf", {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  // Match "eventGroupId":41404,"eventGroupName":"FedEx St. Jude Championship"
  const pairRe = /"eventGroupId":(\d+),"eventGroupName":"([^"]+)"/g;
  let best: { id: number; name: string } | null = null;
  for (const m of html.matchAll(pairRe)) {
    const id = Number(m[1]);
    const name = m[2];
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!norm) continue;
    if (norm.includes(target) || target.includes(norm)) {
      best = { id, name };
      break;
    }
  }
  return best?.id ?? null;
}

/** Parse the round number out of a market name. DK's naming is
 *  consistent: "<Player> Player Round Score - Round N O/U" or
 *  "<Player> - Round N O/U". */
function roundFromMarketName(name: string): number | null {
  const m = name.match(/round\s*(\d)/i);
  if (!m) return null;
  const r = Number(m[1]);
  return r >= 1 && r <= 4 ? r : null;
}

/** Extract player name from a market name. Strips the trailing
 *  " - Round N O/U" and any "Player Round Score" / "Birdies or
 *  Better" tag. */
function playerFromMarketName(name: string): string | null {
  const cleaned = name
    .replace(/\s*-\s*Round\s*\d\s*(?:O\/?U)?\s*$/i, "")
    .replace(/\s*Player\s+Round\s+Score\s*$/i, "")
    .replace(/\s*Birdies\s+or\s+Better\s*$/i, "")
    .replace(/\s*O\/?U\s*$/i, "")
    .trim();
  return cleaned || null;
}

function decimalFromSelection(s: DKSelection): number | null {
  if (typeof s.trueOdds === "number" && s.trueOdds > 1) return s.trueOdds;
  const d = s.displayOdds?.decimal;
  if (d) {
    const n = Number(d);
    if (Number.isFinite(n) && n > 1) return n;
  }
  const a = s.displayOdds?.american;
  if (a) {
    const n = Number(a);
    if (Number.isFinite(n)) return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  }
  return null;
}

/** Fetch all Player Round Score O/U quotes for one round of a
 *  tournament. Returns empty when DK hasn't posted the market
 *  yet (common on late-round days before tee times). */
export async function fetchDkRoundScoreQuotes(
  leagueId: number,
  round: number,
): Promise<RoundScoreQuote[]> {
  // Hitting /categories/1129 alone returns whatever DK's default
  // subcategory tab is (usually Birdies-or-Better). To get the
  // Player Round Score markets we have to specify the subcategory
  // explicitly in the URL path.
  const data = await dkFetch<DKCategoryPayload>(
    `/v1/leagues/${leagueId}/categories/${ROUND_PROPS_CATEGORY_ID}/subcategories/${PLAYER_ROUND_SCORE_SUBCATEGORY_ID}`,
  );
  const markets = data.markets ?? [];
  const selections = data.selections ?? [];
  const BOOK: BookKey = "draftkings";
  const now = new Date().toISOString();

  // Filter markets to Player Round Score for the requested round.
  const targetMarkets = new Map<string, { player: string }>();
  for (const m of markets) {
    if (m.subcategoryId !== PLAYER_ROUND_SCORE_SUBCATEGORY_ID) continue;
    if (m.isSuspended) continue;
    const r = roundFromMarketName(m.name);
    if (r !== round) continue;
    const player = playerFromMarketName(m.name);
    if (!player) continue;
    targetMarkets.set(m.id, { player });
  }

  // Group selections by marketId, pair the Over + Under.
  const grouped = new Map<
    string,
    { over?: DKSelection; under?: DKSelection; line?: number }
  >();
  for (const sel of selections) {
    if (!targetMarkets.has(sel.marketId)) continue;
    const bucket = grouped.get(sel.marketId) ?? {};
    if (sel.label?.toLowerCase() === "over") bucket.over = sel;
    if (sel.label?.toLowerCase() === "under") bucket.under = sel;
    if (bucket.line == null && typeof sel.points === "number") {
      bucket.line = sel.points;
    }
    grouped.set(sel.marketId, bucket);
  }

  const out: RoundScoreQuote[] = [];
  for (const [marketId, { over, under, line }] of grouped) {
    if (line == null) continue;
    const meta = targetMarkets.get(marketId);
    if (!meta) continue;
    // Prefer selection.participants[0].name over the parsed market
    // name when present — it's the canonical form.
    const participantName =
      over?.participants?.[0]?.name ??
      under?.participants?.[0]?.name ??
      meta.player;
    out.push({
      book: BOOK,
      playerName: participantName,
      round,
      line,
      over: over ? decimalFromSelection(over) : null,
      under: under ? decimalFromSelection(under) : null,
      lastUpdatedAt: now,
    });
  }
  return out;
}
