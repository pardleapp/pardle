/**
 * Temporary: fetches a book's JSON through the US proxy so a new source
 * can be written against its real payload. Hosts are allowlisted and the
 * ingest secret is required. Delete once the sources are in.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HOSTS = new Set([
  "api.americanwagering.com",
  "sports.nj.betmgm.com",
  "sports.pa.betmgm.com",
  "www.betmgm.com",
  "api.underdogfantasy.com",
  "partner-api.prizepicks.com",
  "api.prizepicks.com",
  "sbapi.nj.sportsbook.fanduel.com",
]);

export async function GET(req: Request) {
  if (req.headers.get("x-ingest-secret") !== process.env.ODDS_INGEST_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const u = new URL(req.url);
  const target = u.searchParams.get("url") ?? "";
  let host = "";
  try {
    host = new URL(target).hostname;
  } catch {
    /* rejected below */
  }
  if (!HOSTS.has(host)) return NextResponse.json({ ok: false }, { status: 400 });
  const params = new URLSearchParams({
    api_key: process.env.SCRAPER_API_KEY ?? "",
    url: target,
    country_code: "us",
    keep_headers: "true",
  });
  if (u.searchParams.get("premium") === "1") params.set("premium", "true");
  if (u.searchParams.get("ultra") === "1") params.set("ultra_premium", "true");
  const res = await fetch(`https://api.scraperapi.com/?${params}`, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(100_000),
  });
  const body = await res.text();
  return NextResponse.json({
    keySet: !!process.env.SCRAPER_API_KEY,
    status: res.status,
    bytes: body.length,
    body: body.slice(0, 3_000_000),
  });
}
