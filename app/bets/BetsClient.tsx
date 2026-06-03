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
    bookedDailyPnl: b.result === "WON" ? "+£226" : "−£40",
    groupRank: b.result === "WON" ? "2nd in The Lads" : "3rd in The Lads",
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
            <div className="bets-summary">
              <div>
                <div className="bets-summary-lab">Open stake</div>
                <div className="bets-summary-big mono">{openStakeLabel}</div>
                <div className="bets-summary-legs">all live</div>
              </div>
              <div className="bets-summary-r">
                <div className="bets-summary-lab">Group rank</div>
                <div className="bets-summary-big mono">#2/9</div>
                <div className="bets-summary-legs">Jordan leads</div>
              </div>
            </div>
            {bets.length === 0 ? (
              <div className="bets-empty">
                <div className="bets-empty-title">
                  {ready ? "No live bets yet" : "Loading your bets…"}
                </div>
                {ready && (
                  <div className="bets-empty-sub">
                    Track a bet from the Sweat feed and it&rsquo;ll appear
                    here.
                  </div>
                )}
              </div>
            ) : (
              bets.map((b) => <BetRow key={b.id} bet={b} oddsFmt={oddsFmt} />)
            )}
          </>
        ) : (
          <>
            <div className="bets-summary">
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
            ) : null}
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
