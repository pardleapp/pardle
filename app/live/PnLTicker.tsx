"use client";

/**
 * PnLTicker — sticky emerald-dark bar under SweatHeader.
 *
 * Prototype shape:
 *   [LADS P&L] [JO Jordan +£312] [YO You +£186] [TH Theo +£54] [▾]
 *
 * Today Groups isn't built (step 4 in the redesign roadmap), so the
 * "crew" P&L is faked from the user's own tracked bets: open stake
 * + a coarse P&L estimate from the same fair-value math the bet
 * tracker uses. When a real Groups backend lands this becomes the
 * member list with shared P&L; everything renders the same.
 *
 * When the caller has no tracked bets there's nothing meaningful to
 * surface — return null so the feed paints straight under the
 * header.
 */

import type { TrackedBet } from "./bet-shared";
import { formatBetCurrency, normaliseBetCurrency } from "@/lib/format/bet-currency";

interface Props {
  trackedBets: TrackedBet[];
  /** Caller's display name from Supabase auth — when null we fall
   *  back to "You" in the personal chip. */
  displayName?: string | null;
}

interface ChipDatum {
  initials: string;
  name: string;
  pl: number;
  /** Currency for formatting — defaults to user's first bet's
   *  currency, falls back to GBP. */
  currency: ReturnType<typeof normaliseBetCurrency>;
  you: boolean;
}

function impliedProbFromDecimal(decimal: number): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return 1 / decimal;
}

function estimateBetPnl(bet: TrackedBet): number {
  // Rough placement-based estimate — doesn't fold in live prob
  // motion yet. Settled bets use the actual win/loss; unsettled use
  // 0 (no claim on direction without the live engine path).
  if (bet.settledAt != null && bet.settledWon != null) {
    return bet.settledWon ? bet.stake * (bet.oddsTaken - 1) : -bet.stake;
  }
  return 0;
}

export default function PnLTicker({ trackedBets, displayName }: Props) {
  if (!trackedBets || trackedBets.length === 0) return null;

  let totalPnl = 0;
  let totalStake = 0;
  let currency = normaliseBetCurrency(undefined);
  for (const b of trackedBets) {
    totalStake += Number(b.stake) || 0;
    totalPnl += estimateBetPnl(b);
    if (b.currency) currency = normaliseBetCurrency(b.currency);
  }

  // For the "crew" placeholder we manufacture a small list — caller
  // first (highlighted), then two anonymous teaser chips so the bar
  // shape matches the prototype's "Lads P&L" rail until Groups
  // lands and supplies the real members.
  const youInitials = (() => {
    const raw = (displayName ?? "You").trim();
    if (!raw) return "YO";
    const parts = raw.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();

  const chips: ChipDatum[] = [
    {
      initials: youInitials,
      name: displayName ?? "You",
      pl: totalPnl,
      currency,
      you: true,
    },
  ];

  const fmtSigned = (n: number) => {
    const sign = n >= 0 ? "+" : "−";
    const raw = formatBetCurrency(Math.abs(n), currency, {
      maximumFractionDigits: 0,
    });
    return `${sign}${raw}`;
  };

  return (
    <div className="pv-ticker" role="region" aria-label="Crew P&amp;L">
      <span className="pv-ticker-lbl">
        Your
        <br />
        P&amp;L
      </span>
      {chips.map((c, i) => (
        <div
          key={i}
          className={`pv-ticker-item${c.you ? " pv-ticker-item-you" : ""}`}
        >
          <span className="pv-ticker-av" aria-hidden="true">
            {c.initials}
          </span>
          <span className="pv-ticker-nm">{c.name}</span>
          <span
            className={`pv-ticker-pl ${c.pl >= 0 ? "up" : "down"}`}
          >
            {fmtSigned(c.pl)}
          </span>
        </div>
      ))}
      <span className="pv-ticker-stake">
        stake {formatBetCurrency(totalStake, currency, { maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}
