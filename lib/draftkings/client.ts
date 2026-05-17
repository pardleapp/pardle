/**
 * DraftKings sportsbook client — public-readable JSON endpoints under
 * `sportsbook-nash.draftkings.com`. Used for top-X golf prop pricing
 * where Polymarket liquidity is thin.
 *
 * No auth required. Vercel data-centre IPs are US-based so no
 * geo-block (unlike Betfair, which 403s us). ToS is grey for
 * commercial-scale scraping but read-only polling at our cadence is
 * inside civilian-app envelope.
 *
 * Endpoint shape changes occasionally — keep the parser strict and
 * surface errors loudly rather than silently shipping nulls.
 *
 * Server-only.
 */

import "server-only";

const BASE = "https://sportsbook-nash.draftkings.com/api/sportscontent/dkusva";

async function dkFetch<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      // DK rejects requests without a UA that looks like a browser.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/123.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`DraftKings ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ──────────────────────────────────────────────────────────────────
// Event-group discovery — find the active golf tournament's eventGroupId
// ──────────────────────────────────────────────────────────────────

interface DKEventGroupNode {
  eventGroupId: number;
  eventGroupName: string;
  eventGroupStartDate?: string;
}

interface DKLeagueResponse {
  eventGroups?: DKEventGroupNode[];
}

export interface DKEventGroup {
  eventGroupId: number;
  name: string;
  startDate: string | null;
}

/**
 * Pull every active PGA Tour event group from DK. Each major / regular
 * tour stop becomes a separate event group with its own markets.
 * Caller matches by tournament name to find the active one.
 */
export async function listGolfEventGroups(): Promise<DKEventGroup[]> {
  // The PGA Tour league id on DK is 9 (subject to change; if discovery
  // fails this is the first place to look).
  const data = await dkFetch<DKLeagueResponse>(`/v1/leagues/9`);
  const groups = data.eventGroups ?? [];
  return groups.map((g) => ({
    eventGroupId: g.eventGroupId,
    name: g.eventGroupName,
    startDate: g.eventGroupStartDate ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────
// Market fetch — pull the top-X subcategories for an event group
// ──────────────────────────────────────────────────────────────────

interface DKOutcomeNode {
  label: string;
  oddsAmerican?: string;
  oddsDecimal?: string;
  oddsFractional?: string;
}

interface DKOfferNode {
  label: string;
  outcomes?: DKOutcomeNode[];
}

interface DKSubcategoryNode {
  subcategoryId: number;
  name: string;
  offers?: DKOfferNode[][];
}

interface DKCategoryNode {
  categoryId: number;
  name: string;
  componentizedOffers?: unknown;
  offerSubcategoryDescriptors?: DKSubcategoryNode[];
}

interface DKEventGroupResponse {
  eventGroup?: {
    offerCategories?: DKCategoryNode[];
  };
}

export interface DKTopFinishOdds {
  /** PGA Tour player display name, as DK lists it. */
  playerName: string;
  /** Decimal odds for finishing in the top N. */
  decimalOdds: number;
}

export interface DKTopFinishMarket {
  cutoff: 5 | 10 | 20;
  odds: DKTopFinishOdds[];
}

/** Parse the DK offer label into a cutoff number. */
function cutoffFromLabel(label: string): 5 | 10 | 20 | null {
  const norm = label.toLowerCase();
  if (norm.includes("top 5") || norm.includes("top-5")) return 5;
  if (norm.includes("top 10") || norm.includes("top-10")) return 10;
  if (norm.includes("top 20") || norm.includes("top-20")) return 20;
  return null;
}

/** Extract player name from a "Will <Player> finish top 5?" style label. */
function playerNameFromOutcomeLabel(label: string): string | null {
  // DK usually surfaces just the player name as the outcome label
  // (e.g. "Rory McIlroy"). Some events use a slightly fancier
  // template. Strip prefixes/suffixes and trim.
  return label.replace(/\s+/g, " ").trim() || null;
}

function decimalFromOutcome(o: DKOutcomeNode): number | null {
  if (o.oddsDecimal) {
    const n = Number(o.oddsDecimal);
    if (Number.isFinite(n) && n > 1) return n;
  }
  if (o.oddsAmerican) {
    const n = Number(o.oddsAmerican);
    if (Number.isFinite(n)) {
      return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
    }
  }
  if (o.oddsFractional) {
    const m = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(o.oddsFractional.trim());
    if (m) {
      const num = Number(m[1]);
      const den = Number(m[2]);
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
        return 1 + num / den;
      }
    }
  }
  return null;
}

/**
 * Pull the top-5, top-10 and top-20 markets for a tournament's event
 * group. Each market is a list of (player name, decimal odds). DK
 * doesn't always price all three — return only the cutoffs that
 * actually had a market.
 */
export async function getTopFinishMarkets(
  eventGroupId: number,
): Promise<DKTopFinishMarket[]> {
  const data = await dkFetch<DKEventGroupResponse>(
    `/v1/eventgroups/${eventGroupId}`,
  );
  const cats = data.eventGroup?.offerCategories ?? [];
  const out: DKTopFinishMarket[] = [];
  for (const cat of cats) {
    const subs = cat.offerSubcategoryDescriptors ?? [];
    for (const sub of subs) {
      const cutoff = cutoffFromLabel(sub.name);
      if (cutoff == null) continue;
      const odds: DKTopFinishOdds[] = [];
      for (const offerGroup of sub.offers ?? []) {
        for (const offer of offerGroup) {
          for (const outcome of offer.outcomes ?? []) {
            const name = playerNameFromOutcomeLabel(outcome.label);
            const dec = decimalFromOutcome(outcome);
            if (name && dec != null) {
              odds.push({ playerName: name, decimalOdds: dec });
            }
          }
        }
      }
      if (odds.length > 0) {
        out.push({ cutoff, odds });
      }
    }
  }
  return out;
}
