"use client";

/**
 * BetsClient — /bets surface, redesigned to match the design-handoff
 * prototype (Pardle Social v2.html, Bets + BetRow components).
 *
 * First-cut layout uses the prototype's mock bets verbatim so the
 * visual is exact end-to-end. Real wiring (own tracked bets from
 * the bet store, live currentOdds / projections / top-finish from
 * /api/feed) lands in the next pass — the rendering path stays the
 * same; only the data source switches.
 *
 * Header: "My bets · N" + odds-format toggle (+250 / 5/2 / 3.5) +
 * small ＋ add-bet button.
 * Live / Settled segmented tabs with counts.
 * Live tab: summary card (open stake + group rank) + bet rows.
 * Settled tab: summary card (net + hit rate) + settled rows.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ODDS_FORMAT_OPTIONS,
  type OddsFormatKey,
  type MockBetSettled,
} from "./mock-bets";
import BetRow from "./BetRow";
import SettlementModal, { type SettlementData } from "./SettlementModal";
import ShareCard from "./ShareCard";
import { useRealBets } from "./useRealBets";
import AddBetTrigger from "@/app/_components/AddBetTrigger";
import CumulativePnlChart from "./CumulativePnlChart";

/** Settled-tab filter axes. Every axis defaults to "all" (no
 *  restriction); the filter chips clear back to "all" when the user
 *  taps the currently-selected one. */
type MarketFilter =
  | "all"
  | "outright"
  | "top-finish"
  | "round-score"
  | "winning-score"
  | "without";
type TimeframeFilter = "all" | "7d" | "30d" | "90d" | "ytd";

const MARKET_FILTERS: Array<{ key: MarketFilter; label: string }> = [
  { key: "all", label: "All markets" },
  { key: "outright", label: "Outright" },
  { key: "top-finish", label: "Top-N" },
  { key: "without", label: "Without X" },
  { key: "round-score", label: "Round score" },
  { key: "winning-score", label: "Winning score" },
];
const TIMEFRAME_FILTERS: Array<{ key: TimeframeFilter; label: string }> = [
  { key: "all", label: "All time" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "ytd", label: "YTD" },
];

/** Turn a timeframe key into an epoch-ms lower bound. "all" → 0. */
function timeframeStartMs(tf: TimeframeFilter, now: number): number {
  if (tf === "all") return 0;
  const DAY = 24 * 60 * 60 * 1000;
  if (tf === "7d") return now - 7 * DAY;
  if (tf === "30d") return now - 30 * DAY;
  if (tf === "90d") return now - 90 * DAY;
  // YTD — anchor to Jan 1 in the user's local timezone.
  const jan1 = new Date();
  jan1.setMonth(0, 1);
  jan1.setHours(0, 0, 0, 0);
  return jan1.getTime();
}

/** RFC-4180 safe CSV cell — wraps in quotes when the value contains
 *  a comma, quote, or newline; doubles any embedded quote. Empty and
 *  numeric values pass through untouched. */
function csvCell(v: string | number | undefined | null): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** ISO date in the user's timezone, minute precision — human-readable
 *  in Excel and still sortable as text. */
function csvDate(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Parse a formatted P&L string ("+£340", "−u2.5") back into a signed
 *  number for CSV export. Unicode minus and ASCII hyphen both count
 *  as negative. */
function csvPnlNumber(pl: string): number {
  const sign = pl.startsWith("−") || pl.startsWith("-") ? -1 : 1;
  const abs = parseFloat(pl.replace(/[^0-9.]/g, "")) || 0;
  return sign * abs;
}

/** Build the settlement-modal data from a MockBetSettled — derives
 *  returnedLabel for wins (stake × odds), books a mock daily P&L
 *  + group rank string. Will swap to real settlement engine output
 *  when that wires in. */
function buildSettlementData(b: MockBetSettled): SettlementData {
  const decOdds = parseFloat(b.odds) || 0;
  const returnedAmount = b.result === "WON" ? Math.round(b.stake * decOdds) : 0;
  const returnedLabel = returnedAmount
    ? b.cur === "u"
      ? `${returnedAmount.toLocaleString("en-US")}${b.cur}`
      : `${b.cur}${returnedAmount.toLocaleString("en-US")}`
    : undefined;
  return {
    win: b.result === "WON",
    profitLabel: b.pl,
    returnedLabel,
    player: b.who,
    market: b.mkt,
    currency: b.cur,
    stake: b.stake,
    oddsLabel: b.odds,
    // No demo "+£226 daily" or "2nd in The Lads" group rank — the
    // settlement modal shows real-bet-only data. Real daily-pnl /
    // group-rank wiring is a follow-up; until then the modal omits
    // these two lines rather than show invented numbers.
    bookedDailyPnl: undefined,
    groupRank: undefined,
  };
}

const ODDS_FORMAT_STORAGE = "pardle_bets_oddsfmt_v2";

function readPersistedFormat(): OddsFormatKey {
  if (typeof window === "undefined") return "am";
  const raw = window.localStorage.getItem(ODDS_FORMAT_STORAGE);
  if (raw === "am" || raw === "frac" || raw === "dec") return raw;
  return "am";
}

export default function BetsClient() {
  const [oddsFmt, setOddsFmt] = useState<OddsFormatKey>("am");
  const [tab, setTab] = useState<"live" | "settled">("live");
  const [settle, setSettle] = useState<SettlementData | null>(null);
  const [shareData, setShareData] = useState<SettlementData | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Real tracked bets — same source the inline /live BetTracker uses
  // (localStorage + Supabase, valued via /api/feed). Replaces the
  // MOCK_BETS_LIVE / MOCK_BETS_SETTLED constants this page rendered
  // until tonight.
  const { live: bets, settled: settledBets, ready } = useRealBets();

  // Settled-tab filters — market kind, tournament, timeframe. Each
  // axis is independent; the visible list AND the aggregate summary
  // above it recompute against the intersection.
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [tournamentFilter, setTournamentFilter] = useState<string>("all");
  const [timeframeFilter, setTimeframeFilter] = useState<TimeframeFilter>("all");

  // Deep-link support: /bets?settle=s1 opens the settlement moment
  // for a given settled bet id. Used by the feed's compact settled-
  // bet card so tapping it reopens the modal.
  useEffect(() => {
    const id = searchParams.get("settle");
    if (!id) return;
    const bet = settledBets.find((b) => b.id === id);
    if (!bet) return;
    setSettle(buildSettlementData(bet));
    // Strip the query param so a refresh doesn't reopen.
    const url = new URL(window.location.href);
    url.searchParams.delete("settle");
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [searchParams, router, settledBets]);

  // When the user dismisses the share card, also clear settle so we
  // don't bounce them back to the modal.
  const closeShare = () => {
    setShareData(null);
    setSettle(null);
  };

  // Stamp html.pv-theme-body while /bets is mounted so the body bg
  // goes warm paper and the brand bar re-skins paper.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  // Hydrate persisted odds format on mount.
  useEffect(() => {
    setOddsFmt(readPersistedFormat());
  }, []);

  const pickFormat = (k: OddsFormatKey) => {
    setOddsFmt(k);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ODDS_FORMAT_STORAGE, k);
    }
  };

  const liveCount = bets.length;
  const settledCount = settledBets.length;
  const totalCount = liveCount + settledCount;

  // Open stake summary — sum by currency so we can render "£90·$100".
  const openByCur: Record<string, number> = {};
  for (const b of bets) {
    openByCur[b.cur] = (openByCur[b.cur] ?? 0) + b.stake;
  }
  const openStakeLabel = Object.entries(openByCur)
    .map(([cur, n]) => (cur === "u" ? `${n}${cur}` : `${cur}${n}`))
    .join("·");

  // Settled summary — net (per currency) + hit rate.
  let wins = 0;
  let losses = 0;
  const netByCur: Record<string, number> = {};
  for (const b of settledBets) {
    if (b.result === "WON") wins++;
    else losses++;
    // Strip "+£" / "−$" / commas, parse number.
    const sign = b.pl.startsWith("−") || b.pl.startsWith("-") ? -1 : 1;
    const num = parseFloat(b.pl.replace(/[^0-9.]/g, "")) || 0;
    netByCur[b.cur] = (netByCur[b.cur] ?? 0) + sign * num;
  }
  const netLabel = Object.entries(netByCur)
    .map(([cur, n]) => {
      const abs = Math.abs(n);
      const sign = n >= 0 ? "+" : "−";
      const body = abs.toLocaleString("en-US", {
        maximumFractionDigits: cur === "u" ? 1 : 0,
      });
      return cur === "u" ? `${sign}${body}${cur}` : `${sign}${cur}${body}`;
    })
    .join(" · ");
  const hitPct = wins + losses > 0
    ? Math.round((wins / (wins + losses)) * 100)
    : 0;

  // Desktop dashboard stats — primary currency is the most common
  // among the user's bets (or £ if nothing tracked yet). Multi-
  // currency users get a "·"-joined fallback on the staked tile.
  const allBets = [...bets, ...settledBets];
  const curCounts: Record<string, number> = {};
  for (const b of allBets) {
    curCounts[b.cur] = (curCounts[b.cur] ?? 0) + 1;
  }
  const primaryCur = (Object.entries(curCounts).sort((a, b) => b[1] - a[1])[0]?.[0]) || "£";
  const totalStakeAll = allBets
    .filter((b) => b.cur === primaryCur)
    .reduce((acc, b) => acc + b.stake, 0);
  const openStakePri = bets
    .filter((b) => b.cur === primaryCur)
    .reduce((acc, b) => acc + b.stake, 0);
  const realisedPri = netByCur[primaryCur] ?? 0;
  // Live fair-value PnL = sum across live bets of EV (prob * potential
  // return − stake). Same fair-value the bet detail chart shows.
  const livePri = bets
    .filter((b) => b.cur === primaryCur)
    .reduce((acc, b) => {
      const dec = parseFloat(b.odds.dec) || 0;
      const ev = (b.prob / 100) * b.stake * dec - b.stake;
      return acc + ev;
    }, 0);
  const settledStakePri = settledBets
    .filter((b) => b.cur === primaryCur)
    .reduce((acc, b) => acc + b.stake, 0);
  const roiPct = settledStakePri > 0 ? (realisedPri / settledStakePri) * 100 : 0;
  // Biggest single-bet win.
  let biggestWin = 0;
  let biggestWinLabel = "";
  for (const b of settledBets) {
    if (b.result !== "WON" || b.cur !== primaryCur) continue;
    const pl = (b.pl.startsWith("−") || b.pl.startsWith("-") ? -1 : 1) *
      (parseFloat(b.pl.replace(/[^0-9.]/g, "")) || 0);
    if (pl > biggestWin) {
      biggestWin = pl;
      biggestWinLabel = `${b.who} · ${b.mkt}`;
    }
  }
  // ── Settled-tab: unique tournaments seen in the settled feed ────
  // Populates the tournament dropdown. Order is most-recent-first
  // (by max settledAt within the group) so the current event stays
  // near the top.
  const tournamentOptions = useMemo(() => {
    const map = new Map<string, { name: string; latestTs: number }>();
    for (const b of settledBets) {
      if (!b.tournamentId) continue;
      const name = b.tournamentName || b.tournamentId;
      const ts = b.settledAt ?? b.placedAt ?? 0;
      const prev = map.get(b.tournamentId);
      if (!prev || ts > prev.latestTs) {
        map.set(b.tournamentId, { name, latestTs: ts });
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, name: v.name, latestTs: v.latestTs }))
      .sort((a, b) => b.latestTs - a.latestTs);
  }, [settledBets]);

  // ── Settled-tab: filtered slice + per-slice metrics ─────────────
  const filteredSettled = useMemo(() => {
    const now = Date.now();
    const start = timeframeStartMs(timeframeFilter, now);
    return settledBets.filter((b) => {
      if (marketFilter !== "all" && b.kind !== marketFilter) return false;
      if (tournamentFilter !== "all" && b.tournamentId !== tournamentFilter) {
        return false;
      }
      if (timeframeFilter !== "all") {
        const ts = b.settledAt ?? b.placedAt ?? 0;
        if (ts < start) return false;
      }
      return true;
    });
  }, [settledBets, marketFilter, tournamentFilter, timeframeFilter]);

  // Slice metrics — count, staked, realised PnL by currency, W/L,
  // hit rate, ROI. Renders in the filtered stats strip so users see
  // "how does 'outright at the Masters last 90d' actually score?".
  const sliceMetrics = useMemo(() => {
    const netByCur: Record<string, number> = {};
    const stakedByCur: Record<string, number> = {};
    // Primary-currency subset for ROI + biggest-win — mixing currencies
    // in a % or "£X" tile would be nonsense.
    let primaryStakeSum = 0;
    let primaryNetSum = 0;
    let primaryBiggestWin = 0;
    let primaryBiggestWinLabel = "";
    let sliceWins = 0;
    let sliceLosses = 0;
    let oddsSum = 0;
    for (const b of filteredSettled) {
      if (b.result === "WON") sliceWins++;
      else sliceLosses++;
      const sign = b.pl.startsWith("−") || b.pl.startsWith("-") ? -1 : 1;
      const num = parseFloat(b.pl.replace(/[^0-9.]/g, "")) || 0;
      netByCur[b.cur] = (netByCur[b.cur] ?? 0) + sign * num;
      stakedByCur[b.cur] = (stakedByCur[b.cur] ?? 0) + b.stake;
      const dec = parseFloat(b.odds) || 0;
      if (dec > 1) oddsSum += dec;
      if (b.cur === primaryCur) {
        primaryStakeSum += b.stake;
        primaryNetSum += sign * num;
        const pl = sign * num;
        if (b.result === "WON" && pl > primaryBiggestWin) {
          primaryBiggestWin = pl;
          primaryBiggestWinLabel = `${b.who} · ${b.mkt}`;
        }
      }
    }
    const total = sliceWins + sliceLosses;
    return {
      count: filteredSettled.length,
      wins: sliceWins,
      losses: sliceLosses,
      netByCur,
      stakedByCur,
      hitPct: total > 0 ? Math.round((sliceWins / total) * 100) : 0,
      primaryStakeSum,
      primaryNetSum,
      primaryRoiPct:
        primaryStakeSum > 0 ? (primaryNetSum / primaryStakeSum) * 100 : 0,
      primaryBiggestWin,
      primaryBiggestWinLabel,
      avgOdds: filteredSettled.length > 0 ? oddsSum / filteredSettled.length : 0,
    };
  }, [filteredSettled, primaryCur]);

  const filtersActive =
    marketFilter !== "all" ||
    tournamentFilter !== "all" ||
    timeframeFilter !== "all";

  const clearFilters = () => {
    setMarketFilter("all");
    setTournamentFilter("all");
    setTimeframeFilter("all");
  };

  /** Export the current filtered slice to a CSV that Excel opens
   *  natively. Uses the filters the user has active — including
   *  "all" — so the button always reflects what's on-screen. The
   *  file is generated client-side (no server round-trip) so the
   *  export lands instantly and never leaves the device. */
  const exportCsv = () => {
    if (typeof window === "undefined") return;
    if (filteredSettled.length === 0) return;
    const headers = [
      "Placed at",
      "Settled at",
      "Tournament",
      "Market",
      "Player",
      "Excluded (Without X)",
      "Side",
      "Round",
      "Line",
      "Top-N cutoff",
      "Odds (decimal)",
      "Odds (label)",
      "Stake",
      "Currency",
      "Result",
      "P&L",
    ];
    const rows = filteredSettled.map((b) => [
      csvDate(b.placedAt),
      csvDate(b.settledAt),
      b.tournamentName ?? "",
      b.mkt,
      b.who,
      b.withoutPlayerName ?? "",
      b.side ?? "",
      b.round ?? "",
      b.line ?? "",
      b.cutoff ?? "",
      b.oddsDecimal != null ? b.oddsDecimal.toFixed(2) : "",
      b.odds,
      b.stake,
      b.cur,
      b.result,
      csvPnlNumber(b.pl).toFixed(2),
    ]);
    // Filename encodes the filter context so a downloaded file's
    // identity survives out of the browser.
    const parts = [
      "pardle-bets",
      marketFilter !== "all" ? marketFilter : null,
      tournamentFilter !== "all"
        ? (tournamentOptions
            .find((t) => t.id === tournamentFilter)
            ?.name.toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") ?? tournamentFilter)
        : null,
      timeframeFilter !== "all" ? timeframeFilter : null,
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean);
    const filename = `${parts.join("-")}.csv`;
    // BOM keeps Excel on Windows from misreading the Unicode minus
    // in the P&L column as Latin-1.
    const csv =
      "﻿" +
      [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** Format a per-currency dict into "+£120 · −$40" style. Handles
   *  units ("u" as suffix) and the empty case ("—"). */
  const formatByCurWithSign = (
    dict: Record<string, number>,
    { showSign }: { showSign: boolean },
  ): string => {
    const entries = Object.entries(dict);
    if (entries.length === 0) return "—";
    return entries
      .map(([cur, n]) => {
        const abs = Math.abs(n);
        const s = n >= 0 ? (showSign ? "+" : "") : "−";
        const body = abs.toLocaleString("en-US", {
          maximumFractionDigits: cur === "u" ? 1 : 0,
        });
        return cur === "u" ? `${s}${body}${cur}` : `${s}${cur}${body}`;
      })
      .join(" · ");
  };

  const fmtMoney = (v: number, withSign = false) => {
    const sign = v > 0 && withSign ? "+" : v < 0 ? "−" : "";
    const isUnit = primaryCur === "u";
    const body = Math.abs(v).toLocaleString("en-US", {
      maximumFractionDigits: isUnit ? 1 : 0,
    });
    return isUnit
      ? `${sign}${body}${primaryCur}`
      : `${sign}${primaryCur}${body}`;
  };
  const fmtPct = (v: number) => {
    const sign = v > 0 ? "+" : v < 0 ? "−" : "";
    return `${sign}${Math.abs(v).toFixed(1)}%`;
  };
  const signClass = (v: number) =>
    v > 0 ? "stat-up" : v < 0 ? "stat-down" : "";

  return (
    <section className="bets-pv">
      <div className="betshead">
        <div className="betsrow">
          <h2 className="betsrow-title">My bets · {totalCount}</h2>
          <div className="oddstog" role="radiogroup" aria-label="Odds format">
            {ODDS_FORMAT_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={oddsFmt === o.key}
                className={oddsFmt === o.key ? "on" : ""}
                onClick={() => pickFormat(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {/* Prominent header CTA — desktop primary affordance. The FAB
              stays for mobile reach, but desktop users were missing the
              bottom-right corner entirely. The button dispatches a
              window event that AddBetTrigger listens for. */}
          <button
            type="button"
            className="bets-track-cta"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("pardle:open-add-bet"));
              }
            }}
          >
            <span className="bets-track-cta-plus" aria-hidden="true">+</span>
            <span>Track a bet</span>
          </button>
        </div>
      </div>

      {/* Desktop dashboard — full-width stats strip + cumulative P&L
          chart. Hidden via CSS on <1024px so mobile stays the
          single-column tracker it was. */}
      <div className="bets-dash">
        <div className="bets-stat-strip">
          <div className="bets-stat-tile">
            <div className="bets-stat-lab">Total staked</div>
            <div className="bets-stat-val mono">{fmtMoney(totalStakeAll)}</div>
            <div className="bets-stat-sub">{allBets.length} {allBets.length === 1 ? "bet" : "bets"}</div>
          </div>
          <div className="bets-stat-tile">
            <div className="bets-stat-lab">Open stake</div>
            <div className="bets-stat-val mono">{fmtMoney(openStakePri)}</div>
            <div className="bets-stat-sub">{liveCount} live</div>
          </div>
          <div className="bets-stat-tile">
            <div className="bets-stat-lab">Realised P&amp;L</div>
            <div className={`bets-stat-val mono ${signClass(realisedPri)}`}>
              {settledCount > 0 ? fmtMoney(realisedPri, true) : "—"}
            </div>
            <div className="bets-stat-sub">{settledCount} settled</div>
          </div>
          <div className="bets-stat-tile">
            <div className="bets-stat-lab">Live P&amp;L</div>
            <div className={`bets-stat-val mono ${signClass(livePri)}`}>
              {liveCount > 0 ? fmtMoney(livePri, true) : "—"}
            </div>
            <div className="bets-stat-sub">fair value</div>
          </div>
          <div className="bets-stat-tile">
            <div className="bets-stat-lab">Win rate</div>
            <div className="bets-stat-val mono">{wins + losses > 0 ? `${hitPct}%` : "—"}</div>
            <div className="bets-stat-sub">{wins} W · {losses} L</div>
          </div>
          <div className="bets-stat-tile">
            <div className="bets-stat-lab">ROI</div>
            <div className={`bets-stat-val mono ${signClass(roiPct)}`}>
              {settledStakePri > 0 ? fmtPct(roiPct) : "—"}
            </div>
            <div className="bets-stat-sub">on settled stake</div>
          </div>
          <div className="bets-stat-tile">
            <div className="bets-stat-lab">Biggest win</div>
            <div className={`bets-stat-val mono ${biggestWin > 0 ? "stat-up" : ""}`}>
              {biggestWin > 0 ? fmtMoney(biggestWin, true) : "—"}
            </div>
            <div className="bets-stat-sub">
              {biggestWinLabel || "no wins yet"}
            </div>
          </div>
        </div>
        <div className="bets-chart-card">
          <div className="bets-chart-head">
            <div className="bets-chart-title">Cumulative P&amp;L</div>
            <div className="bets-chart-sub">
              {settledCount > 0
                ? `${settledCount} settled bets · running total`
                : "No settled bets yet — start tracking"}
            </div>
          </div>
          <CumulativePnlChart bets={settledBets} cur={primaryCur} />
        </div>
      </div>

      <div className="lstog" role="tablist" aria-label="Live or Settled">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "live"}
          className={tab === "live" ? "on" : ""}
          onClick={() => setTab("live")}
        >
          Live <span className="lstog-cnt mono">{liveCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "settled"}
          className={tab === "settled" ? "on" : ""}
          onClick={() => setTab("settled")}
        >
          Settled <span className="lstog-cnt mono">{settledCount}</span>
        </button>
      </div>

      <div className="bets-pv-body">
        {tab === "live" ? (
          <>
            {/* Mobile-only summary tile — desktop gets the strip above. */}
            <div className="bets-summary bets-summary-mobile">
              <div>
                <div className="bets-summary-lab">Open stake</div>
                <div className="bets-summary-big mono">
                  {openStakeLabel || "—"}
                </div>
                <div className="bets-summary-legs">
                  {bets.length > 0
                    ? `${bets.length} live ${bets.length === 1 ? "bet" : "bets"}`
                    : "no live bets yet"}
                </div>
              </div>
            </div>
            {bets.length === 0 ? (
              <div className="bets-empty">
                <div className="bets-empty-title">
                  {ready ? "No live bets" : "Loading your bets…"}
                </div>
                {ready && (
                  <div className="bets-empty-sub">
                    Tap the green ＋ at the bottom of the screen to
                    track a bet — fair-value P&amp;L moves with every
                    shot.
                  </div>
                )}
              </div>
            ) : (
              <div className="bets-grid">
                {bets.map((b) => <BetRow key={b.id} bet={b} oddsFmt={oddsFmt} />)}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Filter row — market, tournament, timeframe. Present
                above the summary card so the summary numbers reflect
                whatever the user's currently slicing. Sticks around
                even if the filtered slice is empty so they can un-
                filter without hunting for the Clear button. */}
            {settledBets.length > 0 && (
              <div className="bets-filters">
                <div className="bets-filter-row">
                  <div className="bets-filter-lab">Market</div>
                  <div className="bets-filter-chips">
                    {MARKET_FILTERS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        className={`bets-filter-chip${
                          marketFilter === f.key ? " on" : ""
                        }`}
                        onClick={() => setMarketFilter(f.key)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                {tournamentOptions.length > 0 && (
                  <div className="bets-filter-row">
                    <div className="bets-filter-lab">Tournament</div>
                    <select
                      className="bets-filter-select"
                      value={tournamentFilter}
                      onChange={(e) => setTournamentFilter(e.target.value)}
                    >
                      <option value="all">All tournaments</option>
                      {tournamentOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="bets-filter-row">
                  <div className="bets-filter-lab">Timeframe</div>
                  <div className="bets-filter-chips">
                    {TIMEFRAME_FILTERS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        className={`bets-filter-chip${
                          timeframeFilter === f.key ? " on" : ""
                        }`}
                        onClick={() => setTimeframeFilter(f.key)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bets-filter-actions">
                  {filtersActive && (
                    <button
                      type="button"
                      className="bets-filter-clear"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </button>
                  )}
                  <button
                    type="button"
                    className="bets-filter-export"
                    onClick={exportCsv}
                    disabled={filteredSettled.length === 0}
                    title={
                      filteredSettled.length === 0
                        ? "No settled bets in this slice to export"
                        : `Export ${filteredSettled.length} bets to CSV`
                    }
                  >
                    <span aria-hidden="true">↓</span> Export CSV
                    {filtersActive
                      ? ` (${filteredSettled.length})`
                      : ""}
                  </button>
                </div>
              </div>
            )}
            {/* Filtered stats strip — 6-up grid, wraps to 2 cols on
                mobile. Everything except Net PnL / Staked is currency-
                agnostic (%, count), so those tiles show a single
                figure; the currency-priced tiles use the primary
                currency and add a "· etc" note for multi-currency
                users. Visible on all viewports so mobile users get
                the same headline picture. */}
            <div className="bets-slice-strip">
              <div className="bets-slice-tile">
                <div className="bets-slice-lab">
                  Net P&amp;L{filtersActive ? " · filtered" : ""}
                </div>
                <div
                  className={`bets-slice-val mono ${signClass(
                    sliceMetrics.primaryNetSum,
                  )}`}
                >
                  {sliceMetrics.count > 0
                    ? formatByCurWithSign(sliceMetrics.netByCur, {
                        showSign: true,
                      })
                    : "—"}
                </div>
                <div className="bets-slice-sub">
                  {sliceMetrics.count}{" "}
                  {sliceMetrics.count === 1 ? "settled bet" : "settled bets"}
                  {filtersActive && settledCount !== sliceMetrics.count
                    ? ` of ${settledCount}`
                    : ""}
                </div>
              </div>
              <div className="bets-slice-tile">
                <div className="bets-slice-lab">Win rate</div>
                <div className="bets-slice-val mono">
                  {sliceMetrics.wins + sliceMetrics.losses > 0
                    ? `${sliceMetrics.hitPct}%`
                    : "—"}
                </div>
                <div className="bets-slice-sub">
                  {sliceMetrics.wins} W · {sliceMetrics.losses} L
                </div>
              </div>
              <div className="bets-slice-tile">
                <div className="bets-slice-lab">ROI</div>
                <div
                  className={`bets-slice-val mono ${signClass(
                    sliceMetrics.primaryRoiPct,
                  )}`}
                >
                  {sliceMetrics.primaryStakeSum > 0
                    ? fmtPct(sliceMetrics.primaryRoiPct)
                    : "—"}
                </div>
                <div className="bets-slice-sub">on settled stake</div>
              </div>
              <div className="bets-slice-tile">
                <div className="bets-slice-lab">Staked</div>
                <div className="bets-slice-val mono">
                  {sliceMetrics.count > 0
                    ? formatByCurWithSign(sliceMetrics.stakedByCur, {
                        showSign: false,
                      })
                    : "—"}
                </div>
                <div className="bets-slice-sub">
                  {sliceMetrics.count > 0 && sliceMetrics.primaryStakeSum > 0
                    ? `${fmtMoney(
                        sliceMetrics.primaryStakeSum / sliceMetrics.count,
                      )} avg`
                    : ""}
                </div>
              </div>
              <div className="bets-slice-tile">
                <div className="bets-slice-lab">Avg odds</div>
                <div className="bets-slice-val mono">
                  {sliceMetrics.avgOdds > 1
                    ? sliceMetrics.avgOdds.toFixed(2)
                    : "—"}
                </div>
                <div className="bets-slice-sub">decimal</div>
              </div>
              <div className="bets-slice-tile">
                <div className="bets-slice-lab">Biggest win</div>
                <div
                  className={`bets-slice-val mono ${
                    sliceMetrics.primaryBiggestWin > 0 ? "stat-up" : ""
                  }`}
                >
                  {sliceMetrics.primaryBiggestWin > 0
                    ? fmtMoney(sliceMetrics.primaryBiggestWin, true)
                    : "—"}
                </div>
                <div className="bets-slice-sub">
                  {sliceMetrics.primaryBiggestWinLabel || "no wins yet"}
                </div>
              </div>
            </div>
            {settledBets.length === 0 ? (
              <div className="bets-empty">
                <div className="bets-empty-title">
                  {ready ? "No settled bets yet" : "Loading…"}
                </div>
              </div>
            ) : filteredSettled.length === 0 ? (
              <div className="bets-empty">
                <div className="bets-empty-title">
                  No settled bets match these filters
                </div>
                <div className="bets-empty-sub">
                  Try clearing one — you have {settledCount} in total.
                </div>
              </div>
            ) : (
              <div className="bets-grid">
                {filteredSettled.map((b) => (
                  <button
                    type="button"
                    className="bets-settled"
                    key={b.id}
                    onClick={() => setSettle(buildSettlementData(b))}
                  >
                    <div>
                      <div className="bets-settled-nm">{b.who}</div>
                      <div className="bets-settled-sub">
                        <span className="bets-settled-mkt">{b.mkt}</span> @{" "}
                        {b.odds} ·{" "}
                        {b.cur === "u"
                          ? `${b.stake}${b.cur}`
                          : `${b.cur}${b.stake}`}
                      </div>
                    </div>
                    <div className="bets-settled-pl-col">
                      <div
                        className={`bets-settled-pl ${
                          b.result === "WON" ? "win" : "loss"
                        }`}
                      >
                        {b.pl}
                      </div>
                      <div
                        className={`bets-settled-stat ${
                          b.result === "WON" ? "win" : "loss"
                        }`}
                      >
                        {b.result}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <p className="bets-compliance">
          Pardle is a tracker, not a bookmaker — we don&apos;t accept
          bets. 18+ only.
        </p>
      </div>

      {settle && !shareData && (
        <SettlementModal
          data={settle}
          onClose={() => setSettle(null)}
          onShare={(d) => setShareData(d)}
        />
      )}
      {shareData && <ShareCard data={shareData} onClose={closeShare} />}
      <AddBetTrigger />
    </section>
  );
}
