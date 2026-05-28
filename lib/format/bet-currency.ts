/**
 * Per-bet currency support. Users coming from US books (DraftKings,
 * FanDuel), EU books (Bet365, Unibet), or Polymarket all bet in
 * different units — surfacing "£42" PnL to a US user with a $50
 * bet on DraftKings makes the whole tracker feel wrong.
 *
 * Each tracked bet carries its own currency stamp captured at
 * placement. Existing bets without the field default to GBP for
 * backward compat (Pardle launched UK-first).
 */

export type BetCurrency = "GBP" | "USD" | "EUR" | "AUD" | "CAD";

export const BET_CURRENCIES: BetCurrency[] = [
  "GBP",
  "USD",
  "EUR",
  "AUD",
  "CAD",
];

export const DEFAULT_BET_CURRENCY: BetCurrency = "GBP";

/** Locale matched to each currency so symbols and grouping render
 *  natively. en-GB for £, en-US for $, de-DE for €, en-AU for A$,
 *  en-CA for C$. */
const LOCALE_FOR_CURRENCY: Record<BetCurrency, string> = {
  GBP: "en-GB",
  USD: "en-US",
  EUR: "de-DE",
  AUD: "en-AU",
  CAD: "en-CA",
};

export function normaliseBetCurrency(v: unknown): BetCurrency {
  if (typeof v === "string" && (BET_CURRENCIES as string[]).includes(v)) {
    return v as BetCurrency;
  }
  return DEFAULT_BET_CURRENCY;
}

/** Currency-aware formatter. Optionally formats with a fractional
 *  digit count override — useful for the chip-sized "+£42" display
 *  vs the full hero "+£42.50". */
export function formatBetCurrency(
  amount: number,
  currency: BetCurrency = DEFAULT_BET_CURRENCY,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  const cur = normaliseBetCurrency(currency);
  const locale = LOCALE_FOR_CURRENCY[cur];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cur,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
    minimumFractionDigits: opts.minimumFractionDigits ?? 0,
  }).format(amount);
}

/** Signed PnL formatter — keeps the +/- sign visible on the chart
 *  hero. Uses 'always' signDisplay rather than relying on the
 *  number itself to carry the minus. */
export function formatBetCurrencySigned(
  amount: number,
  currency: BetCurrency = DEFAULT_BET_CURRENCY,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  const cur = normaliseBetCurrency(currency);
  const locale = LOCALE_FOR_CURRENCY[cur];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cur,
    signDisplay: "always",
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
    minimumFractionDigits: opts.minimumFractionDigits ?? 0,
  }).format(amount);
}

/** Tight chip-sized format — no decimals, with sign. "+£42" not
 *  "+£42.00". Used by the feed-row impact chip where horizontal
 *  space is at a premium. */
export function formatBetCurrencyChip(
  amount: number,
  currency: BetCurrency = DEFAULT_BET_CURRENCY,
): string {
  return formatBetCurrencySigned(amount, currency, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}
