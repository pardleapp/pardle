/**
 * SharpSports BetSync integration types.
 *
 * Two sides:
 *
 *   1. **Wire types** — mirror what SharpSports actually POSTs to our
 *      webhook receiver. Derived directly from the JSON samples they
 *      provided for outright winner, top-N, and Round-1 leader bets.
 *      Some fields (e.g. `sportradarId`) may be null on golf events;
 *      we type them as optional to match reality.
 *
 *   2. **Canonical types** — the shape Pardle stores after parsing.
 *      Deliberately narrower than the wire shape: golf-only, one
 *      canonical market taxonomy across every book, tournament and
 *      player IDs resolved to our internal IDs (PGA orchestrator
 *      playerId, DG dg_id, our tournament slug).
 *
 * The parser (`./parser.ts`) is the boundary — everything downstream
 * (feed rendering, bet detail win-probability, notifications) sees
 * only the canonical shape. That keeps the SharpSports specifics
 * quarantined to one file and makes it easy to swap providers if we
 * ever need to.
 */

// ── Wire types ─────────────────────────────────────────────────────

/** A single sportsbook the SharpSports account is linked to. */
export interface SSBook {
  id: string; // "BOOK_xxx"
  name: string; // "BetRivers", "Caesars", …
  abbr: string; // "br", "ca", "dk", …
}

/** SharpSports event object. Golf events have `sport: "Golf"`;
 *  `league` is typically null for golf; various third-party IDs may
 *  or may not populate. Team fields are always null for golf. */
export interface SSEvent {
  id: string; // "EVNT_xxx"
  sport: string; // "Golf" | "Basketball" | ...
  league: string | null;
  name: string; // "The Masters 2024", "The Genesis Invitational 2026"
  nameSpecial?: string | null;
  startTime: string; // ISO — Thu R1 tee-off for majors/regulars
  startDate?: string | null;
  seasonType?: string | null;
  venue?: string | null;
  sportId: string;
  leagueId?: string | null;
  contestantAway?: unknown | null;
  contestantHome?: unknown | null;
  neutralVenue?: boolean | null;
  sportsdataioId?: string | null;
  sportradarId?: string | null;
  oddsjamId?: string | null;
  theOddsApiId?: string | null;
}

/** Non-null on markets whose `position` is "Over"/"Under" — the
 *  player and other prop-side metadata live here. Also carries a
 *  `matchupSpecial` slot for tournament-matchup markets where the
 *  opponent metadata is stored (empirically null on top-N; expected
 *  populated on head-to-heads once we see one). */
export interface SSPropDetails {
  future: boolean;
  matchupSpecial?: unknown | null;
  player?: string | null;
  playerId?: string | null;
  sportsdataioPlayerId?: string | null;
  sportradarPlayerId?: string | null;
  team?: string | null;
  teamId?: string | null;
  sportsdataioTeamId?: string | null;
  sportradarTeamId?: string | null;
  metricSpecial?: string | null;
  metricSpecialId?: string | null;
}

/** Individual bet (a leg on a parlay, or the only leg on a single).
 *  `bookDescription` is the human-readable string the book itself
 *  used — falls back to this when `marketSelection` is null. */
export interface SSBet {
  id: string; // "BET_xxx"
  type: "prop" | "straight" | string;
  event: SSEvent;
  segment?: string | null;
  proposition: string; // "winner" | "top 10" | "Leader after Round 1" | ...
  segmentDetail?: string | null;
  position: string; // player name for futures; "Over"/"Under" for O/U
  line?: number | null; // the O/U number, e.g. 68.5
  oddsAmerican: number;
  status: string;
  outcome: string; // "win" | "loss" | "push" | "cashout" | "pending"
  live: boolean;
  incomplete: boolean; // true when SharpSports hasn't parsed the bet
  bookDescription: string;
  marketSelection: string | null; // "MRKT_xxx" or null
  autoGrade?: boolean;
  segmentId?: string | null;
  positionId?: string | null; // "PLYR_xxx" for player futures
  propDetails: SSPropDetails | null;
  sdioMarketId?: string | null;
  sportradarMarketId?: string | null;
  oddsjamMarketId?: string | null;
  theOddsApiMarketId?: string | null;
}

/** A full bet slip — one or more legs. `type` is "single" for a
 *  1-leg slip, "parlay" for multi-leg. `outcome` reflects the whole
 *  slip: "cashout" when the user cashed out early. */
export interface SSBetSlip {
  id: string; // "SLIP_xxx"
  bettor: string; // "BTTR_xxx"
  book: SSBook;
  bettorAccount: string; // "BACT_xxx"
  bookRef: string; // book's own slip ref
  timePlaced: string; // ISO
  type: "single" | "parlay" | string;
  subtype?: string | null;
  oddsAmerican: number;
  atRisk: number; // cents
  toWin: number; // cents
  status: string;
  outcome: string;
  refreshResponse: string;
  incomplete: boolean;
  netProfit?: number | null;
  dateClosed?: string | null;
  timeClosed?: string | null;
  typeSpecial?: string | null;
  bets: SSBet[];
  adjusted?: {
    odds?: boolean;
    line?: number | null;
    atRisk?: number | null;
  };
}

/** Envelope of a webhook POST — SharpSports sends batches of slips
 *  as `betSlips`, plus a marker for pagination on the initial dump. */
export interface SSWebhookPayload {
  bettor?: string;
  bettorAccount?: string;
  refreshResponse?: string;
  eventType?: string; // "refresh" | "backfill" | ...
  betSlips: SSBetSlip[];
  // On the initial dump these show up when we need to paginate.
  paginated?: boolean;
  nextCursor?: string | null;
}

// ── Canonical types (Pardle-side) ─────────────────────────────────

/** Pardle's canonical market taxonomy. Every SharpSports proposition
 *  gets mapped here in the parser; unknown ones fall into `unknown`
 *  and get flagged for review — never silently dropped. */
export type PardleMarket =
  | { kind: "outright-winner" }
  | { kind: "top-finish"; n: 3 | 5 | 10 | 20 | 30 | 40 }
  | { kind: "leader-after-round"; round: 1 | 2 | 3 }
  | { kind: "round-score"; round: 1 | 2 | 3 | 4; direction: "over" | "under"; line: number }
  | { kind: "matchup"; opponent: PardlePlayerRef | null }
  | { kind: "make-cut" }
  | { kind: "unknown"; propositionRaw: string; bookDescriptionRaw: string };

/** A player reference the parser resolved from a SharpSports bet.
 *  Name is always present; dgId + pgaOrchestratorId are best-effort
 *  matches from the golfer DB — null when we can't resolve. */
export interface PardlePlayerRef {
  displayName: string;
  /** DataGolf dg_id, resolved by name match against the golfer DB. */
  dgId: number | null;
  /** PGA orchestrator playerId, resolved same way. */
  pgaId: string | null;
  /** SharpSports position id, kept for round-trip debugging. */
  sharpSportsPositionId: string | null;
}

/** Pardle's canonical tournament ref — our IDs, not SharpSports'. */
export interface PardleTournamentRef {
  displayName: string; // "The Masters 2026"
  /** PGA orchestrator tournamentId like "R2026014". Null when we
   *  haven't onboarded / can't resolve. */
  pgaId: string | null;
  /** DataGolf event_id + year. Null when unresolved. */
  dgEventId: number | null;
  dgYear: number | null;
  /** ISO date of Thu R1 tee-off. */
  startDate: string | null;
}

/** A single leg of a bet slip in Pardle's canonical form. */
export interface PardleBetLeg {
  legId: string; // pass-through of SharpSports BET_ id
  tournament: PardleTournamentRef;
  player: PardlePlayerRef | null; // null on non-player legs
  market: PardleMarket;
  oddsAmerican: number;
  outcome: "win" | "loss" | "push" | "cashout" | "pending";
  isLive: boolean;
  incomplete: boolean; // SharpSports flag we pass through
}

/** Full slip in Pardle's canonical form. Golf legs only — mixed-sport
 *  parlays keep their non-golf legs in `otherLegsCount` so the UI can
 *  say "part of a 3-leg parlay (2 non-golf legs)". */
export interface PardleBetSlip {
  slipId: string; // pass-through of SharpSports SLIP_ id
  bettorAccountId: string; // "BACT_xxx"
  book: {
    id: string;
    name: string;
    abbr: string;
  };
  bookRef: string;
  placedAt: string; // ISO
  isParlay: boolean;
  slipOddsAmerican: number;
  atRiskCents: number;
  toWinCents: number;
  netProfitCents: number | null;
  status: string; // pass-through
  outcome: "win" | "loss" | "push" | "cashout" | "pending";
  /** Only the golf legs — parlays with non-golf legs still keep
   *  those non-golf legs stubbed via otherLegsCount so the UI can
   *  explain the total odds. */
  golfLegs: PardleBetLeg[];
  otherLegsCount: number;
  /** Set true when at least one leg couldn't be fully classified
   *  (unknown market or unresolved player/tournament). Doesn't block
   *  storage — just flags for follow-up review. */
  hasUnknownFields: boolean;
}
