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
  detectBetSettlement,
  evaluateRoundScore,
  evaluateWinningScore,
  patchLegacyPlacement,
  readBetById,
  reconstructHistory,
  resolveBetRound,
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
import dynamic from "next/dynamic";
import { computeBetInsight } from "@/lib/feed/bet-insights";
import { useToast } from "@/app/live/Toast";
import { formatBetCurrency } from "@/lib/format/bet-currency";

// BetChartFull is the heaviest piece of the bet-detail page (SVG
// chart engine, axis helpers, hover tooltip, optional PastBetReplay
// branch). Dynamic-import with SSR off so it doesn't drag the
// shared lazy-loaded bundle into the home-feed initial paint when
// users navigate to /live/bet/X from a row chip.
const BetChartFull = dynamic(() => import("./BetChartFull"), {
  ssr: false,
  loading: () => (
    <div className="skeleton-block bd-skeleton-chart" aria-busy="true" />
  ),
});

const REFRESH_MS = 6_000;

interface FeedResponse {
  tournament: { name: string; isLive: boolean; startDate?: number } | null;
  rows: FeedRowLike[];
  currentOdds: Record<string, number>;
  oddsHistories: Record<string, OddsHistorySample[] | null>;
  dgWinProbs?: Record<string, DgProbHistorySample[] | null>;
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
  winningScoreHistory?: WinningScoreSnapshot[];
  topFinishCurrent?: Record<string, TopFinishProbs>;
  topFinishHistory?: TopFinishSnapshot[];
  /** Slim leaderboard rows used to detect tournament settlement and
   *  drive the "what needs to happen" insight panel. */
  playerIndex?: Array<{
    playerId: string;
    displayName: string;
    position: string;
    total: string;
    thru: string;
    playerState?: string;
  }>;
  bookOdds?: {
    draftkings: Record<string, OddsHistorySample[] | null>;
    fanduel: Record<string, OddsHistorySample[] | null>;
  };
  /** Per-player tournament-to-date SG breakdown — keyed by playerId.
   *  Only present when ?include=charts was passed. Drives the SG-
   *  flavoured hint on the insight card. */
  playerSgBreakdown?: Record<
    string,
    {
      total: number | null;
      ott: number | null;
      app: number | null;
      arg: number | null;
      putt: number | null;
    }
  > | null;
  /** Per-(round,hole) field stats — strokes-vs-par mean, count.
   *  Already passed for the existing round-score model; we reuse it
   *  here to name specific birdie / trouble holes on the insight card. */
  fieldStats?: Record<
    number,
    Record<number, { mean: number; variance: number; count: number }>
  >;
  /** Per-(round,hole) par values for this tournament. */
  tournamentPars?: Record<number, Record<number, number>>;
}

/** Build the friendly WhatsApp-style message we drop into the share
 *  sheet. Reads naturally as "I've got £50 on Rahm to win @ +1500.
 *  Follow it live → URL". One sentence per bet kind plus the URL.
 *  Currency comes from the bet itself (multi-currency support) so
 *  US visitors share "$50 on Rahm" not "£50". */
function buildShareText(
  bet: TrackedBet,
  oddsFormat: OddsFormat,
  url: string,
): string {
  const stake = formatBetCurrency(bet.stake, bet.currency);
  const odds = formatOdds(bet.oddsTaken, oddsFormat);
  let line: string;
  if (bet.kind === "outright") {
    line = `${stake} on ${bet.playerName} to win @ ${odds}`;
  } else if (bet.kind === "round-score") {
    const r = bet.round != null ? ` R${bet.round}` : "";
    line = `${stake} on ${bet.playerName}${r} ${bet.side} ${bet.line} @ ${odds}`;
  } else if (bet.kind === "winning-score") {
    line = `${stake} on the winning score ${bet.side} ${bet.line} @ ${odds}`;
  } else {
    line = `${stake} on ${bet.playerName} top ${bet.cutoff} @ ${odds}`;
  }
  return `I've got ${line}.\n\nFollow it live → ${url}`;
}

export default function BetDetail({ betId }: { betId: string }) {
  const toast = useToast();
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

  // For settled bets from past tournaments, fetch that tournament's
  // archived feed instead of the active one — so the same Polymarket
  // odds / top-finish / winning-score history that drove the chart
  // during live play is what the user sees here.
  const [pastTournamentId, setPastTournamentId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!bet || bet.settledAt == null) {
      setPastTournamentId(null);
      return;
    }
    // Match the bet's placed_at against the schedule to figure out
    // which past tournament it belongs to.
    fetch(`/api/bets/${encodeURIComponent(bet.id)}/replay`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.tournament?.id) return;
        setPastTournamentId(j.tournament.id as string);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bet]);

  const load = useCallback(async () => {
    try {
      // include=charts asks the API for the heavy historical buffers
      // (Polymarket odds, top-finish history, winning-score CDF) the
      // chart reconstruction needs. The home feed doesn't ask for
      // these — keeps the per-poll payload small for non-detail views.
      const url = pastTournamentId
        ? `/api/feed?v=detail&tournamentId=${encodeURIComponent(pastTournamentId)}&include=charts`
        : `/api/feed?v=detail&include=charts`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as FeedResponse;
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, [pastTournamentId]);

  useEffect(() => {
    load();
    // Live bets keep refreshing; past-tournament replays don't need
    // periodic re-fetches.
    if (pastTournamentId) return;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, pastTournamentId]);

  // Pull the orchestrator scorecard alongside each feed refresh —
  // the events list on /api/feed is capped at 1000 entries, which a
  // busy tournament day can blow through in a few hours, leaving
  // early holes out of the chart.
  //
  // For "current round" bets (bet.round = null) we have to figure out
  // what round the bet actually targeted at placement time. For past-
  // tournament replays we can't trust playerRoundStates.currentRound
  // (that's whatever round was last live, typically R4), so resolveBet
  // -Round infers from placedAt vs tournament startDate.
  const roundForBet =
    bet?.kind === "round-score" && data
      ? resolveBetRound(
          bet,
          data.playerRoundStates[bet.playerId],
          data.tournament?.startDate ?? null,
        )
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
        // Pass tournamentId for past-tournament replays — without it
        // the scorecard endpoint queries whichever tournament is
        // currently active, which for a settled bet is the wrong one
        // (returns empty → chart collapses to "Hole 0" only).
        const tParam = pastTournamentId
          ? `&tournamentId=${encodeURIComponent(pastTournamentId)}`
          : "";
        const res = await fetch(
          `/api/bet/scorecard?playerId=${encodeURIComponent(
            playerId,
          )}&round=${roundStr}${tParam}`,
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

  const [shareStatus, setShareStatus] = useState<
    "idle" | "sending" | "sent" | "err"
  >("idle");

  // Owned tipster channels for the "Post as tip" button. Fetched
  // once when the page loads + bet is hydrated; null until loaded,
  // empty array = no channels (button hidden).
  const [ownedChannels, setOwnedChannels] = useState<
    { slug: string; name: string }[] | null
  >(null);
  const [tipPostOpen, setTipPostOpen] = useState(false);
  const [tipRationale, setTipRationale] = useState("");
  const [tipStatus, setTipStatus] = useState<
    "idle" | "sending" | "sent" | "err"
  >("idle");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/channels/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setOwnedChannels(
          (j.owned ?? []).map((c: { slug: string; name: string }) => ({
            slug: c.slug,
            name: c.name,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function postAsTip() {
    if (!bet || !ownedChannels || ownedChannels.length === 0) return;
    // v0 assumes the user has at most one channel; first one wins.
    // Multi-channel pickers are a follow-up.
    const slug = ownedChannels[0].slug;
    setTipStatus("sending");
    try {
      const res = await fetch(`/api/channels/${slug}/tips`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bet,
          rationale: tipRationale.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setTipStatus("err");
        return;
      }
      setTipStatus("sent");
      setTipRationale("");
      setTimeout(() => {
        setTipPostOpen(false);
        setTipStatus("idle");
      }, 1400);
    } catch {
      setTipStatus("err");
    }
  }

  async function shareThis() {
    if (!bet) return;
    setShareStatus("sending");
    try {
      const res = await fetch(
        `/api/bets/${encodeURIComponent(bet.id)}/share`,
        { method: "POST" },
      );
      if (!res.ok) {
        if (res.status === 401) {
          setShareStatus("err");
          toast.error("Sign in first so we can attach the shared bet to you.");
          return;
        }
        setShareStatus("err");
        return;
      }
      const url = `${window.location.origin}/share/bet/${encodeURIComponent(bet.id)}`;
      const text = buildShareText(bet, oddsFormat, url);

      // Mobile: native share sheet opens with WhatsApp / iMessage /
      // socials. Desktop usually doesn't support navigator.share so
      // we fall back to wa.me — opens WhatsApp web pre-filled with
      // the same text.
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };
      if (nav.share) {
        try {
          await nav.share({ title: "My Pardle bet", text, url });
          setShareStatus("sent");
          return;
        } catch {
          // User cancelled or share aborted — fall through to wa.me.
        }
      }
      const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(waUrl, "_blank", "noopener");
      setShareStatus("sent");
    } catch {
      setShareStatus("err");
    }
  }

  async function removeThis() {
    if (!bet) return;
    const ok = await toast.confirm(
      "Remove this bet from your tracker?",
      "Remove",
    );
    if (!ok) return;
    const remaining = readBets().filter((b) => b.id !== bet.id);
    writeBets(remaining);
    // Soft-nav so the user lands cleanly on the bets page rather than
    // reloading through the /live redirect.
    window.location.href = "/bets";
  }

  if (!hydrated) return null;
  if (!bet) {
    return (
      <section className="bd-wrap">
        <p className="bd-missing">
          That bet isn&apos;t on this device. Bets are stored locally — if you
          placed it on a different browser or after clearing storage, it won&apos;t
          show here.{" "}
          <Link href="/">Go back to the live feed →</Link>
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
    return <BetDetailSkeleton />;
  }

  const settled = detectBetSettlement(
    bet,
    data.playerIndex ?? [],
    data.playerRoundStates,
    data.tournamentProjections ?? {},
  );
  // For round-score bets stored with round=null ("current round at
  // placement time"), the chart needs the actual round number to walk
  // through hole-by-hole. Resolve here so reconstructHistory doesn't
  // fall back to the wrong round (typically the tournament's final
  // round when replaying a past R3 bet).
  const resolvedBet: TrackedBet =
    bet.kind === "round-score" && bet.round == null && roundForBet != null
      ? ({ ...bet, round: roundForBet } as TrackedBet)
      : bet;
  const nowValue = currentValueForBet(
    resolvedBet,
    data.currentOdds,
    data.playerRoundStates,
    data.tournamentProjections,
    data.topFinishCurrent,
    settled,
  );
  const history = reconstructHistory(
    resolvedBet,
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
  // "What needs to happen" insight — only for live (unsettled) bets.
  // Settled bets already show the final result in the header PnL, so a
  // second sentence telling them the bet won/lost would just be noise.
  const insight =
    bet.settledAt == null && settled == null
      ? computeBetInsight({
          bet: resolvedBet,
          leaderboard: (data.playerIndex ?? []).map((r) => ({
            playerId: r.playerId,
            displayName: r.displayName,
            position: r.position,
            total: r.total,
            thru: r.thru,
            playerState: r.playerState,
          })),
          playerRoundStates: data.playerRoundStates,
          tournamentProjections: data.tournamentProjections,
          playerSgBreakdown: data.playerSgBreakdown ?? undefined,
          fieldHoleStats: data.fieldStats,
          tournamentPars: data.tournamentPars,
        })
      : null;
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
      <header className="bd-head bd-head-hero">
        <div className={`bd-hero ${profitClass}`}>
          <span className="bd-hero-amt">
            {profit == null
              ? "—"
              : `${profit >= 0 ? "+" : "−"}${formatBetCurrency(Math.abs(profit), bet.currency)}`}
          </span>
          <span className="bd-hero-meta">
            {nowValue == null
              ? "Settling soon"
              : `Now worth ${formatBetCurrency(nowValue, bet.currency)}`}
            {profitPct != null && (
              <>
                {" · "}
                <span className={profitClass}>
                  {profitPct > 0 ? "+" : ""}
                  {profitPct.toFixed(1)}%
                </span>
              </>
            )}
          </span>
        </div>

        <div className="bd-id">
          <h2 className="bd-name">
            {bet.kind === "winning-score" ? (
              <span>Tournament total</span>
            ) : (
              <Link href={`/live/player/${bet.playerId}`}>
                {bet.playerName}
              </Link>
            )}
          </h2>
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
          <p className="bd-sub">
            @ {formatOdds(bet.oddsTaken, oddsFormat)} · stake{" "}
            {formatBetCurrency(bet.stake, bet.currency)} · placed{" "}
            {new Date(bet.placedAt).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </header>

      {bet.kind === "winning-score" ? (
        <>
          <BetChartFull bet={resolvedBet} history={history} />
          {insight && <InsightCard insight={insight} />}
          <WinningScoreDetail
            bet={bet}
            projections={data.tournamentProjections ?? {}}
            oddsFormat={oddsFormat}
          />
        </>
      ) : (
        <>
          <BetChartFull bet={resolvedBet} history={history} />
          {insight && <InsightCard insight={insight} />}
          {bet.kind === "round-score" ? (
            <RoundDetailTable
              bet={resolvedBet as RoundScoreBet}
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

      {ownedChannels && ownedChannels.length > 0 && (
        <div className="bd-tip-post">
          {!tipPostOpen ? (
            <button
              type="button"
              className="bd-tip-post-btn"
              onClick={() => setTipPostOpen(true)}
            >
              Post as tip on @{ownedChannels[0].slug}
            </button>
          ) : (
            <div className="bd-tip-post-form">
              <p className="bd-tip-post-label">
                Add an optional "why I like it" — followers see this next to
                the bet.
              </p>
              <textarea
                className="tipster-input tipster-textarea"
                value={tipRationale}
                onChange={(e) => setTipRationale(e.target.value)}
                placeholder="e.g. Form's been sharp + course fits him; I'd be happy down to +320."
                rows={3}
                maxLength={500}
                disabled={tipStatus === "sending"}
              />
              <div className="bd-tip-post-actions">
                <button
                  type="button"
                  className="bd-tip-post-cancel"
                  onClick={() => {
                    setTipPostOpen(false);
                    setTipRationale("");
                    setTipStatus("idle");
                  }}
                  disabled={tipStatus === "sending"}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bd-tip-post-submit"
                  onClick={postAsTip}
                  disabled={tipStatus === "sending"}
                >
                  {tipStatus === "sending"
                    ? "Posting…"
                    : tipStatus === "sent"
                      ? "Posted ✓"
                      : tipStatus === "err"
                        ? "Try again"
                        : `Post to @${ownedChannels[0].slug}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bd-actions">
        <button
          type="button"
          className="bd-share"
          onClick={shareThis}
          disabled={shareStatus === "sending"}
          title="Send to a friend via WhatsApp / iMessage"
        >
          {shareStatus === "sending"
            ? "Opening…"
            : shareStatus === "sent"
            ? "Shared ✓"
            : shareStatus === "err"
            ? "Try again"
            : "Share this bet"}
        </button>
        <button type="button" className="bd-remove" onClick={removeThis}>
          Remove this bet
        </button>
      </div>
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
                {formatBetCurrency(s.v, bet.currency)}
              </span>
              <span className={`bd-table-pct ${cls}`}>
                {pct > 0 ? "+" : ""}
                {pct.toFixed(1)}%
              </span>
              <span className={`bd-table-swing ${swing > 0 ? "bets-profit-up" : swing < 0 ? "bets-profit-down" : ""}`}>
                {swing >= 0 ? "▲" : "▼"} {formatBetCurrency(Math.abs(swing), bet.currency)}
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
              <span className="bd-table-val">{formatBetCurrency(it.v, bet.currency)}</span>
              <span className={`bd-table-pct ${cls}`}>
                {pct > 0 ? "+" : ""}
                {pct.toFixed(1)}%
              </span>
              <span className={`bd-table-swing ${cls}`}>
                {it.swing >= 0 ? "▲" : "▼"} {formatBetCurrency(Math.abs(it.swing), bet.currency)}
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

// ── "What needs to happen" insight card ────────────────────────────

function InsightCard({
  insight,
}: {
  insight: import("@/lib/feed/bet-insights").BetInsight;
}) {
  return (
    <div className={`bd-insight bd-insight-${insight.status}`}>
      <p className="bd-insight-label">What needs to happen</p>
      <p className="bd-insight-headline">{insight.headline}</p>
      {insight.hint && <p className="bd-insight-hint">{insight.hint}</p>}
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────
// Mirrors the real surface's shape — PnL hero on top, name strip,
// chart frame — so the cold-load → painted transition doesn't
// snap visibly. Was plain "Loading…" text inside a feed-empty box.

function BetDetailSkeleton() {
  return (
    <section className="bd-wrap" aria-busy="true">
      <div className="bd-head bd-head-hero">
        <div className="skeleton-line bd-skeleton-amt" />
        <div className="skeleton-line bd-skeleton-sub" />
      </div>
      <div className="skeleton-block bd-skeleton-name" />
      <div className="skeleton-block bd-skeleton-chart" />
      <div className="bd-skeleton-stats">
        <div className="skeleton-line bd-skeleton-stat" />
        <div className="skeleton-line bd-skeleton-stat" />
        <div className="skeleton-line bd-skeleton-stat" />
      </div>
    </section>
  );
}
