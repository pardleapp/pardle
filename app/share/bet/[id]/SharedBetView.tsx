"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ODDS_FORMAT,
  formatOdds,
  ODDS_FORMAT_STORAGE_KEY,
  type OddsFormat,
} from "@/lib/odds-format";
import {
  currentValueForBet,
  reconstructHistory,
  type BetScorecard,
  type DgProbHistorySample,
  type FeedRowLike,
  type OddsHistorySample,
  type PlayerRoundState,
  type TopFinishProbs,
  type TopFinishSnapshot,
  type TournamentProjection,
  type TrackedBet,
  type WinningScoreSnapshot,
} from "@/app/live/bet-shared";
import dynamic from "next/dynamic";
import { formatBetCurrency } from "@/lib/format/bet-currency";

// Heavy SVG chart — defer to first paint past the hero so the share
// view paints something fast even on a cold viral visit.
const BetChartFull = dynamic(
  () => import("@/app/live/bet/[id]/BetChartFull"),
  {
    ssr: false,
    loading: () => (
      <div className="skeleton-block bd-skeleton-chart" aria-busy="true" />
    ),
  },
);

const REFRESH_MS = 6_000;

interface FeedResponse {
  tournament: { name: string; isLive: boolean } | null;
  rows: FeedRowLike[];
  currentOdds: Record<string, number>;
  oddsHistories: Record<string, OddsHistorySample[] | null>;
  dgWinProbs?: Record<string, DgProbHistorySample[] | null>;
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
  winningScoreHistory?: WinningScoreSnapshot[];
  topFinishCurrent?: Record<string, TopFinishProbs>;
  topFinishHistory?: TopFinishSnapshot[];
  bookOdds?: {
    draftkings: Record<string, OddsHistorySample[] | null>;
    fanduel: Record<string, OddsHistorySample[] | null>;
  };
}

interface Props {
  bet: TrackedBet;
  ownerName: string;
}

export default function SharedBetView({ bet, ownerName }: Props) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [scorecard, setScorecard] = useState<BetScorecard | null>(null);
  const [error, setError] = useState(false);
  const [oddsFormat, setOddsFormat] =
    useState<OddsFormat>(DEFAULT_ODDS_FORMAT);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
    if (raw === "american" || raw === "fractional" || raw === "decimal") {
      setOddsFormat(raw);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?v=share`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as FeedResponse;
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const roundForBet =
    bet.kind === "round-score"
      ? bet.round ??
        (data ? data.playerRoundStates[bet.playerId]?.currentRound ?? null : null)
      : null;
  useEffect(() => {
    if (bet.kind !== "round-score") return;
    if (roundForBet == null || !data) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/bet/scorecard?playerId=${encodeURIComponent(
            bet.playerId,
          )}&round=${roundForBet}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as BetScorecard;
        if (!cancelled) setScorecard(json);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [bet, roundForBet, data]);

  if (error && !data) {
    return (
      <p className="feed-empty">
        Couldn&apos;t load the live feed. It&apos;ll retry automatically.
      </p>
    );
  }
  if (!data) {
    // Critical: this is the viral-share landing page. Plain "Loading"
    // text used to paint here for ~1-2s before snapping to the rich
    // hero + chart — a cold visitor's first impression of Pardle.
    return (
      <section className="bd-wrap" aria-busy="true">
        <div className="bd-head bd-head-hero">
          <div className="skeleton-line bd-skeleton-amt" />
          <div className="skeleton-line bd-skeleton-sub" />
        </div>
        <div className="skeleton-block bd-skeleton-name" />
        <div className="skeleton-block bd-skeleton-chart" />
      </section>
    );
  }

  const nowValue = currentValueForBet(
    bet,
    data.currentOdds,
    data.playerRoundStates,
    data.tournamentProjections,
    data.topFinishCurrent,
  );
  const history = reconstructHistory(
    bet,
    data.oddsHistories,
    data.playerRoundStates,
    data.rows,
    nowValue,
    scorecard,
    data.dgWinProbs,
    data.winningScoreHistory,
    data.topFinishHistory,
    data.bookOdds,
  );
  const profit = nowValue != null ? nowValue - bet.stake : null;
  const profitPct = profit != null ? (profit / bet.stake) * 100 : null;
  const profitClass =
    profit == null
      ? ""
      : profit > 0
      ? "bets-profit-up"
      : profit < 0
      ? "bets-profit-down"
      : "";

  const overline =
    bet.kind === "outright"
      ? "Outright winner"
      : bet.kind === "winning-score"
      ? `Winning score · ${bet.side} ${bet.line}`
      : bet.kind === "top-finish"
      ? `Top ${bet.cutoff} finish`
      : `Round-score · ${bet.side} ${bet.line}${
          bet.round != null ? ` · R${bet.round}` : ""
        }`;

  const subject =
    bet.kind === "winning-score"
      ? "Tournament total"
      : bet.kind === "outright" || bet.kind === "round-score" || bet.kind === "top-finish"
      ? bet.playerName
      : "—";

  return (
    <section className="bd-wrap">
      <header className="bd-head">
        <div>
          <p className="bd-overline">{overline}</p>
          <h2 className="bd-name">{subject}</h2>
          <p className="bd-sub">
            @ {formatOdds(bet.oddsTaken, oddsFormat)} · stake{" "}
            {formatBetCurrency(bet.stake, bet.currency)} · {ownerName}&apos;s bet
          </p>
        </div>
        <div className="bd-pnl">
          <span className={`bd-pnl-pct ${profitClass}`}>
            {profitPct == null
              ? "—"
              : `${profitPct > 0 ? "+" : ""}${profitPct.toFixed(1)}%`}
          </span>
          <span className={`bd-pnl-amt ${profitClass}`}>
            {profit == null
              ? "—"
              : `${profit >= 0 ? "+" : ""}${formatBetCurrency(profit, bet.currency)}`}
          </span>
          <span className="bd-pnl-value">
            Now worth {nowValue == null ? "—" : formatBetCurrency(nowValue, bet.currency)}
          </span>
        </div>
      </header>

      <BetChartFull bet={bet} history={history} />

      <p className="bd-share-footer">
        Want to track your own bets like this?{" "}
        <Link href="/">Open Pardle →</Link>
      </p>
    </section>
  );
}
