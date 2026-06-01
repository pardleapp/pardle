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
  cur: "£" | "$";
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
  cur: "£" | "$";
  stake: number;
  result: "WON" | "LOST";
  pl: string;
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

export type OddsFormatKey = keyof MockBetLiveOdds;

export const ODDS_FORMAT_OPTIONS: Array<{
  key: OddsFormatKey;
  label: string;
}> = [
  { key: "am", label: "+250" },
  { key: "frac", label: "5/2" },
  { key: "dec", label: "3.5" },
];
