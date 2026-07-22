/**
 * Mock bets — verbatim shapes from the design-handoff prototype's
 * `myBets` and `settled` constants in Pardle Social v2.html. Used
 * for the first cut of the new /bets surface so the layout is
 * exact before we wire to the real bet store + /api/feed (currentOdds,
 * projections, top-finish).
 *
 * Real-data wiring comes in a follow-up pass — when it lands these
 * shapes become the contract between the page and the data layer.
 */

export interface MockBetLiveOdds {
  /** Decimal format ("3.50"). */
  dec: string;
  /** Fractional format ("5/2"). */
  frac: string;
  /** American format ("+250"). */
  am: string;
}

export interface MockBetLive {
  id: string;
  /** Player name. */
  who: string;
  /** Always true for the prototype's mock bets — every row in the
   *  Live tab is the caller's own bet. */
  mine: boolean;
  /** Initials of crew members tailing this bet (avatar rail in the
   *  expanded detail). */
  on: string[];
  /** Market label — OUTRIGHT WIN, TOP 5, UNDER 69.5 R4, etc. */
  mkt: string;
  /** Currency symbol — £ or $ in the prototype. */
  cur: "£" | "$" | "u";
  stake: number;
  /** Odds expressed in all three formats so the on-page toggle can
   *  reformat without a separate parse step. */
  odds: MockBetLiveOdds;
  /** Live win probability as an integer percentage. */
  prob: number;
  /** "up" / "down" arrow direction vs. placement. */
  dir: "up" | "down";
  /** Probability sparkline samples (oldest → newest). */
  hist: number[];
  /** Shot-by-shot timeline — [text, delta label, dir]. */
  tl: Array<[string, string, "up" | "down" | "flat"]>;
}

export interface MockBetSettled {
  id: string;
  who: string;
  mkt: string;
  odds: string;
  cur: "£" | "$" | "u";
  stake: number;
  result: "WON" | "LOST";
  pl: string;
  /** Enum used by the /bets filter chips to group settled bets by
   *  market. Matches TrackedBet["kind"] exactly. Optional to keep
   *  the type back-compat with the older mock rows which don't
   *  populate it — those still render but drop out of "by market"
   *  slicing. */
  kind?: "outright" | "round-score" | "winning-score" | "top-finish" | "without";
  /** Epoch ms — used by timeframe filters. Optional for the same
   *  back-compat reason. */
  placedAt?: number;
  settledAt?: number;
  /** Orchestrator tournamentId + display name — used by the
   *  tournament filter. */
  tournamentId?: string;
  tournamentName?: string;
  // ── Export-only fields — populated on real bets so CSV export can
  //    emit spreadsheet-friendly rows (decimal odds, per-market
  //    line/side/round/cutoff, excluded-player for without X).
  //    Everything's optional so demo rows still type-check. ─────
  oddsDecimal?: number;
  round?: number | null;
  line?: number;
  side?: "under" | "over";
  cutoff?: number;
  withoutPlayerName?: string;
}

export const MOCK_BETS_LIVE: MockBetLive[] = [
  {
    id: "b1",
    who: "R. Henley",
    mine: true,
    on: ["MI", "TH"],
    mkt: "OUTRIGHT WIN",
    cur: "£",
    stake: 50,
    odds: { dec: "3.50", frac: "5/2", am: "+250" },
    prob: 54,
    dir: "up",
    hist: [34, 40, 46, 50, 54],
    tl: [
      ["Birdie 15 → −10", "+4", "up"],
      ["Par 16", "+1", "up"],
      ["Approach 17 to 3 ft", "+5", "up"],
    ],
  },
  {
    id: "b2",
    who: "A. Smalley",
    mine: true,
    on: ["MI"],
    mkt: "TOP 5",
    cur: "£",
    stake: 40,
    odds: { dec: "2.00", frac: "1/1", am: "+100" },
    prob: 71,
    dir: "up",
    hist: [58, 64, 66, 68, 71],
    tl: [
      ["Bogey-free front 9", "+2", "up"],
      ["Birdie 17", "+4", "up"],
      ["Par 18", "+1", "up"],
    ],
  },
  // ── Group-market views (linked from /groups "Most backed") ──
  // Same player+market as a member's personal bet so the prob
  // trajectory + shot timeline are identical; the difference is
  // `mine: false`, the `on` backer list reflects every group
  // member on the market, and the `stake` is the combined group
  // stake instead of one person's.
  {
    id: "gb1",
    who: "R. Henley",
    mine: false,
    on: ["JO", "YO", "TH", "DA"],
    mkt: "OUTRIGHT",
    cur: "£",
    stake: 240,
    odds: { dec: "3.50", frac: "5/2", am: "+250" },
    prob: 54,
    dir: "up",
    hist: [34, 40, 46, 50, 54],
    tl: [
      ["Birdie 15 → −10", "+4", "up"],
      ["Par 16", "+1", "up"],
      ["Approach 17 to 3 ft", "+5", "up"],
    ],
  },
  {
    id: "gb2",
    who: "A. Smalley",
    mine: false,
    on: ["YO", "MI", "PA"],
    mkt: "TOP 5",
    cur: "£",
    stake: 95,
    odds: { dec: "2.00", frac: "1/1", am: "+100" },
    prob: 71,
    dir: "up",
    hist: [58, 64, 66, 68, 71],
    tl: [
      ["Bogey-free front 9", "+2", "up"],
      ["Birdie 17", "+4", "up"],
      ["Par 18", "+1", "up"],
    ],
  },
  {
    id: "gb3",
    who: "M. Brennan",
    mine: false,
    on: ["SA", "JO"],
    mkt: "UNDER 69.5 · R4",
    cur: "$",
    stake: 200,
    odds: { dec: "1.90", frac: "10/11", am: "−110" },
    prob: 31,
    dir: "down",
    hist: [62, 58, 50, 44, 36, 31],
    tl: [
      ["Bogey on 15 — needs three under in", "−9", "down"],
      ["Approach 14 short-sided", "−4", "down"],
      ["Drove into fairway bunker on 13", "−2", "down"],
    ],
  },
  {
    id: "gb4",
    who: "N. Echavarria",
    mine: false,
    on: ["MI", "RO"],
    mkt: "TOP 10",
    cur: "$",
    stake: 60,
    odds: { dec: "2.50", frac: "6/4", am: "+150" },
    prob: 58,
    dir: "up",
    hist: [42, 46, 50, 54, 56, 58],
    tl: [
      ["Birdie 14 from 18 ft", "+4", "up"],
      ["Sand save on 12", "+2", "up"],
      ["Approach 11 to 6 ft", "+3", "up"],
    ],
  },
];

export const MOCK_BETS_SETTLED: MockBetSettled[] = [
  {
    id: "s1",
    who: "M. Brennan",
    mkt: "UNDER 69.5 · R3",
    odds: "2.00",
    cur: "£",
    stake: 500,
    result: "WON",
    pl: "+£500",
  },
  {
    id: "s2",
    who: "A. Novak",
    mkt: "UNDER 69.5",
    odds: "100.00",
    cur: "$",
    stake: 100,
    result: "WON",
    pl: "+$9,900",
  },
  {
    id: "s3",
    who: "R. Fowler",
    mkt: "UNDER 68.5",
    odds: "100.00",
    cur: "$",
    stake: 20,
    result: "LOST",
    pl: "−$20",
  },
];

/**
 * Find the mock bet whose trajectory + prob best matches a given
 * (playerName, marketLabel). Used by the group-market view so the
 * win-% / chart shown for "R. Henley · OUTRIGHT" matches what a
 * member sees on their own tracked version of the bet.
 *
 * Match is lenient: last-name match on the player (so "R. Henley"
 * matches "Russell Henley") + normalised market keyword match.
 * Prefers group-market gb* mocks, then personal b* mocks. Returns
 * null when no candidate exists — caller falls back to a neutral
 * placeholder so the page still renders.
 */
export function findMatchingMockBet(
  playerName: string,
  marketLabel: string,
): MockBetLive | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const lastName = (s: string) => {
    const parts = norm(s).split(" ");
    return parts[parts.length - 1] ?? "";
  };
  const targetLast = lastName(playerName);
  const targetMkt = norm(marketLabel);

  const sorted = [...MOCK_BETS_LIVE].sort((a, b) => {
    const aGb = a.id.startsWith("gb") ? 0 : 1;
    const bGb = b.id.startsWith("gb") ? 0 : 1;
    return aGb - bGb;
  });

  return (
    sorted.find(
      (b) =>
        lastName(b.who) === targetLast && norm(b.mkt) === targetMkt,
    ) ??
    sorted.find(
      (b) =>
        lastName(b.who) === targetLast &&
        norm(b.mkt).startsWith(targetMkt.split(" ")[0] ?? ""),
    ) ??
    sorted.find((b) => lastName(b.who) === targetLast) ??
    null
  );
}

export type OddsFormatKey = keyof MockBetLiveOdds;

export const ODDS_FORMAT_OPTIONS: Array<{
  key: OddsFormatKey;
  label: string;
}> = [
  { key: "am", label: "+250" },
  { key: "frac", label: "5/2" },
  { key: "dec", label: "3.5" },
];
