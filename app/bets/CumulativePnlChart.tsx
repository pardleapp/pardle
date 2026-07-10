"use client";

/**
 * CumulativePnlChart — the bankroll-curve hero on the /bets desktop
 * dashboard. Takes settled bets in chronological order, computes
 * running P&L, and renders a single SVG area+line over the result.
 *
 * Deliberately self-contained: no chart library, no measurement, no
 * tooltips — sized via viewBox + preserveAspectRatio="none" so it
 * scales to its container's width on every viewport. Colour follows
 * the final cumulative value (green if up overall, red if down).
 */

import type { MockBetSettled } from "./mock-bets";

interface Props {
  bets: MockBetSettled[];
  /** Symbol used in y-axis labels — defaults to whichever currency
   *  dominates the input. The dashboard already picks a primary cur. */
  cur?: string;
}

function parsePnl(pl: string): number {
  const sign = pl.startsWith("−") || pl.startsWith("-") ? -1 : 1;
  const num = parseFloat(pl.replace(/[^0-9.]/g, "")) || 0;
  return sign * num;
}

export default function CumulativePnlChart({ bets, cur = "£" }: Props) {
  // Empty / single-point case — show a flat baseline rather than
  // collapsing the chart card. The dashboard still has visual weight.
  if (bets.length === 0) {
    return (
      <div className="pnl-chart pnl-chart-empty">
        <div className="pnl-chart-msg">
          Settle a bet to start your bankroll curve.
        </div>
      </div>
    );
  }

  // Cumulative running total, starting from 0 so the curve grows
  // from the y-axis baseline.
  const cum: number[] = [0];
  let running = 0;
  for (const b of bets) {
    running += parsePnl(b.pl);
    cum.push(running);
  }

  const w = 800;
  const h = 220;
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const max = Math.max(0, ...cum);
  const min = Math.min(0, ...cum);
  const rng = Math.max(1, max - min);

  const xFor = (i: number) =>
    padL + (i / Math.max(1, cum.length - 1)) * innerW;
  const yFor = (v: number) =>
    padT + ((max - v) / rng) * innerH;
  const yZero = yFor(0);

  const pts = cum.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
  // Area path: drop to baseline, walk the curve, drop back to baseline.
  const areaPath = [
    `M ${xFor(0)} ${yZero}`,
    ...cum.map((v, i) => `L ${xFor(i)} ${yFor(v)}`),
    `L ${xFor(cum.length - 1)} ${yZero}`,
    "Z",
  ].join(" ");

  const final = cum[cum.length - 1];
  const isUp = final >= 0;
  const lineColor = isUp ? "var(--pv-up)" : "var(--pv-down)";
  const fillColor = isUp
    ? "oklch(0.52 0.14 150 / 0.16)"
    : "oklch(0.57 0.19 28 / 0.16)";

  // Y-axis tick labels — three lines: max, zero, min (or just two
  // when one of those equals another).
  const ticks = Array.from(new Set([max, 0, min].filter((t, i, a) => a.indexOf(t) === i)));
  const fmt = (v: number) => {
    const sign = v > 0 ? "+" : v < 0 ? "−" : "";
    const isUnit = cur === "u";
    const body = Math.abs(v).toLocaleString("en-US", {
      maximumFractionDigits: isUnit ? 1 : 0,
    });
    return isUnit ? `${sign}${body}${cur}` : `${sign}${cur}${body}`;
  };

  return (
    <div className="pnl-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Cumulative P&L over ${bets.length} settled bets, currently ${fmt(final)}`}
      >
        {/* Zero baseline — sits at yZero so positive area is above, negative below. */}
        <line
          x1={padL}
          x2={w - padR}
          y1={yZero}
          y2={yZero}
          stroke="var(--pv-line)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {/* Filled area beneath the curve. */}
        <path d={areaPath} fill={fillColor} />
        {/* Curve itself. */}
        <polyline
          points={pts}
          fill="none"
          stroke={lineColor}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Dot on the final point. */}
        <circle
          cx={xFor(cum.length - 1)}
          cy={yFor(final)}
          r="4"
          fill={lineColor}
        />
        {/* Y-axis tick labels. */}
        {ticks.map((t) => (
          <text
            key={t}
            x={padL - 6}
            y={yFor(t) + 4}
            textAnchor="end"
            fontSize="11"
            fontFamily="var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace"
            fill="var(--pv-muted)"
          >
            {fmt(t)}
          </text>
        ))}
      </svg>
    </div>
  );
}
