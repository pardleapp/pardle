"use client";

/**
 * BetPost — a tracked bet rendered as a feed post.
 *
 * Shape matches design-handoff/Pardle Social v2.html `<BetPost>`: the
 * bettor's avatar + "is sweating" line, a hero probability percentage
 * with up/down arrow, an inline chip carrying the bet (player · market
 * · stake @ odds), a thin sparkline of today's prob trajectory, then
 * a thread of the most recent shot events that touched the bet.
 *
 * Pass 2 of the broadcast-theme migration — keeps the wire data the
 * existing /api/feed already returns (currentOdds, topFinishCurrent,
 * oddsHistories) and skips kinds we don't yet have a clean live
 * probability path for (round-score, winning-score, top-finish without
 * a current snapshot). Those fall back to a placement-anchored static
 * card; full live behaviour will land alongside the bet-tracker
 * refresh in a later pass.
 */

import Link from "next/link";
import { useMemo } from "react";
import PlayerAvatar from "./PlayerAvatar";
import type { TrackedBet } from "./bet-shared";
import type { FeedRow } from "@/lib/feed/types";
import {
  formatBetCurrency,
  formatBetCurrencySigned,
  normaliseBetCurrency,
} from "@/lib/format/bet-currency";
import { betKindShortLabel } from "./bet-impact";

interface BetPostProps {
  bet: TrackedBet;
  currentOdds: Record<string, number>;
  topFinishCurrent?: Record<
    string,
    { top5: number; top10: number; top20: number }
  >;
  recentRowsForPlayer: FeedRow[];
  oddsHistory?: Array<{ ts: number; p: number }> | null;
}

interface BetUpdate {
  text: string;
  delta: string; // "+4" / "−2" / "0"
  dir: "up" | "down" | "flat";
}

function impliedProbFromDecimalOdds(decimal: number): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return 1 / decimal;
}

function currentProbForBet(
  bet: TrackedBet,
  currentOdds: Record<string, number>,
  topFinishCurrent?: BetPostProps["topFinishCurrent"],
): number | null {
  if (bet.kind === "outright") {
    const p = currentOdds[bet.playerId];
    return typeof p === "number" && p >= 0 && p <= 1 ? p : null;
  }
  if (bet.kind === "top-finish") {
    const snap = topFinishCurrent?.[bet.playerId];
    if (!snap) return null;
    const k = (`top${bet.cutoff}` as keyof typeof snap);
    const v = snap[k];
    return typeof v === "number" && v >= 0 && v <= 1 ? v : null;
  }
  // round-score / winning-score — fall back to placement-implied prob
  // until a richer current-prob path lands. The card still renders;
  // the direction arrow just stays flat.
  return null;
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function buildUpdates(rows: FeedRow[]): BetUpdate[] {
  return rows.slice(0, 3).map((row) => {
    const ev = row.event;
    let dir: BetUpdate["dir"] = "flat";
    let delta = "0";
    // Prefer outright-odds delta when present; otherwise use top-10
    // delta; otherwise fall back to the result (birdie up, bogey down).
    if (
      typeof ev.oddsBefore === "number" &&
      typeof ev.oddsAfter === "number"
    ) {
      const before = impliedProbFromDecimalOdds(ev.oddsBefore);
      const after = impliedProbFromDecimalOdds(ev.oddsAfter);
      if (before != null && after != null) {
        const deltaPct = Math.round((after - before) * 100);
        if (deltaPct !== 0) {
          dir = deltaPct > 0 ? "up" : "down";
          delta = deltaPct > 0 ? `+${deltaPct}` : `${deltaPct}`;
        }
      }
    } else if (
      typeof ev.top10Before === "number" &&
      typeof ev.top10After === "number"
    ) {
      const deltaPct = Math.round((ev.top10After - ev.top10Before) * 100);
      if (deltaPct !== 0) {
        dir = deltaPct > 0 ? "up" : "down";
        delta = deltaPct > 0 ? `+${deltaPct}` : `${deltaPct}`;
      }
    } else if (ev.result === "birdie" || ev.result === "eagle" || ev.result === "albatross") {
      dir = "up";
      delta = "+1";
    } else if (
      ev.result === "bogey" ||
      ev.result === "double" ||
      ev.result === "triple-plus"
    ) {
      dir = "down";
      delta = "−1";
    }
    return { text: ev.headline, delta, dir };
  });
}

/** Tiny sparkline component — 300×32 polyline of the most recent
 *  oddsHistory probabilities. */
function Spark({ hist, dir }: { hist: number[]; dir: "up" | "down" | "flat" }) {
  if (hist.length < 2) return null;
  const w = 300;
  const h = 32;
  const max = Math.max(...hist);
  const min = Math.min(...hist);
  const rng = Math.max(0.001, max - min);
  const pts = hist
    .map(
      (v, i) =>
        `${(i / (hist.length - 1)) * w},${h - ((v - min) / rng) * (h - 5) - 3}`,
    )
    .join(" ");
  const color =
    dir === "down" ? "var(--pv-down)" : dir === "up" ? "var(--pv-up)" : "var(--pv-dim)";
  const lastX = w;
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
        <circle cx={lastX} cy={lastY} r="3.5" fill={color} />
      </svg>
    </div>
  );
}

export default function BetPost({
  bet,
  currentOdds,
  topFinishCurrent,
  recentRowsForPlayer,
  oddsHistory,
}: BetPostProps) {
  const placementProb = useMemo(
    () => impliedProbFromDecimalOdds(bet.oddsTaken),
    [bet.oddsTaken],
  );
  const liveProb = useMemo(
    () => currentProbForBet(bet, currentOdds, topFinishCurrent),
    [bet, currentOdds, topFinishCurrent],
  );
  const probPct = liveProb != null
    ? Math.round(liveProb * 100)
    : placementProb != null
      ? Math.round(placementProb * 100)
      : null;
  const dir: "up" | "down" | "flat" =
    liveProb != null && placementProb != null
      ? Math.abs(liveProb - placementProb) < 0.005
        ? "flat"
        : liveProb > placementProb
          ? "up"
          : "down"
      : "flat";
  const updates = useMemo(
    () => buildUpdates(recentRowsForPlayer),
    [recentRowsForPlayer],
  );
  const currency = normaliseBetCurrency(bet.currency);
  const stakeLabel = formatBetCurrency(bet.stake, currency, {
    maximumFractionDigits: 0,
  });
  const oddsLabel = bet.oddsTakenLabel;
  const playerName = "playerName" in bet ? bet.playerName : null;
  const tm = timeAgo(bet.placedAt);
  const directionClass = dir === "down" ? "down" : dir;

  // Settled — render a compact settled card.
  if (bet.settledAt && bet.settledWon != null) {
    const won = bet.settledWon === true;
    const profit = won
      ? bet.stake * (bet.oddsTaken - 1)
      : -bet.stake;
    const profitLabel = formatBetCurrencySigned(profit, currency, {
      maximumFractionDigits: 0,
    });
    return (
      <Link href={`/live/bet/${bet.id}`} className="post bpost bp-settled">
        <div className="bp-head">
          {playerName && (
            <PlayerAvatar
              playerId={"playerId" in bet ? bet.playerId : ""}
              playerName={playerName}
              size="md"
            />
          )}
          <div className="bp-who">
            <div className="bp-who-nm">
              <span>Your bet</span>
            </div>
            <div className="bp-who-tm">Settled · tap to view</div>
          </div>
          <div className="bp-prob">
            <div
              className="bp-prob-v"
              style={{ color: won ? "var(--pv-up)" : "var(--pv-down)" }}
            >
              {profitLabel}
            </div>
            <div
              className="bp-prob-d"
              style={{ color: won ? "var(--pv-up)" : "var(--pv-down)" }}
            >
              {won ? "WON" : "LOST"}
            </div>
          </div>
        </div>
        <div className="bp-bet">
          {playerName && <span className="bp-bet-player">{playerName}</span>}
          <span className="bp-bet-mkt">{betKindShortLabel(bet).toUpperCase()}</span>
          <span className="bp-bet-stake">
            {stakeLabel} @ {oddsLabel}
          </span>
        </div>
      </Link>
    );
  }

  // Live — full BetPost.
  return (
    <Link
      href={`/live/bet/${bet.id}`}
      className={`post bpost${dir === "down" ? " down" : ""}`}
    >
      <div className="bp-head">
        {playerName && (
          <PlayerAvatar
            playerId={"playerId" in bet ? bet.playerId : ""}
            playerName={playerName}
            size="md"
          />
        )}
        <div className="bp-who">
          <div className="bp-who-nm">
            <span>You</span>
            <span className="bp-who-verb">are sweating</span>
          </div>
          <div className="bp-who-tm">{tm} ago · live</div>
        </div>
        <div className="bp-prob">
          <div
            className="bp-prob-v"
            style={{
              color: dir === "down" ? "var(--pv-down)" : "var(--pv-up)",
            }}
          >
            {probPct != null ? `${probPct}%` : "—"}
          </div>
          <div className={`bp-prob-d ${directionClass}`}>
            {dir === "up" ? "▲" : dir === "down" ? "▼" : "·"} live
          </div>
        </div>
      </div>
      <div className="bp-bet">
        {playerName && <span className="bp-bet-player">{playerName}</span>}
        <span className="bp-bet-mkt">{betKindShortLabel(bet).toUpperCase()}</span>
        <span className="bp-bet-stake">
          {stakeLabel} @ {oddsLabel}
        </span>
      </div>
      {oddsHistory && oddsHistory.length >= 2 && (
        <Spark hist={oddsHistory.map((s) => s.p)} dir={dir} />
      )}
      {updates.length > 0 && (
        <div className="bp-thread">
          {updates.map((u, i) => (
            <div className="bp-upd" key={i}>
              <span className={`bp-upd-dot ${u.dir}`} />
              <span className="bp-upd-text">{u.text}</span>
              <span className={`bp-upd-val ${u.dir}`}>
                {u.delta === "0" ? "—" : u.delta}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
