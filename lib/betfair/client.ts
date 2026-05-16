/**
 * Betfair Exchange REST client (read-only).
 *
 * Ported from betvalueproject/src/lib/betfair.ts which itself was
 * ported from golf-model. Only the read paths we need for live-odds
 * display: login, market catalogue, market book.
 *
 * The Betfair API is a paid commercial product. We rely on a
 * personal/developer account; rate limits are generous for read calls
 * but we still poll once per minute (via cron) rather than per
 * request.
 */

import "server-only";

const LOGIN_URL = "https://identitysso.betfair.com/api/login";
const BASE_URL = "https://api.betfair.com/exchange/betting/rest/v1.0";

export interface PriceSize {
  price: number;
  size: number;
}

export interface RunnerBook {
  selectionId: number;
  status: string;
  lastPriceTraded?: number;
  ex: {
    availableToBack: PriceSize[];
    availableToLay: PriceSize[];
    tradedVolume: PriceSize[];
  };
}

export interface MarketBook {
  marketId: string;
  status: string;
  inplay: boolean;
  totalMatched: number;
  runners: RunnerBook[];
}

export interface RunnerCatalog {
  selectionId: number;
  runnerName: string;
  handicap: number;
  sortPriority: number;
}

export interface MarketCatalogue {
  marketId: string;
  marketName: string;
  marketStartTime?: string;
  event?: { id: string; name: string };
  runners: RunnerCatalog[];
}

export interface EventResult {
  event: {
    id: string;
    name: string;
    countryCode?: string;
    timezone?: string;
    openDate?: string;
  };
  marketCount: number;
}

export class BetfairAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BetfairAuthError";
  }
}

export class BetfairApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "BetfairApiError";
  }
}

export interface Auth {
  appKey: string;
  sessionToken: string;
}

/** Login. Returns a session token; throws BetfairAuthError on failure. */
export async function login(opts: {
  appKey: string;
  username: string;
  password: string;
}): Promise<string> {
  const body = new URLSearchParams({
    username: opts.username,
    password: opts.password,
  });
  const r = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "X-Application": opts.appKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const raw = await r.text();
  let data: { status?: string; token?: string; error?: string };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    // HTML error pages indicate the endpoint refused the request at
    // the protocol layer (typically a Betfair geo-block on non-UK IPs).
    // Surface a short preview so the caller can diagnose.
    const preview = raw.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new BetfairAuthError(
      `Login endpoint returned non-JSON (HTTP ${r.status}): ${preview}…`,
    );
  }
  if (data.status !== "SUCCESS" || !data.token) {
    throw new BetfairAuthError(`Login failed: ${data.error ?? data.status}`);
  }
  return data.token;
}

async function call<T>(
  endpoint: string,
  body: unknown,
  auth: Auth,
): Promise<T> {
  const r = await fetch(`${BASE_URL}/${endpoint}/`, {
    method: "POST",
    headers: {
      "X-Application": auth.appKey,
      "X-Authentication": auth.sessionToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new BetfairApiError(
      `${endpoint} returned ${r.status}: ${await r.text()}`,
      r.status,
    );
  }
  return (await r.json()) as T;
}

/** Golf events (eventTypeId=3) from Betfair. */
export async function listGolfEvents(auth: Auth): Promise<EventResult[]> {
  return call("listEvents", { filter: { eventTypeIds: ["3"] } }, auth);
}

export interface ListMarketCatalogueOpts {
  eventId?: string;
  marketIds?: string[];
  marketTypeCodes?: string[];
  maxResults?: number;
}

export async function listMarketCatalogue(
  auth: Auth,
  opts: ListMarketCatalogueOpts,
): Promise<MarketCatalogue[]> {
  const filter: Record<string, unknown> = {};
  if (opts.eventId) filter.eventIds = [opts.eventId];
  if (opts.marketIds) filter.marketIds = opts.marketIds;
  if (opts.marketTypeCodes) filter.marketTypeCodes = opts.marketTypeCodes;
  return call(
    "listMarketCatalogue",
    {
      filter,
      maxResults: opts.maxResults ?? 25,
      marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME", "EVENT"],
    },
    auth,
  );
}

export async function listMarketBook(
  auth: Auth,
  marketIds: string[],
): Promise<MarketBook[]> {
  return call(
    "listMarketBook",
    {
      marketIds,
      priceProjection: {
        priceData: ["EX_BEST_OFFERS"],
        virtualise: true,
        exBestOffersOverrides: { bestPricesDepth: 3 },
      },
    },
    auth,
  );
}

/** Mid-price (best back + best lay) / 2 in decimal odds. Null if no book. */
export function midPrice(runner: RunnerBook): number | null {
  const back = runner.ex.availableToBack[0]?.price ?? null;
  const lay = runner.ex.availableToLay[0]?.price ?? null;
  if (back != null && lay != null) return (back + lay) / 2;
  return back ?? lay ?? null;
}
