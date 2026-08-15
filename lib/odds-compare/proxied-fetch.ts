/**
 * Residential proxy wrapper for bookmaker fetches.
 *
 * Sportsbooks (DK, FD, Caesars, BetMGM) have started 403-ing
 * data-centre IPs at the Akamai/Cloudflare edge — Vercel's whole
 * fleet is one such range. Route those requests through a
 * residential proxy so the bookmaker sees a home ISP.
 *
 * Provider: ScraperAPI (scraperapi.com) — the simplest possible
 * integration. Send `?api_key=KEY&url=<URL>&country_code=us` and
 * they handle proxy selection, retry, CAPTCHA. Also supports
 * `render=false` (we don't need JS execution) and `keep_headers=true`
 * so our User-Agent + Accept propagate through.
 *
 * Falls back to direct fetch when SCRAPER_API_KEY isn't set — the
 * DK/FD sources call this same wrapper regardless, so local dev
 * without a key still runs (usually 403s but the code path is
 * exercised).
 *
 * Server-only.
 */

import "server-only";

const SA_ENDPOINT = "https://api.scraperapi.com/";

/** Wrap a bookmaker URL fetch. Automatically routes through
 *  ScraperAPI when the env var is set, else direct. Callers should
 *  handle 403s + non-2xx the same way as with `fetch`. */
export async function proxiedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) {
    return fetch(url, { ...init, cache: "no-store" });
  }
  // ScraperAPI wraps the target URL. `country_code=us` pins us to
  // a US residential exit so bookies serve US-visible markets.
  // `keep_headers=true` forwards our headers (UA, Accept) to the
  // target. `render=false` skips their headless browser — the
  // bookie APIs return JSON, we don't need HTML rendering.
  const params = new URLSearchParams({
    api_key: key,
    url,
    country_code: "us",
    keep_headers: "true",
    render: "false",
  });
  const proxyUrl = `${SA_ENDPOINT}?${params.toString()}`;
  return fetch(proxyUrl, {
    ...init,
    cache: "no-store",
    // ScraperAPI can take 15-60s on hard-to-fetch pages; give it
    // room. Our aggregator has its own outer deadline.
    signal: init?.signal ?? AbortSignal.timeout(45_000),
  });
}

/** Diagnostic: is the proxy configured? Surfaced in bookStatus so
 *  the UI can show "not configured" vs "configured but blocked". */
export function proxyConfigured(): boolean {
  return typeof process.env.SCRAPER_API_KEY === "string" &&
    process.env.SCRAPER_API_KEY.length > 0;
}
