"use client";

/**
 * BetRow — single bet card in the /bets Live list. Matches the
 * design-handoff prototype's <BetRow>:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ R. Henley                          54% ▲ live │
 *   │ ┌─────────────────────┐                       │
 *   │ │ OUTRIGHT WIN  £50 @ +250 │                  │
 *   │ └─────────────────────┘                       │
 *   │ ░░░░░▁▂▃▅▆▇ ●                                 │
 *   │ 3 shots tracked · tap for detail            › │
 *   └──────────────────────────────────────────────┘
 *
 * Tap the whole row to open /bets/[id] (the prototype's BetDetail
 * overlay equivalent). Sparkline is hand-drawn SVG — same approach
 * BetPost uses elsewhere.
 */

import Link from "next/link";
import type { MockBetLive, OddsFormatKey } from "./mock-bets";

interface Props {
  bet: MockBetLive;
  oddsFmt: OddsFormatKey;
}

function Spark({
  hist,
  dir,
}: {
  hist: number[];
  dir: "up" | "down";
}) {
  if (hist.length < 2) return null;
  const w = 300;
  const h = 32;
  const max = Math.max(...hist);
  const min = Math.min(...hist);
  const rng = Math.max(0.001, max - min);
  const pts = hist
    .map(
      (v, i) =>
        `${(i / (hist.length - 1)) * w},${
          h - ((v - min) / rng) * (h - 5) - 3
        }`,
    )
    .join(" ");
  const color = dir === "down" ? "var(--pv-down)" : "var(--pv-up)";
  const lastY = h - ((hist[hist.length - 1] - min) / rng) * (h - 5) - 3;
  return (
    <div className="bp-spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={w} cy={lastY} r="3.5" fill={color} />
      </svg>
    </div>
  );
}

export default function BetRow({ bet, oddsFmt }: Props) {
  const odds = bet.odds[oddsFmt];
  const probColor =
    bet.dir === "down" ? "var(--pv-down)" : "var(--pv-up)";
  return (
    <Link
      href={`/live/bet/${bet.id}`}
      className="bets-row-card"
      prefetch={false}
    >
      <div className="bp-head">
        <div className="bp-who">
          <div className="bets-row-name">{bet.who}</div>
          <div className="bets-row-chip">
            <span className="bp-bet-mkt">{bet.mkt}</span>
            <span className="bp-bet-stake">
              {bet.cur === "u"
                ? `${bet.stake}${bet.cur}`
                : `${bet.cur}${bet.stake}`}{" "}
              @ {odds}
            </span>
          </div>
        </div>
        <div className="bp-prob">
          <div className="bp-prob-v" style={{ color: probColor }}>
            {bet.prob}%
          </div>
          <div className={`bp-prob-d ${bet.dir}`}>
            {bet.dir === "up" ? "▲" : "▼"} live
          </div>
        </div>
      </div>
      <Spark hist={bet.hist} dir={bet.dir} />
      <div className="bets-row-footer">
        <span className="bets-row-shots">
          {bet.tl.length} shots tracked · tap for detail
        </span>
        <span className="bets-row-chev" aria-hidden="true">
          ›
        </span>
      </div>
    </Link>
  );
}
