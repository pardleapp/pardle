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
  evaluateRoundScore,
  evaluateWinningScore,
  patchLegacyPlacement,
  readBetById,
  reconstructHistory,
  writeBets,
  readBets,
  type BetScorecard,
  type DgProbHistorySample,
  type FeedRowLike,
  type OddsHistorySample,
  type PlayerRoundState,
  type PnlSample,
  type RoundScoreBet,
  type TopFinishProbs,
  type TopFinishSnapshot,
  type TournamentProjection,
  type TrackedBet,
  type WinningScoreBet,
  type WinningScoreSnapshot,
} from "../../bet-shared";
import BetChartFull from "./BetChartFull";

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
}

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export default function BetDetail({ betId }: { betId: string }) {
  const [bet, setBet] = useState<TrackedBet | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [scorecard, setScorecard] = useState<BetScorecard | null>(null);
  const [error, setError] = useState(false);
  const [oddsFormat, setOddsFormat] =
    useState<OddsFormat>(DEFAULT_ODDS_FORMAT);

  useEffect(() => {
    setBet(readBetById(betId));
    setHydrated(true);
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
    if (raw === "american" || raw === "fractional" || raw === "decimal") {
      setOddsFormat(raw);
    }
  }, [betId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?v=detail`, { cache: "no-store" });
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

  // Pull the orchestrator scorecard alongside each feed refresh —
  // the events list on /api/feed is capped at 1000 entries, which a
  // busy tournament day can blow through in a few hours, leaving
  // early holes out of the chart.
  const roundForBet =
    bet?.kind === "round-score"
      ? bet.round ??
        (data
          ? data.playerRoundStates[bet.playerId]?.currentRound ?? null
          : null)
      : null;
  const scorecardKey =
    bet?.kind === "round-score" && roundForBet != null && data != null
      ? `${bet.playerId}:${roundForBet}`
      : null;

  useEffect(() => {
    if (!scorecardKey) return;
    const [playerId, roundStr] = scorecardKey.split(":");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/bet/scorecard?playerId=${encodeURIComponent(
            playerId,
          )}&round=${roundStr}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as BetScorecard;
        if (!cancelled) setScorecard(json);
      } catch {
        // Non-fatal — chart falls back to feed events.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scorecardKey, data]);

  useEffect(() => {
    if (!bet || bet.kind !== "round-score" || bet.placement || !data) return;
    const next = patchLegacyPlacement(bet, data.playerRoundStates[bet.playerId]);
    if (!next.placement) return;
    const all = readBets().map((b) => (b.id === next.id ? next : b));
    writeBets(all);
    setBet(next);
  }, [bet, data]);

  function removeThis() {
    if (!bet) return;
    if (!confirm("Remove this bet from your tracker?")) return;
    const remaining = readBets().filter((b) => b.id !== bet.id);
    writeBets(remaining);
    // Go back home.
    window.location.href = "/live";
  }

  if (!hydrated) return null;
  if (!bet) {
    return (
      <section className="bd-wrap">
        <p className="bd-missing">
          That bet isn&apos;t on this device. Bets are stored locally — if you
          placed it on a different browser or after clearing storage, it won&apos;t
          show here.{" "}
          <Link href="/live">Go back to the live feed →</Link>
        </p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <p className="feed-empty">
        Couldn&apos;t load the live feed. It&apos;ll retry automatically.
      </p>
    );
  }
  if (!data) {
    return <p className="feed-empty">Loading…</p>;
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

  return (
    <section className="bd-wrap">
      <header className="bd-head">
        <div>
          <p className="bd-overline">
            {bet.kind === "outright"
              ? "Outright winner"
              : bet.kind === "winning-score"
              ? `Winning score · ${bet.side} ${bet.line}`
              : bet.kind === "top-finish"
              ? `Top ${bet.cutoff} finish`
              : `Round-score · ${bet.side} ${bet.line}${
                  bet.round != null ? ` · R${bet.round}` : ""
                }`}
          </p>
          <h2 className="bd-name">
            {bet.kind === "winning-score" ? (
              <span>Tournament total</span>
            ) : (
              <Link href={`/live/player/${bet.playerId}`}>
                {bet.playerName}
              </Link>
            )}
          </h2>
          <p className="bd-sub">
            @ {formatOdds(bet.oddsTaken, oddsFormat)} · stake{" "}
            {gbp.format(bet.stake)} · placed{" "}
            {new Date(bet.placedAt).toLocaleString()}
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
              : `${profit >= 0 ? "+" : ""}${gbp.format(profit)}`}
          </span>
          <span className="bd-pnl-value">
            Now worth {nowValue == null ? "—" : gbp.format(nowValue)}
          </span>
        </div>
      </header>

      {bet.kind === "winning-score" ? (
        <>
          <BetChartFull bet={bet} history={history} />
          <WinningScoreDetail
            bet={bet}
            projections={data.tournamentProjections ?? {}}
            oddsFormat={oddsFormat}
          />
        </>
      ) : (
        <>
          <BetChartFull bet={bet} history={history} />
          {bet.kind === "round-score" ? (
            <RoundDetailTable
              bet={bet}
              state={data.playerRoundStates[bet.playerId]}
              history={history}
              oddsFormat={oddsFormat}
            />
          ) : (
            <OutrightDetailTable
              bet={bet}
              history={history}
              oddsFormat={oddsFormat}
            />
          )}
        </>
      )}

      <button
        type="button"
        className="bd-remove"
        onClick={removeThis}
      >
        Remove this bet
      </button>
    </section>
  );
}

// ── Hole-by-hole / odds-shift detail tables ─────────────────────────

function RoundDetailTable({
  bet,
  state,
  history,
  oddsFormat,
}: {
  bet: RoundScoreBet;
  state: PlayerRoundState | undefined;
  history: PnlSample[];
  oddsFormat: OddsFormat;
}) {
  const ev = evaluateRoundScore(bet, state);
  const stake = bet.stake;
  // Pair each history step (skip the placedAt anchor) with the cumulative
  // hole count reflected on it.
  const steps = history.slice(1);
  if (steps.length === 0) {
    return (
      <div className="bd-empty">
        {ev?.kind === "not-started"
          ? "Bet placed — chart will fill in as the round plays."
          : "Waiting for holes to complete after your bet was placed."}
      </div>
    );
  }
  return (
    <div className="bd-table">
      <p className="bd-table-title">Hole-by-hole</p>
      <ul>
        {steps.map((s, i) => {
          const pct = ((s.v - stake) / stake) * 100;
          const profit = s.v - stake;
          const cls = profit > 0 ? "bets-profit-up" : profit < 0 ? "bets-profit-down" : "";
          const prev = steps[i - 1]?.v ?? stake;
          const swing = s.v - prev;
          return (
            <li key={i} className="bd-table-row">
              <span className="bd-table-hole">
                Hole {s.holesPlayed ?? i + 1}
              </span>
              <span className="bd-table-val">
                {gbp.format(s.v)}
              </span>
              <span className={`bd-table-pct ${cls}`}>
                {pct > 0 ? "+" : ""}
                {pct.toFixed(1)}%
              </span>
              <span className={`bd-table-swing ${swing > 0 ? "bets-profit-up" : swing < 0 ? "bets-profit-down" : ""}`}>
                {swing >= 0 ? "▲" : "▼"} {gbp.format(Math.abs(swing))}
              </span>
            </li>
          );
        })}
      </ul>
      {ev?.kind === "in-progress" && (
        <p className="bd-table-foot">
          Model:{" "}
          <strong>{Math.round(ev.prob * 100)}%</strong> chance · fair odds{" "}
          {ev.prob > 0 && ev.prob < 1
            ? formatOdds(1 / ev.prob, oddsFormat)
            : "—"}
        </p>
      )}
    </div>
  );
}

function OutrightDetailTable({
  bet,
  history,
  oddsFormat,
}: {
  bet: TrackedBet;
  history: PnlSample[];
  oddsFormat: OddsFormat;
}) {
  // Pick a handful of meaningful samples — biggest swings between consecutive
  // history points — to show as a short event log.
  const items: { t: number; v: number; swing: number }[] = [];
  for (let i = 1; i < history.length; i++) {
    items.push({
      t: history[i].t,
      v: history[i].v,
      swing: history[i].v - history[i - 1].v,
    });
  }
  items.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
  const top = items.slice(0, 10).sort((a, b) => a.t - b.t);
  if (top.length === 0) return null;
  return (
    <div className="bd-table">
      <p className="bd-table-title">Biggest swings</p>
      <ul>
        {top.map((it) => {
          const pct = ((it.v - bet.stake) / bet.stake) * 100;
          const cls =
            it.swing > 0
              ? "bets-profit-up"
              : it.swing < 0
              ? "bets-profit-down"
              : "";
          return (
            <li key={it.t} className="bd-table-row">
              <span className="bd-table-hole">
                {new Date(it.t).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="bd-table-val">{gbp.format(it.v)}</span>
              <span className={`bd-table-pct ${cls}`}>
                {pct > 0 ? "+" : ""}
                {pct.toFixed(1)}%
              </span>
              <span className={`bd-table-swing ${cls}`}>
                {it.swing >= 0 ? "▲" : "▼"} {gbp.format(Math.abs(it.swing))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="bd-table-foot">Odds format: {oddsFormat}</p>
    </div>
  );
}

function WinningScoreDetail({
  bet,
  projections,
  oddsFormat,
}: {
  bet: WinningScoreBet;
  projections: Record<string, TournamentProjection>;
  oddsFormat: OddsFormat;
}) {
  // Build a table of nearby lines (yours ± 2) with the chance and
  // fair price for each, on the same side the bettor chose. Gives
  // context for whether the line they picked is generous or thin.
  const lines: number[] = [];
  for (let i = -2; i <= 2; i++) lines.push(bet.line + i);
  const rows = lines.map((line) => {
    const ev = evaluateWinningScore(
      { ...bet, line, oddsTaken: 2 },
      projections,
    );
    return { line, prob: ev?.prob ?? null };
  });
  const hasModel = rows.some((r) => r.prob != null);

  return (
    <div className="bd-table">
      <p className="bd-table-title">Nearby lines</p>
      {!hasModel ? (
        <p className="bd-table-foot" style={{ marginTop: 0 }}>
          Live odds for nearby lines fill in once the field is on the
          course.
        </p>
      ) : (
        <ul>
          {rows.map((r) => {
            const yours = r.line === bet.line;
            const cls =
              r.prob == null
                ? ""
                : r.prob > 0.5
                ? "bets-profit-up"
                : r.prob < 0.2
                ? "bets-profit-down"
                : "";
            return (
              <li
                key={r.line}
                className="bd-table-row"
                style={
                  yours
                    ? {
                        background: "rgba(123, 174, 63, 0.10)",
                        borderRadius: 6,
                        paddingLeft: 8,
                        paddingRight: 8,
                      }
                    : undefined
                }
              >
                <span className="bd-table-hole">
                  {bet.side === "under" ? "Under" : "Over"} {r.line.toFixed(1)}
                  {yours && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--muted)",
                      }}
                    >
                      Your bet
                    </span>
                  )}
                </span>
                <span className="bd-table-val">
                  {r.prob == null ? "—" : `${Math.round(r.prob * 100)}%`}
                </span>
                <span className={`bd-table-pct ${cls}`}>
                  {r.prob == null || r.prob <= 0 || r.prob >= 1
                    ? "—"
                    : formatOdds(1 / r.prob, oddsFormat)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

