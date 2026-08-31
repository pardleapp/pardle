/**
 * Display formatters for Pardle canonical bet-slip fields. Anything
 * that turns a machine value into a string on a feed card lives here
 * — keeps the React components lean and the copy consistent.
 *
 * Guardrail: user-facing copy never names a third-party data source
 * (per CLAUDE.md). The sportsbook the USER placed on (e.g.
 * "DraftKings") IS surfaced because it's their choice — not a data
 * source. But DataGolf, the odds aggregator, the win-probability
 * model — none of those get their names in strings.
 */

import type { PardleBetLeg, PardleBetSlip, PardleMarket } from "./types";

/** Turn a canonical market into a short label suitable for a
 *  bet-card market chip. Under 20 characters where possible so it
 *  fits alongside the player name + stake on a mobile row. */
export function formatMarket(m: PardleMarket): string {
  switch (m.kind) {
    case "outright-winner":
      return "Winner";
    case "top-finish":
      return `Top ${m.n}`;
    case "leader-after-round":
      return `R${m.round} Leader`;
    case "round-score":
      return `R${m.round} ${m.direction === "over" ? "O" : "U"} ${m.line}`;
    case "matchup":
      return m.opponent ? `vs ${shortenName(m.opponent.displayName)}` : "Matchup";
    case "make-cut":
      return "Make cut";
    case "unknown":
      return "Prop";
  }
}

/** "Rory McIlroy" → "R. McIlroy" for tight card layouts. Leaves
 *  single-name inputs alone. */
export function shortenName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const first = parts[0];
  const rest = parts.slice(1).join(" ");
  return `${first[0]}. ${rest}`;
}

/** American odds display: "+350" | "−140". Uses Unicode minus per
 *  the CLAUDE.md parse-Unicode-minus rule. */
export function formatOddsAmerican(oddsAmerican: number): string {
  if (!Number.isFinite(oddsAmerican)) return "";
  if (oddsAmerican >= 0) return `+${Math.round(oddsAmerican)}`;
  return `−${Math.abs(Math.round(oddsAmerican))}`;
}

/** Convert American odds to implied probability [0..1]. Used to
 *  render the % chip on a bet card when a live-model probability
 *  isn't available; otherwise the caller passes the model's number
 *  directly. */
export function impliedProbability(oddsAmerican: number): number {
  if (!Number.isFinite(oddsAmerican) || oddsAmerican === 0) return 0;
  if (oddsAmerican > 0) return 100 / (oddsAmerican + 100);
  const abs = Math.abs(oddsAmerican);
  return abs / (abs + 100);
}

/** Cents → localised currency string. Defaults to USD; the sportsbook
 *  contains the region hint we'd read if we wanted to derive it. */
export function formatStake(
  atRiskCents: number,
  currency: "USD" | "GBP" | "EUR" = "USD",
): string {
  const dollars = atRiskCents / 100;
  const symbol =
    currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  const rounded =
    Math.abs(dollars) >= 1000
      ? dollars.toFixed(0)
      : Math.abs(dollars) >= 10
        ? dollars.toFixed(0)
        : dollars.toFixed(2);
  return `${symbol}${rounded}`;
}

/** Slip-level "who / what / how much" summary for share cards and
 *  notifications. Golf legs only; a parlay lists them joined with
 *  " + ". Skips unknown-market legs gracefully. */
export function formatSlipHeadline(slip: PardleBetSlip): string {
  const parts = slip.golfLegs
    .map((leg) => formatLegSummary(leg))
    .filter(Boolean);
  if (parts.length === 0) return `${slip.book.name} bet`;
  if (parts.length === 1) return parts[0];
  return parts.join(" + ");
}

function formatLegSummary(leg: PardleBetLeg): string {
  const player = leg.player?.displayName ?? "player";
  const market = formatMarket(leg.market);
  return `${player} — ${market}`;
}

/** Relative-time string for the "X ago" strap on a bet card. Kept in
 *  the format helpers so it doesn't drift from bet-post copy. */
export function formatAgo(ts: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Net profit display for a settled slip. Positive = win, negative =
 *  loss. Handles push (0) and cashout gracefully. */
export function formatSlipResult(slip: PardleBetSlip): {
  amount: string;
  outcome: "win" | "loss" | "push" | "cashout" | "pending";
} {
  const cents = slip.netProfitCents ?? 0;
  const abs = formatStake(Math.abs(cents));
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return {
    amount: cents === 0 && slip.outcome !== "cashout" ? "$0" : `${sign}${abs}`,
    outcome: slip.outcome,
  };
}
