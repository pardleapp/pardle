/**
 * DraftKings round-score O/U fetcher.
 *
 * Reuses the /v1/eventgroups/{id} response we already pull for
 * top-X markets; the round-score subcategories sit in the same
 * offerSubcategoryDescriptors tree, keyed by name.
 *
 * DK's subcategory naming for round-score is inconsistent across
 * tournaments — sometimes "Round 1 Match Ups", sometimes "Round
 * Scoring", sometimes "1st Round Score". We match with a permissive
 * regex and let the round label parse out the round number.
 *
 * DK offers usually price BOTH sides (over + under) of a line as
 * TWO separate outcomes on the same offer, so we pair them up by
 * matching the label prefix.
 */

import "server-only";
import type { BookKey, RoundScoreQuote } from "../types";

const BASE = "https://sportsbook-nash.draftkings.com/api/sportscontent/dkusva";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/123.0.0.0 Safari/537.36";

async function dkFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`DraftKings ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

interface DKOutcome {
  label: string;
  oddsAmerican?: string;
  oddsDecimal?: string;
  line?: number | string;
}
interface DKOffer {
  label: string;
  outcomes?: DKOutcome[];
  lastUpdatedDate?: string;
}
interface DKSubcategory {
  subcategoryId: number;
  name: string;
  offers?: DKOffer[][];
}
interface DKCategory {
  categoryId: number;
  name: string;
  offerSubcategoryDescriptors?: DKSubcategory[];
}
interface DKEventGroupResponse {
  eventGroup?: { offerCategories?: DKCategory[] };
}

const ROUND_RE = /(?:^|\W)(?:round\s*|r\s*|(\d+)\s*(?:st|nd|rd|th)\s+round)(\d+)?/i;

/** Parse a round number 1-4 out of a subcategory name. Returns
 *  null when the name doesn't match the round-score family. */
function roundFromSubcategoryName(name: string): number | null {
  const n = name.toLowerCase();
  // "1st round", "round 1", "r1"
  const patterns = [
    /(\d)(?:st|nd|rd|th)\s+round/,
    /round\s*(\d)/,
    /\br(\d)\b/,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    if (m) {
      const r = Number(m[1]);
      if (r >= 1 && r <= 4) return r;
    }
  }
  return null;
}

/** Does this subcategory name look like a round-score O/U market
 *  (as opposed to matchups, 3-balls, cuts, top-X)? */
function looksLikeRoundScoreSub(name: string): boolean {
  const n = name.toLowerCase();
  if (!roundFromSubcategoryName(name)) return false;
  // Positive keywords for O/U totals
  if (n.includes("score") || n.includes("total")) return true;
  if (/o\s*\/\s*u|over.*under/i.test(n)) return true;
  return false;
}

/** Convert DK's odds fields into a decimal price. */
function decimalOdds(o: DKOutcome): number | null {
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
  return null;
}

/** DK outcome labels for round-score come as "Player Name Over" and
 *  "Player Name Under" (or the offer label carries the player and
 *  outcomes carry only Over/Under). Extract the (player, side, line)
 *  triple from an offer + its outcomes. */
function parseRoundScoreOffer(
  offer: DKOffer,
): { player: string; line: number; overDec: number | null; underDec: number | null } | null {
  const outcomes = offer.outcomes ?? [];
  if (outcomes.length === 0) return null;
  // Case A: offer label = player name; outcomes = "Over 67.5" / "Under 67.5"
  const offerLabel = (offer.label ?? "").trim();
  let player = "";
  let over: DKOutcome | undefined;
  let under: DKOutcome | undefined;
  let line: number | null = null;
  for (const o of outcomes) {
    const lbl = (o.label ?? "").trim();
    const isOver = /\bover\b/i.test(lbl);
    const isUnder = /\bunder\b/i.test(lbl);
    if (!isOver && !isUnder) continue;
    if (isOver) over = o;
    if (isUnder) under = o;
    // Capture line from outcome's .line field OR by regex on the label.
    if (line == null) {
      if (o.line != null && Number.isFinite(Number(o.line))) {
        line = Number(o.line);
      } else {
        const m = lbl.match(/(\d+(?:\.\d+)?)/);
        if (m) line = Number(m[1]);
      }
    }
  }
  if (!over && !under) return null;
  if (line == null) return null;
  // Prefer offer label as player (cleaner); otherwise strip "Over/Under 67.5"
  // off the outcome label.
  if (offerLabel && !/\bover\b|\bunder\b/i.test(offerLabel)) {
    player = offerLabel;
  } else {
    // Take one outcome's label and strip "over ##" / "under ##"
    const src = over ?? under;
    const cleaned = (src?.label ?? "")
      .replace(/\b(over|under)\b/gi, "")
      .replace(/\b\d+(?:\.\d+)?\b/g, "")
      .trim();
    player = cleaned;
  }
  if (!player) return null;
  return {
    player,
    line,
    overDec: over ? decimalOdds(over) : null,
    underDec: under ? decimalOdds(under) : null,
  };
}

interface DKEventGroupNode {
  eventGroupId: number;
  eventGroupName: string;
  eventGroupStartDate?: string;
}
interface DKLeagueResponse {
  eventGroups?: DKEventGroupNode[];
}

/** Match a tournament name against DK event groups. Loose contains
 *  match — DK sometimes prefixes with "PGA" or the sponsor. */
export async function findEventGroup(
  tournamentName: string,
): Promise<number | null> {
  const data = await dkFetch<DKLeagueResponse>(`/v1/leagues/9`);
  const target = tournamentName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const g of data.eventGroups ?? []) {
    const norm = (g.eventGroupName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Match either direction — DK's label might carry sponsor/tour prefix.
    if (norm.includes(target) || target.includes(norm)) return g.eventGroupId;
  }
  return null;
}

/** Fetch all round-score O/U quotes for a tournament. Round argument
 *  filters to that round only. */
export async function fetchDkRoundScoreQuotes(
  eventGroupId: number,
  round: number,
): Promise<RoundScoreQuote[]> {
  const data = await dkFetch<DKEventGroupResponse>(
    `/v1/eventgroups/${eventGroupId}`,
  );
  const cats = data.eventGroup?.offerCategories ?? [];
  const now = new Date().toISOString();
  const out: RoundScoreQuote[] = [];
  const BOOK: BookKey = "draftkings";
  for (const cat of cats) {
    for (const sub of cat.offerSubcategoryDescriptors ?? []) {
      if (!looksLikeRoundScoreSub(sub.name)) continue;
      const r = roundFromSubcategoryName(sub.name);
      if (r !== round) continue;
      for (const group of sub.offers ?? []) {
        for (const offer of group) {
          const parsed = parseRoundScoreOffer(offer);
          if (!parsed) continue;
          out.push({
            book: BOOK,
            playerName: parsed.player,
            round: r,
            line: parsed.line,
            over: parsed.overDec,
            under: parsed.underDec,
            lastUpdatedAt: offer.lastUpdatedDate ?? now,
          });
        }
      }
    }
  }
  return out;
}
