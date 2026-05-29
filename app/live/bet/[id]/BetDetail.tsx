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
  /** Per-player hole scores from the live snapshot. Used by the
   *  hole-by-hole table to surface EVERY hole the bet's player has
   *  played, not just non-par feed events. */
  snapshotHoles?: Record<string, Record<number, Record<number, string>>>;
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
    // Cached-first paint — show the last response instantly while
    // the live fetch runs in the background. Same trick as
    // BetsClient: tapping into a bet feels instant instead of a
    // 2-3 s "no data yet, here's a skeleton" hold.
    try {
      const cacheRaw = window.localStorage.getItem(
        "pardle_bet_detail_cache_v1",
      );
      if (cacheRaw) {
        const env = JSON.parse(cacheRaw) as {
          ts: number;
          data: FeedResponse;
        };
        if (
          env?.ts &&
          env.data &&
          Date.now() - env.ts < 30 * 60 * 1000
        ) {
          setData(env.data);
        }
      }
    } catch {
      // silent
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
      // playerId=X slims the per-player buffers (oddsHistories,
      // dgWinProbs, bookOdds, playerSgBreakdown, snapshotHoles) to
      // just this bet's player — drops the chart payload from
      // ~1.5 MB whole-field to a few KB.
      const playerParam =
        bet && "playerId" in bet
          ? `&playerId=${encodeURIComponent((bet as { playerId: string }).playerId)}`
          : "";
      const url = pastTournamentId
        ? `/api/feed?v=detail&tournamentId=${encodeURIComponent(pastTournamentId)}&include=charts${playerParam}`
        : `/api/feed?v=detail&include=charts${playerParam}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as FeedResponse;
      setData(json);
      setError(false);
      // Persist for next bet-detail open. Only cache the live-
      // tournament view — past replays vary per bet so caching
      // would point the wrong tournament at the next bet open.
      if (!pastTournamentId && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            "pardle_bet_detail_cache_v1",
            JSON.stringify({ ts: Date.now(), data: json }),
          );
        } catch {
          // localStorage full / disabled — silent
        }
      }
    } catch {
      setError(true);
    }
  }, [pastTournamentId, bet]);

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
      <Link href="/bets" className="bd-back" aria-label="Back to bets">
        ← Bets
      </Link>
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
          <BetChartFull
            bet={resolvedBet}
            history={history}
            headerRight={
              bet.kind === "round-score" ? (
                <LiveRoundStatus
                  state={data.playerRoundStates[bet.playerId]}
                  round={roundForBet}
                />
              ) : undefined
            }
          />
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
              feedEvents={data.rows ?? []}
              snapshotHoles={data.snapshotHoles}
              tournamentPars={data.tournamentPars}
              playerThru={
                bet.kind === "outright" || bet.kind === "top-finish"
                  ? data.playerIndex?.find(
                      (r) =>
                        r.playerId ===
                        (bet as { playerId: string }).playerId,
                    )?.thru ?? null
                  : null
              }
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

/**
 * Compact status pill rendered above the round-score chart — the
 * player's current "thru X · to-par" so a bettor watching the chart
 * has the live state in their eyeline without needing to bounce to
 * the leaderboard.
 */
function LiveRoundStatus({
  state,
  round,
}: {
  state: PlayerRoundState | undefined;
  round: number | null;
}) {
  if (!state) return null;
  const r = round ?? state.currentRound;
  // Read from the per-round snapshot when available. The top-level
  // PlayerRoundState fields (holesPlayed / toPar) describe the
  // current round only — for a bet on R1, those fields would say
  // "R2, thru 0" once R1 finished, painting an in-progress R1 bet
  // as "Yet to tee off".
  const snap = state.rounds?.[r];
  const holesPlayed = snap?.holesPlayed ?? state.holesPlayed;
  const holesRemaining = snap?.holesRemaining ?? state.holesRemaining;
  const toPar = snap?.toPar ?? state.toPar;
  const status: "not-started" | "in-progress" | "complete" =
    snap?.status ??
    (holesPlayed <= 0
      ? "not-started"
      : holesRemaining <= 0 && holesPlayed >= 18
        ? "complete"
        : "in-progress");
  let primary: string;
  let secondary: string | null = null;
  if (status === "not-started") {
    primary = "Yet to tee off";
  } else if (status === "complete") {
    primary = "Round complete";
    secondary = formatToPar(toPar);
  } else {
    primary = `Thru ${holesPlayed}`;
    secondary = formatToPar(toPar);
  }
  const tone =
    secondary == null
      ? "neutral"
      : toPar < 0
        ? "down"
        : toPar > 0
          ? "up"
          : "neutral";
  return (
    <div className={`bd-live-status bd-live-status-${tone}`}>
      <span className="bd-live-status-eyebrow">R{r} live</span>
      <span className="bd-live-status-primary">{primary}</span>
      {secondary && (
        <span className="bd-live-status-secondary">{secondary}</span>
      )}
    </div>
  );
}

function formatToPar(n: number): string {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`;
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
      <div className="bd-table-headrow" aria-hidden="true">
        <span />
        <span>Value</span>
        <span>PnL</span>
        <span>Win %</span>
      </div>
      <ul>
        {steps.map((s, i) => {
          const pnl = s.v - stake;
          const cls =
            pnl > 0
              ? "bets-profit-up"
              : pnl < 0
                ? "bets-profit-down"
                : "";
          // Use the model probability that was baked onto the
          // sample when the history was reconstructed. Fall back
          // to value-over-max-payout if absent on older shapes.
          const winProb =
            typeof s.prob === "number" && Number.isFinite(s.prob)
              ? s.prob
              : bet.stake * bet.oddsTaken > 0
                ? Math.max(0, Math.min(1, s.v / (bet.stake * bet.oddsTaken)))
                : 0;
          return (
            <li key={i} className="bd-table-row">
              <span className="bd-table-hole">
                Hole {s.holesPlayed ?? i + 1}
              </span>
              <span className="bd-table-val">
                {formatBetCurrency(s.v, bet.currency)}
              </span>
              <span className={`bd-table-pnl ${cls}`}>
                {pnl >= 0 ? "+" : "−"}
                {formatBetCurrency(Math.abs(pnl), bet.currency)}
              </span>
              <span className="bd-table-prob">
                {formatWinPct(winProb)}
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
  feedEvents,
  snapshotHoles,
  tournamentPars,
  playerThru,
  oddsFormat,
}: {
  bet: TrackedBet;
  history: PnlSample[];
  feedEvents: FeedRowLike[];
  snapshotHoles?: Record<string, Record<number, Record<number, string>>>;
  tournamentPars?: Record<number, Record<number, number>>;
  playerThru?: string | null;
  oddsFormat: OddsFormat;
}) {
  const playerId = "playerId" in bet ? (bet as { playerId: string }).playerId : null;

  // Walk the full scorecard from snapshot if we have it — gives us
  // EVERY hole the player played (including pars, which never
  // produce feed events). Order them by play sequence: front-9
  // starters play 1→18; back-9 starters play 10→18 then 1→9.
  // Detect start side from `thru` ending with "*".
  const startedBackNine = (playerThru ?? "").trim().endsWith("*");
  const playOrder: number[] = startedBackNine
    ? [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

  // Map (round, hole) → ts from feed events so pars use the
  // surrounding non-par events' timestamps as anchors.
  const eventTsByHole = new Map<string, number>();
  if (playerId) {
    for (const r of feedEvents) {
      if (
        r.event.type === "score" &&
        r.event.playerId === playerId &&
        typeof r.event.hole === "number" &&
        typeof r.event.round === "number" &&
        typeof r.event.ts === "number"
      ) {
        eventTsByHole.set(`${r.event.round}:${r.event.hole}`, r.event.ts);
      }
    }
  }

  // Player's hole completions from the snapshot — pars and all.
  // Falls back to feed-event-only mode when snapshot data isn't
  // present (e.g., a page open before include=charts ships).
  const holeRows: {
    ts: number;
    round: number;
    hole: number;
    strokes: number;
    par: number | undefined;
  }[] = [];
  const snapshot = playerId ? snapshotHoles?.[playerId] : null;
  if (snapshot) {
    // Only show the player's latest round — earlier rounds are
    // historical and the bet's trajectory through them is in the
    // chart. The hole-by-hole table is for "what's happening right
    // now" context, so just the latest round keeps it focused.
    const latestRound = Object.keys(snapshot)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && (snapshot[n] ?? null) !== null)
      .sort((a, b) => b - a)[0];
    const roundKeys = latestRound != null ? [latestRound] : [];
    for (const round of roundKeys) {
      const holes = snapshot[round] ?? {};
      const parsForRound = tournamentPars?.[round] ?? {};
      // First pass: collect all played holes with whatever timestamp
      // we can derive. Use feed event ts when present; mark others
      // for interpolation in pass 2.
      const playedInOrder: {
        hole: number;
        strokes: number;
        par: number | undefined;
        ts: number | null;
      }[] = [];
      for (const hole of playOrder) {
        const scoreStr = holes[hole];
        const strokes = Number(scoreStr);
        if (!Number.isFinite(strokes) || strokes <= 0) continue;
        const ts = eventTsByHole.get(`${round}:${hole}`) ?? null;
        playedInOrder.push({
          hole,
          strokes,
          par: parsForRound[hole],
          ts,
        });
      }
      // Interpolate missing timestamps from neighbors. Anchor:
      // first known ts within the round (or fall back to bet.placedAt).
      for (let i = 0; i < playedInOrder.length; i++) {
        if (playedInOrder[i].ts != null) continue;
        // Find previous and next known ts
        let prevIdx = i - 1;
        while (prevIdx >= 0 && playedInOrder[prevIdx].ts == null) prevIdx--;
        let nextIdx = i + 1;
        while (
          nextIdx < playedInOrder.length &&
          playedInOrder[nextIdx].ts == null
        ) {
          nextIdx++;
        }
        const prevTs = prevIdx >= 0 ? playedInOrder[prevIdx].ts! : null;
        const nextTs =
          nextIdx < playedInOrder.length ? playedInOrder[nextIdx].ts! : null;
        if (prevTs != null && nextTs != null) {
          const span = nextIdx - prevIdx;
          const offset = i - prevIdx;
          playedInOrder[i].ts = prevTs + ((nextTs - prevTs) * offset) / span;
        } else if (prevTs != null) {
          // Linear ~15 min/hole pace after the last known.
          playedInOrder[i].ts = prevTs + (i - prevIdx) * 15 * 60 * 1000;
        } else if (nextTs != null) {
          playedInOrder[i].ts = nextTs - (nextIdx - i) * 15 * 60 * 1000;
        } else {
          // No anchor in the round — distribute evenly between
          // bet placement and now.
          const span = Date.now() - bet.placedAt;
          const denom = playedInOrder.length;
          playedInOrder[i].ts =
            bet.placedAt + ((i + 1) / denom) * span;
        }
      }
      for (const p of playedInOrder) {
        holeRows.push({
          ts: p.ts!,
          round,
          hole: p.hole,
          strokes: p.strokes,
          par: p.par,
        });
      }
    }
  }
  // Sort by ts to get chronological order even if rounds went
  // out-of-sequence somehow.
  holeRows.sort((a, b) => a.ts - b.ts);

  // Fallback to legacy feed-event-only behaviour when snapshot is
  // missing (older payload shapes).
  const holeEventsFallback = (
    playerId
      ? feedEvents.filter(
          (r) =>
            r.event.type === "score" &&
            r.event.playerId === playerId &&
            typeof r.event.hole === "number" &&
            typeof r.event.round === "number" &&
            typeof r.event.ts === "number",
        )
      : []
  )
    .map((r) => ({
      ts: r.event.ts,
      hole: r.event.hole as number,
      round: r.event.round,
      strokes: r.event.strokes,
      par: r.event.par,
    }))
    .sort((a, b) => a.ts - b.ts);

  // Interpolate the bet's value at a given timestamp from the
  // history series — gives us the bet value AT each hole completion
  // rather than at history sample boundaries.
  const valueAt = (ts: number): number => {
    if (history.length === 0) return bet.stake;
    if (ts <= history[0].t) return history[0].v;
    if (ts >= history[history.length - 1].t) {
      return history[history.length - 1].v;
    }
    for (let i = 1; i < history.length; i++) {
      if (history[i].t >= ts) {
        const a = history[i - 1];
        const b = history[i];
        const span = b.t - a.t || 1;
        const t = (ts - a.t) / span;
        return a.v + (b.v - a.v) * t;
      }
    }
    return history[history.length - 1].v;
  };
  // Same interpolation for model probability — the win % column.
  // Falls back to (value / max-payout) when prob isn't carried on
  // the sample (older history shapes for non-outright bets).
  const probAt = (ts: number): number => {
    const maxPayout = bet.stake * bet.oddsTaken;
    const fromValue = (v: number) =>
      maxPayout > 0
        ? Math.max(0, Math.min(1, v / maxPayout))
        : 0;
    if (history.length === 0) return fromValue(bet.stake);
    const pick = (s: { v: number; prob?: number }): number =>
      typeof s.prob === "number" && Number.isFinite(s.prob)
        ? s.prob
        : fromValue(s.v);
    if (ts <= history[0].t) return pick(history[0]);
    if (ts >= history[history.length - 1].t) {
      return pick(history[history.length - 1]);
    }
    for (let i = 1; i < history.length; i++) {
      if (history[i].t >= ts) {
        const a = history[i - 1];
        const b = history[i];
        const pa = pick(a);
        const pb = pick(b);
        const span = b.t - a.t || 1;
        const t = (ts - a.t) / span;
        return pa + (pb - pa) * t;
      }
    }
    return pick(history[history.length - 1]);
  };

  // Prefer the snapshot-derived rows (every hole the player has
  // completed) — fall back to feed-event-only rows when the
  // snapshot wasn't included in the response.
  const eventStream =
    holeRows.length > 0 ? holeRows : holeEventsFallback;

  if (eventStream.length === 0) {
    return (
      <div className="bd-table">
        <p className="bd-table-title">Hole by hole</p>
        <p className="bd-table-foot" style={{ marginTop: 0 }}>
          Fills in once {bet.kind === "outright" || bet.kind === "top-finish"
            ? `${(bet as { playerName: string }).playerName} plays a hole`
            : "the round starts"}
          .
        </p>
      </div>
    );
  }

  type Row =
    | {
        kind: "hole";
        key: string;
        ts: number;
        label: string;
        value: number;
        prob: number;
      }
    | {
        kind: "gap";
        key: string;
        ts: number;
        label: string;
        value: number;
        prob: number;
      };

  // Build the row list — each player hole, plus optional "between"
  // rows when odds moved materially while the player wasn't playing
  // (other contenders' actions, market re-pricing, etc.).
  const SIGNIFICANT_GAP_PCT = 0.05; // 5% of stake
  const rows: Row[] = [];
  let prevTs = bet.placedAt;
  let prevValue = bet.stake;
  for (let i = 0; i < eventStream.length; i++) {
    const ev = eventStream[i];
    // Look for a "peak" sample in the gap between prev player-event
    // and this one. If its swing from prevValue is significant AND
    // the post-hole valuation differs from the peak by at least half
    // that swing, render the peak as its own row — otherwise it'll
    // get absorbed into this hole's swing anyway.
    let peak: { t: number; v: number } | null = null;
    for (const s of history) {
      if (s.t <= prevTs || s.t >= ev.ts) continue;
      if (!peak || Math.abs(s.v - prevValue) > Math.abs(peak.v - prevValue)) {
        peak = { t: s.t, v: s.v };
      }
    }
    const evValue = valueAt(ev.ts);
    const evProb = probAt(ev.ts);
    if (peak) {
      const peakSwing = peak.v - prevValue;
      const postPeakDelta = peak.v - evValue;
      if (
        Math.abs(peakSwing) / bet.stake >= SIGNIFICANT_GAP_PCT &&
        Math.abs(postPeakDelta) / bet.stake >= SIGNIFICANT_GAP_PCT * 0.5
      ) {
        rows.push({
          kind: "gap",
          key: `gap-${peak.t}`,
          ts: peak.t,
          label: gapLabel(prevTs, ev.ts, peak.t),
          value: peak.v,
          prob: probAt(peak.t),
        });
      }
    }
    rows.push({
      kind: "hole",
      key: `h-${ev.ts}`,
      ts: ev.ts,
      label: `R${ev.round} · Hole ${ev.hole}${
        typeof ev.strokes === "number" && typeof ev.par === "number"
          ? ` (${ev.strokes > ev.par ? "+" : ""}${ev.strokes - ev.par})`
          : ""
      }`,
      value: evValue,
      prob: evProb,
    });
    prevTs = ev.ts;
    prevValue = evValue;
  }

  return (
    <div className="bd-table">
      <p className="bd-table-title">Hole by hole</p>
      <div className="bd-table-headrow" aria-hidden="true">
        <span />
        <span>Value</span>
        <span>PnL</span>
        <span>Win %</span>
      </div>
      <ul>
        {rows.map((r) => {
          const pnl = r.value - bet.stake;
          const cls =
            pnl > 0
              ? "bets-profit-up"
              : pnl < 0
                ? "bets-profit-down"
                : "";
          return (
            <li
              key={r.key}
              className={`bd-table-row${r.kind === "gap" ? " bd-table-row-gap" : ""}`}
            >
              <span className="bd-table-hole">{r.label}</span>
              <span className="bd-table-val">
                {formatBetCurrency(r.value, bet.currency)}
              </span>
              <span className={`bd-table-pnl ${cls}`}>
                {pnl >= 0 ? "+" : "−"}
                {formatBetCurrency(Math.abs(pnl), bet.currency)}
              </span>
              <span className="bd-table-prob">
                {formatWinPct(r.prob)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Format a model probability as a compact percentage —
 *  1 decimal under 5%, integer otherwise. Used in the hole-by-
 *  hole tables across all bet kinds. */
function formatWinPct(p: number): string {
  if (!Number.isFinite(p) || p < 0) return "—";
  const pct = p * 100;
  if (pct > 0 && pct < 5) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** Label a significant odds move that happened between two of the
 *  player's hole completions — usually overnight / between rounds /
 *  while they were off the course. */
function gapLabel(prevTs: number, nextTs: number, peakTs: number): string {
  const gapHours = (nextTs - prevTs) / (60 * 60 * 1000);
  if (gapHours > 6) return "Between rounds";
  return new Date(peakTs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
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
