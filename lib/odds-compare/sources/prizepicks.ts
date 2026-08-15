/**
 * PrizePicks round-score fetcher.
 *
 * PrizePicks is a DFS pick'em, not a sportsbook — every line is
 * priced at a fixed "higher/lower" payout (typically -119 / -119
 * flat, with the payout multiplier scaling by pick count). For
 * the compare table we render both sides at the observed decimal
 * odds so it slots into the same OU column as DK.
 *
 * PGA coverage is thin outside majors — league_id 1 (PGA) usually
 * shows 0 projections during regular tour stops, then lights up
 * for Masters / US Open / The Open / PGA Championship. Underdog
 * behaves the same way. Empty responses are expected and OK.
 *
 * Endpoint: partner-api.prizepicks.com/projections?league_id=1
 * (the main api.prizepicks.com sits behind Cloudflare bot
 * challenge; the partner subdomain doesn't).
 */

import "server-only";
import type { BookKey, RoundScoreQuote } from "../types";
import { proxiedFetch } from "../proxied-fetch";

const BASE = "https://partner-api.prizepicks.com";
const PGA_LEAGUE_ID = 1;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/123.0.0.0 Safari/537.36";

interface PPProjectionAttrs {
  line_score?: number;
  stat_type?: string;
  description?: string; // player name for goals/etc; sometimes leg text
  odds_type?: string;
  start_time?: string;
  updated_at?: string;
}
interface PPRel {
  data?: { id: string; type: string } | null;
}
interface PPProjection {
  id: string;
  type: string;
  attributes?: PPProjectionAttrs;
  relationships?: {
    new_player?: PPRel;
    stat_type?: PPRel;
  };
}
interface PPPlayerAttrs {
  name?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
}
interface PPPlayer {
  id: string;
  type: string;
  attributes?: PPPlayerAttrs;
}
interface PPStatTypeAttrs {
  name?: string;
}
interface PPStatType {
  id: string;
  type: string;
  attributes?: PPStatTypeAttrs;
}
type PPInclude = PPPlayer | PPStatType;
interface PPResponse {
  data?: PPProjection[];
  included?: PPInclude[];
}

/** Convert a PrizePicks american price to decimal. Their payouts
 *  are historically -119 both sides. */
function decimalFromAmerican(american: number): number {
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

/** Parse "Round N" / "Rd N" out of a stat-type / description
 *  string. Returns null when the projection isn't a round-score
 *  contract. */
function roundFromStatType(name: string): number | null {
  const m = name.match(/\b(?:round|rd)\s*(\d)/i);
  if (!m) return null;
  const r = Number(m[1]);
  return r >= 1 && r <= 4 ? r : null;
}

/** True when the stat type is round-score-shaped ("Strokes",
 *  "Round Score", etc). */
function isRoundScoreStat(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("strokes")) return true;
  if (n.includes("round score")) return true;
  if (/\b(?:round|rd)\s*\d\s*(?:score|strokes|total)\b/i.test(name)) return true;
  return false;
}

export async function fetchPrizePicksRoundScoreQuotes(
  round: number,
): Promise<RoundScoreQuote[]> {
  const url = `${BASE}/projections?league_id=${PGA_LEAGUE_ID}&per_page=250&single_stat=true`;
  const res = await proxiedFetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`PrizePicks ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as PPResponse;
  const rows = j.data ?? [];
  if (rows.length === 0) return [];

  // Build lookup tables from the JSON:API `included` block.
  const players = new Map<string, string>();
  const statTypes = new Map<string, string>();
  for (const inc of j.included ?? []) {
    if (inc.type === "new_player") {
      const p = inc as PPPlayer;
      players.set(
        p.id,
        p.attributes?.display_name ??
          p.attributes?.name ??
          `${p.attributes?.first_name ?? ""} ${p.attributes?.last_name ?? ""}`.trim(),
      );
    }
    if (inc.type === "stat_type") {
      const s = inc as PPStatType;
      statTypes.set(s.id, s.attributes?.name ?? "");
    }
  }

  const BOOK: BookKey = "prizepicks";
  const now = new Date().toISOString();
  const out: RoundScoreQuote[] = [];
  for (const proj of rows) {
    const attr = proj.attributes ?? {};
    const statTypeName =
      statTypes.get(proj.relationships?.stat_type?.data?.id ?? "") ??
      attr.stat_type ??
      "";
    if (!isRoundScoreStat(statTypeName)) continue;
    const r = roundFromStatType(statTypeName);
    if (r !== round) continue;
    const line = attr.line_score;
    if (line == null) continue;
    const playerId = proj.relationships?.new_player?.data?.id;
    const playerName = playerId ? players.get(playerId) : null;
    if (!playerName) continue;
    // PrizePicks is a symmetric pick'em — both sides at ~ -119.
    // We approximate with -119 both sides when they don't
    // publish per-side prices explicitly.
    const dec = decimalFromAmerican(-119);
    out.push({
      book: BOOK,
      playerName,
      round: r,
      line,
      over: dec,
      under: dec,
      lastUpdatedAt: attr.updated_at ?? now,
    });
  }
  return out;
}
