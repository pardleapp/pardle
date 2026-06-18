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

import { useEffect, useState } from "react";
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

/** Build the settlement-modal data from a MockBetSettled — derives
 *  returnedLabel for wins (stake × odds), books a mock daily P&L
 *  + group rank string. Will swap to real settlement engine output
 *  when that wires in. */
function buildSettlementData(b: MockBetSettled): SettlementData {
  const decOdds = parseFloat(b.odds) || 0;
  const returnedAmount = b.result === "WON" ? Math.round(b.stake * decOdds) : 0;
  const returnedLabel = returnedAmount
    ? `${b.cur}${returnedAmount.toLocaleString("en-US")}`
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
    .map(([cur, n]) => `${cur}${n}`)
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
      return `${sign}${cur}${abs.toLocaleString("en-US")}`;
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
  const fmtMoney = (v: number, withSign = false) => {
    const sign = v > 0 && withSign ? "+" : v < 0 ? "−" : "";
    return `${sign}${primaryCur}${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
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
            <div className="bets-summary bets-summary-mobile">
              <div>
                <div className="bets-summary-lab">Net · event</div>
                <div className="bets-summary-big mono">{netLabel || "—"}</div>
                <div className="bets-summary-legs">
                  {settledCount} settled
                </div>
              </div>
              <div className="bets-summary-r">
                <div className="bets-summary-lab">Hit rate</div>
                <div className="bets-summary-big mono">{hitPct}%</div>
                <div className="bets-summary-legs">
                  {wins} W · {losses} L
                </div>
              </div>
            </div>
            {settledBets.length === 0 ? (
              <div className="bets-empty">
                <div className="bets-empty-title">
                  {ready ? "No settled bets yet" : "Loading…"}
                </div>
              </div>
            ) : (
              <div className="bets-grid">
                {settledBets.map((b) => (
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
                        {b.odds} · {b.cur}
                        {b.stake}
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
