/**
 * SharpSports webhook payload → Pardle canonical bet-slip shape.
 *
 * Everything the receiver knows about SharpSports' wire format stops
 * here. Downstream consumers (feed rendering, bet-detail win-probability,
 * notifications) only ever see `PardleBetSlip`.
 *
 * Three parsing paths for a golf leg's market, in preference order:
 *
 *   1. **Standardized** — SharpSports supplied a `marketSelection` id
 *      AND we recognise the `proposition` string. Highest confidence.
 *      Covers the 8 golf markets SharpSports has already standardized
 *      (winner, top N, R1/R2/R3 leader — all futures).
 *
 *   2. **Recognised proposition, marketSelection missing** — the
 *      `proposition` string matches one of our known patterns
 *      (e.g. "Leader after Round 1") even though SharpSports hasn't
 *      finished mapping the marketSelection id for that book yet.
 *      We trust the proposition; verified by JSON they sent us where
 *      BetRivers R1 Leader arrives with marketSelection: null but
 *      proposition string is present.
 *
 *   3. **bookDescription fallback** — proposition is unrecognised
 *      (or missing). Parse the free-text book string against a set
 *      of regex patterns. Covers round-score O/U ("Over 68.5 …") and
 *      head-to-head matchups until SharpSports standardizes them.
 *
 * Anything that fails all three lands in `market: { kind: "unknown" }`
 * with the raw strings preserved for follow-up review. Never silently
 * drop a bet; make the failure legible.
 */

import type {
  SSBet,
  SSBetSlip,
  SSEvent,
  PardleBetLeg,
  PardleBetSlip,
  PardleMarket,
  PardlePlayerRef,
  PardleTournamentRef,
} from "./types";

// ── Player/tournament resolvers (name-based match) ─────────────────

/** Canonical form for name matching — matches the shape used
 *  elsewhere in `lib/feed/*` (strip accents + non-alphanumerics,
 *  lowercase). Kept private to this module. */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Flip "Last, First" → "First Last" (DataGolf's convention) and
 *  leave "First Last" alone. Used before running through the resolver
 *  since SharpSports' `position` is always "First Last". */
function flipCommaName(raw: string): string {
  const s = raw.trim();
  if (!s.includes(",")) return s;
  const [last, first] = s.split(",").map((x) => x.trim());
  return `${first} ${last}`.trim();
}

/** Player DB shape the resolver expects. Callers inject their own
 *  golfer roster (typically loaded from the repo's static JSON + DG
 *  skill ratings map). Kept as a plain interface so the resolver
 *  doesn't have to know where the roster comes from. */
export interface GolferLookupEntry {
  displayName: string;
  dgId: number | null;
  pgaId: string | null;
}

/** Given a name string and a golfer DB, return a resolved player
 *  reference. `displayName` is always populated; `dgId`/`pgaId` are
 *  null when we can't match — the caller (or a follow-up
 *  reconciliation job) can fill them in later. */
export function resolvePlayer(
  rawName: string,
  positionId: string | null,
  golfers: Map<string, GolferLookupEntry>,
): PardlePlayerRef {
  const displayName = flipCommaName(rawName);
  const hit = golfers.get(normName(displayName));
  return {
    displayName,
    dgId: hit?.dgId ?? null,
    pgaId: hit?.pgaId ?? null,
    sharpSportsPositionId: positionId,
  };
}

/** Tournament DB entry — the caller injects a list keyed by a
 *  normalised event-name form (see normaliseTournamentName below). */
export interface TournamentLookupEntry {
  displayName: string;
  pgaId: string | null;
  dgEventId: number | null;
  dgYear: number | null;
  startDate: string | null;
}

/** Strip common noise from a tournament name so "The Masters 2024
 *  Markets" and "The Masters 2024" both key the same. */
export function normaliseTournamentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bmarkets?\b/g, "")
    .replace(/\btournament\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveTournament(
  event: SSEvent,
  tournaments: Map<string, TournamentLookupEntry>,
): PardleTournamentRef {
  const raw = event.name || "";
  const key = normaliseTournamentName(raw);
  const hit = tournaments.get(key);
  return {
    displayName: raw,
    pgaId: hit?.pgaId ?? null,
    dgEventId: hit?.dgEventId ?? null,
    dgYear: hit?.dgYear ?? null,
    startDate: hit?.startDate ?? event.startTime?.slice(0, 10) ?? null,
  };
}

// ── Market classification ─────────────────────────────────────────

/** Direct map for the propositions we've seen from SharpSports.
 *  Case-insensitive lookup done in parseMarket. Add new propositions
 *  here rather than in regex — direct-map is O(1) and unambiguous. */
const PROPOSITION_TO_MARKET: Record<string, PardleMarket | ((raw: SSBet) => PardleMarket)> = {
  "winner": { kind: "outright-winner" },
  "top 3": { kind: "top-finish", n: 3 },
  "top 5": { kind: "top-finish", n: 5 },
  "top 10": { kind: "top-finish", n: 10 },
  "top 20": { kind: "top-finish", n: 20 },
  "top 30": { kind: "top-finish", n: 30 },
  "top 40": { kind: "top-finish", n: 40 },
  "leader after round 1": { kind: "leader-after-round", round: 1 },
  "leader after round 2": { kind: "leader-after-round", round: 2 },
  "leader after round 3": { kind: "leader-after-round", round: 3 },
  "make cut": { kind: "make-cut" },
};

/** Round-score O/U regexes tried against `bookDescription` when the
 *  proposition is unrecognised. Multiple patterns because each book
 *  words these differently. First match wins. */
const ROUND_SCORE_PATTERNS: Array<{
  re: RegExp;
  extract: (m: RegExpMatchArray) => {
    round: 1 | 2 | 3 | 4;
    line: number;
  } | null;
}> = [
  // "Round 2 Score - Over/Under 68.5"
  {
    re: /round\s*([1-4]).*?(?:over|under).*?(\d+\.?\d*)/i,
    extract: (m) => ({
      round: Number(m[1]) as 1 | 2 | 3 | 4,
      line: Number(m[2]),
    }),
  },
  // "Rd 2 O/U 68.5"
  {
    re: /rd\s*([1-4]).*?(\d+\.?\d*)/i,
    extract: (m) => ({
      round: Number(m[1]) as 1 | 2 | 3 | 4,
      line: Number(m[2]),
    }),
  },
];

/** Head-to-head matchup regexes — "Player A vs Player B", 2-ball,
 *  3-ball, etc. */
const MATCHUP_PATTERNS: Array<RegExp> = [
  /\bvs\.?\b/i,
  /\bhead[- ]?to[- ]?head\b/i,
  /\bmatch(?:up)?\b/i,
  /\b2[- ]?ball\b/i,
  /\b3[- ]?ball\b/i,
];

/** Turn a SharpSports bet's proposition + bookDescription into a
 *  canonical Pardle market. Never throws; the fallback for the
 *  unresolvable case is `kind: "unknown"` with raw strings kept for
 *  human review. */
export function parseMarket(bet: SSBet): PardleMarket {
  const propRaw = (bet.proposition ?? "").trim();
  const propKey = propRaw.toLowerCase();
  const desc = bet.bookDescription ?? "";

  // Path 1: proposition matches a known market string. This catches
  // both standardized markets (marketSelection non-null) and
  // partially-standardized ones (marketSelection null but proposition
  // still populated — verified from the BetRivers R1 Leader sample).
  const propHit = PROPOSITION_TO_MARKET[propKey];
  if (propHit) {
    return typeof propHit === "function" ? propHit(bet) : propHit;
  }

  // Path 2: bet position is "Over"/"Under" → round-score O/U.
  // Per SharpSports' explanation, these are the markets that
  // hoist player info into propDetails; we still need to parse the
  // round + line from proposition or bookDescription.
  const positionLower = (bet.position ?? "").trim().toLowerCase();
  const direction: "over" | "under" | null =
    positionLower === "over"
      ? "over"
      : positionLower === "under"
        ? "under"
        : null;
  if (direction && bet.line != null) {
    // Try to identify the round from proposition or bookDescription.
    for (const patt of ROUND_SCORE_PATTERNS) {
      const src = propRaw + " " + desc;
      const m = src.match(patt.re);
      if (m) {
        const info = patt.extract(m);
        if (info) {
          return {
            kind: "round-score",
            round: info.round,
            direction,
            line: bet.line,
          };
        }
      }
    }
    // Line + Over/Under is present but we can't pin the round — fall
    // through to unknown so the raw strings survive for review.
  }

  // Path 3: head-to-head matchup pattern. Opponent extraction happens
  // outside this function because it needs the golfer lookup — this
  // just classifies the market as a matchup with opponent=null;
  // the caller (parseLeg) enriches it.
  if (MATCHUP_PATTERNS.some((re) => re.test(desc) || re.test(propRaw))) {
    return { kind: "matchup", opponent: null };
  }

  return {
    kind: "unknown",
    propositionRaw: propRaw,
    bookDescriptionRaw: desc,
  };
}

// ── Leg + slip parsing ─────────────────────────────────────────────

function parseOutcome(raw: string): PardleBetLeg["outcome"] {
  const s = (raw ?? "").toLowerCase();
  if (s === "win") return "win";
  if (s === "loss" || s === "lose") return "loss";
  if (s === "push" || s === "void") return "push";
  if (s === "cashout" || s === "cashed_out") return "cashout";
  return "pending";
}

interface ParseContext {
  golfers: Map<string, GolferLookupEntry>;
  tournaments: Map<string, TournamentLookupEntry>;
}

function parseLeg(bet: SSBet, ctx: ParseContext): PardleBetLeg {
  const tournament = resolveTournament(bet.event, ctx.tournaments);
  let market = parseMarket(bet);

  // Player extraction depends on the market's shape:
  //   - Futures where `position` is a player name → position field
  //   - Over/Under where `position` is "Over"/"Under" → propDetails.player
  //   - Matchup → position field is the leg's chosen player; opponent
  //     lives in propDetails.matchupSpecial (once SharpSports populates
  //     it — currently often null)
  let player: PardlePlayerRef | null = null;
  const propPlayer = bet.propDetails?.player ?? null;
  const positionLooksLikePlayer =
    bet.position &&
    bet.position.toLowerCase() !== "over" &&
    bet.position.toLowerCase() !== "under";
  const rawPlayerName = propPlayer ?? (positionLooksLikePlayer ? bet.position : null);
  if (rawPlayerName) {
    player = resolvePlayer(
      rawPlayerName,
      bet.propDetails?.playerId ?? bet.positionId ?? null,
      ctx.golfers,
    );
  }

  // Matchup opponent — parse from `propDetails.matchupSpecial` when
  // SharpSports populates it. Shape is undocumented in their wire; we
  // treat it defensively — if it's a string that includes " vs " with
  // a player name we don't already have, take the OTHER name as opponent.
  if (market.kind === "matchup" && market.opponent == null) {
    const ms = bet.propDetails?.matchupSpecial;
    if (typeof ms === "string" && player) {
      const parts = ms.split(/\s+vs\.?\s+/i).map((p) => p.trim());
      const opp = parts.find(
        (p) => p && normName(p) !== normName(player!.displayName),
      );
      if (opp) {
        market = {
          kind: "matchup",
          opponent: resolvePlayer(opp, null, ctx.golfers),
        };
      }
    }
  }

  return {
    legId: bet.id,
    tournament,
    player,
    market,
    oddsAmerican: bet.oddsAmerican,
    outcome: parseOutcome(bet.outcome),
    isLive: bet.live,
    incomplete: bet.incomplete,
  };
}

/** Parse a SharpSports bet slip → Pardle canonical slip. Golf legs
 *  only. Non-golf legs (mixed-sport parlays) get counted in
 *  `otherLegsCount` so the UI can annotate the total odds context.
 *
 *  Contexts (golfer + tournament roster) are injected — the parser
 *  doesn't know how the caller loaded them. See `store.ts` for the
 *  wiring that pulls from Redis / repo JSON. */
export function parseSlip(
  slip: SSBetSlip,
  ctx: ParseContext,
): PardleBetSlip {
  const golfBets = slip.bets.filter((b) => b.event?.sport === "Golf");
  const otherLegsCount = slip.bets.length - golfBets.length;
  const legs = golfBets.map((b) => parseLeg(b, ctx));
  const hasUnknownFields = legs.some(
    (l) =>
      l.market.kind === "unknown" ||
      (l.player && (l.player.dgId == null || l.player.pgaId == null)) ||
      (l.tournament.pgaId == null && l.tournament.dgEventId == null),
  );

  return {
    slipId: slip.id,
    bettorAccountId: slip.bettorAccount,
    book: {
      id: slip.book.id,
      name: slip.book.name,
      abbr: slip.book.abbr,
    },
    bookRef: slip.bookRef,
    placedAt: slip.timePlaced,
    isParlay: slip.type === "parlay",
    slipOddsAmerican: slip.oddsAmerican,
    atRiskCents: slip.atRisk,
    toWinCents: slip.toWin,
    netProfitCents: slip.netProfit ?? null,
    status: slip.status,
    outcome: parseOutcome(slip.outcome),
    golfLegs: legs,
    otherLegsCount,
    hasUnknownFields,
  };
}
