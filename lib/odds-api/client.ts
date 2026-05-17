/**
 * The Odds API client — aggregator that licenses DraftKings + FanDuel
 * (and others) so we can pull their outright winner prices from a
 * proper auth'd endpoint instead of trying to scrape past Cloudflare.
 *
 * Free tier: 500 requests/month. Paid Starter $30/mo for 20K.
 * Coverage for golf is currently only outright winner markets for the
 * three majors (PGA Championship, The Open, US Open) — they don't
 * carry top-X props.
 *
 * Server-only.
 */
import "server-only";

const BASE = "https://api.the-odds-api.com/v4";

interface OAOutcome {
  name: string;
  price: number; // decimal odds
}

interface OAMarket {
  key: string;
  last_update: string;
  outcomes: OAOutcome[];
}

interface OABookmaker {
  key: string; // "draftkings" | "fanduel" | ...
  title: string;
  last_update: string;
  markets: OAMarket[];
}

export interface OAEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  bookmakers: OABookmaker[];
}

/**
 * Fetch DK + FD outright winner prices for the given sport key.
 * Returns one event per tournament that's in-play / upcoming for
 * that sport key.
 */
export async function getOutrights(sportKey: string): Promise<OAEvent[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY not set");
  const url = `${BASE}/sports/${encodeURIComponent(
    sportKey,
  )}/odds?regions=us&markets=outrights&oddsFormat=decimal&bookmakers=draftkings,fanduel&apiKey=${encodeURIComponent(
    key,
  )}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Odds API ${sportKey}: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as OAEvent[];
}

/**
 * Map an active tournament name to the corresponding Odds API
 * sport key. Returns null for non-major tournaments — Odds API
 * doesn't cover regular Tour stops for golf.
 */
export function matchTournamentToSportKey(
  tournamentName: string,
): string | null {
  const norm = tournamentName.toLowerCase().replace(/[^a-z]/g, "");
  if (norm.includes("pgachampionship")) {
    return "golf_pga_championship_winner";
  }
  if (norm.includes("theopen") || norm.includes("openchampionship")) {
    return "golf_the_open_championship_winner";
  }
  if (norm.includes("usopen")) {
    return "golf_us_open_winner";
  }
  return null;
}
