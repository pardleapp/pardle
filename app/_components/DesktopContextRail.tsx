"use client";

/**
 * DesktopContextRail — right context column at @media
 * (min-width: 1280px). Surfaces a stack of useful modules so the
 * extra horizontal space on wide desktop is genuinely used:
 *
 *   1. "Now playing" tournament strip + active prediction call
 *      (when /api/feed has an open poll)
 *   2. Leaderboard top 10
 *   3. Your live bets (real tracked bets from localStorage with
 *      live valuations from /api/feed)
 *   4. Shots of the day reel mini (top 3 highlights from
 *      /api/feed.bestReel when present)
 *
 * Real-data only — no demo crew or mock placeholders. The mobile
 * experience is unaffected (display: none below 1280px).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BETS_CHANGED_EVENT,
  readBets,
  resolveBetPlayerId,
  type OutrightBet,
  type PlayerRoundState,
  type RoundScoreBet,
  type TopFinishBet,
  type TopFinishProbs,
  type TournamentProjection,
  type TrackedBet,
  evaluateRoundScore,
} from "@/app/live/bet-shared";
import {
  formatBetCurrency,
  normaliseBetCurrency,
} from "@/lib/format/bet-currency";

interface FeedRow {
  event?: {
    playerId?: string;
    headline?: string;
    result?: string;
  };
}

interface FeedSnapshot {
  tournament: { name: string; isLive: boolean } | null;
  leaderboard: Array<{
    playerId: string;
    displayName: string;
    position: string;
    total: string;
    thru: string;
  }>;
  currentOdds: Record<string, number>;
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
  topFinishCurrent?: Record<string, TopFinishProbs>;
  /** /api/feed wraps each poll in a `{ poll, counts, ... }` envelope.
   *  The rail only consumes the inner poll's shape; counts/myVote
   *  live in their own envelope fields and are read where needed. */
  predictionPolls?: Array<{
    poll?: {
      id?: string;
      type?: string;
      question?: string;
      options?: Array<{ key?: string; label?: string }>;
    };
  }>;
  bestReel?: FeedRow[];
}

const POLL_MS = 15_000;

function abbreviate(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function callTypeLabel(t: string): string {
  if (t === "head-to-head") return "Head-to-head";
  if (t === "round-over-under") return "Round call";
  if (t === "hold-the-lead") return "Hold the lead";
  return "Live call";
}

// Live valuation that mirrors the BetTracker but stays self-contained
// so this rail can poll on its own cadence. Returns null if the bet
// can't be valued from the current snapshot.
function liveValue(bet: TrackedBet, snap: FeedSnapshot): {
  prob: number | null;
  value: number | null;
} {
  const leaderboardForResolve = snap.leaderboard.map((r) => ({
    playerId: r.playerId,
    displayName: r.displayName,
  }));
  const pid = resolveBetPlayerId(bet, leaderboardForResolve);
  if (bet.kind === "outright") {
    const fair = snap.currentOdds[pid || (bet as OutrightBet).playerId];
    if (!Number.isFinite(fair) || fair <= 1) return { prob: null, value: null };
    const prob = 1 / fair;
    return { prob, value: bet.stake * (bet.oddsTaken / fair) };
  }
  if (bet.kind === "top-finish") {
    const t = bet as TopFinishBet;
    const snapPlayer =
      snap.topFinishCurrent?.[pid || t.playerId];
    if (!snapPlayer) return { prob: null, value: null };
    const key = `top${t.cutoff}` as keyof TopFinishProbs;
    const prob = snapPlayer[key];
    if (typeof prob !== "number") return { prob: null, value: null };
    return { prob, value: bet.stake * prob * bet.oddsTaken };
  }
  if (bet.kind === "round-score") {
    const r = bet as RoundScoreBet;
    const state = snap.playerRoundStates[pid || r.playerId];
    const ev = evaluateRoundScore(r, state);
    if (!ev) return { prob: null, value: null };
    if (ev.kind === "not-started") {
      return { prob: 1 / bet.oddsTaken, value: bet.stake };
    }
    if (ev.kind === "settled") {
      return { prob: ev.won ? 1 : 0, value: ev.won ? bet.stake * bet.oddsTaken : 0 };
    }
    return { prob: ev.prob, value: bet.stake * ev.prob * bet.oddsTaken };
  }
  return { prob: null, value: null };
}

function marketLabel(bet: TrackedBet): string {
  if (bet.kind === "outright") return "OUTRIGHT";
  if (bet.kind === "top-finish") return `TOP ${bet.cutoff}`;
  if (bet.kind === "round-score") {
    const round = bet.round != null ? ` · R${bet.round}` : "";
    return `${bet.side.toUpperCase()} ${bet.line}${round}`;
  }
  return `${bet.side.toUpperCase()} ${bet.line} · TOT`;
}

function playerLabel(bet: TrackedBet): string {
  if (bet.kind === "winning-score") return "Winner";
  return ("playerName" in bet && bet.playerName) || "Player";
}

export default function DesktopContextRail() {
  const [feed, setFeed] = useState<FeedSnapshot | null>(null);
  const [bets, setBets] = useState<TrackedBet[]>([]);

  // Local bet store (localStorage) — same source as /bets and the
  // inline BetTracker. Re-reads on the BETS_CHANGED event so newly
  // placed bets show up here within the same tick.
  useEffect(() => {
    const sync = () => setBets(readBets());
    sync();
    window.addEventListener(BETS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BETS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Poll /api/feed for the rail's snapshot.
  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/feed?v=ctx-rail", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Partial<FeedSnapshot> & {
          leaderboard?: FeedSnapshot["leaderboard"];
        };
        if (cancel) return;
        setFeed({
          tournament: j.tournament ?? null,
          leaderboard: (j.leaderboard ?? []).slice(0, 10),
          currentOdds: j.currentOdds ?? {},
          playerRoundStates: j.playerRoundStates ?? {},
          tournamentProjections: j.tournamentProjections,
          topFinishCurrent: j.topFinishCurrent,
          predictionPolls: j.predictionPolls ?? [],
          bestReel: j.bestReel ?? [],
        });
      } catch {
        // ignore; next tick retries
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  const liveTournament = feed?.tournament?.isLive;
  // Unwrap the poll envelope safely — /api/feed returns
  // [{ poll: { id, type, options, … }, counts, … }, …]. Old code
  // assumed the items themselves had `.options` and crashed every
  // route with `f.options.slice is not a function`.
  const openPoll = feed?.predictionPolls?.[0]?.poll;
  const openPollOptions = Array.isArray(openPoll?.options)
    ? openPoll!.options!.slice(0, 2)
    : [];
  const activeBets = useMemo(
    () => bets.filter((b) => b.settledAt == null),
    [bets],
  );
  const reelTop3 = Array.isArray(feed?.bestReel)
    ? feed!.bestReel!.slice(0, 3)
    : [];

  return (
    <aside className="desktop-ctx" aria-label="Context">
      {/* Tournament strip */}
      <section className="desktop-ctx-block">
        <div className="desktop-ctx-label">Now playing</div>
        <div className="desktop-ctx-tournament">
          {liveTournament && (
            <span
              className="feed-live-pulse feed-live-pulse-inline"
              aria-label="Live"
            />
          )}
          <span className="desktop-ctx-tournament-name">
            {feed?.tournament?.name ?? "Loading…"}
          </span>
        </div>
      </section>

      {/* Active prediction call (mini) — null-guarded at every read
          so a missing poll / options array never throws. */}
      {openPoll && openPoll.question && (
        <section className="desktop-ctx-block">
          <div className="desktop-ctx-label desktop-ctx-label-row">
            <span>{callTypeLabel(openPoll.type ?? "")}</span>
            <Link href="/" className="desktop-ctx-link">
              Vote →
            </Link>
          </div>
          <div className="desktop-ctx-call">
            <div className="desktop-ctx-call-q">{openPoll.question}</div>
            {openPollOptions.length > 0 && (
              <div className="desktop-ctx-call-opts">
                {openPollOptions.map((o, i) => {
                  const label = o?.label ?? "";
                  return (
                    <span
                      key={o?.key ?? i}
                      className="desktop-ctx-call-opt"
                    >
                      {label.length > 28 ? `${label.slice(0, 26)}…` : label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Leaderboard top 10 */}
      <section className="desktop-ctx-block">
        <div className="desktop-ctx-label desktop-ctx-label-row">
          <span>Leaderboard</span>
          <Link href="/leaderboard" className="desktop-ctx-link">
            All →
          </Link>
        </div>
        {feed?.leaderboard.length ? (
          <ul className="desktop-ctx-lb">
            {feed.leaderboard.map((r) => (
              <li key={r.playerId} className="desktop-ctx-lb-row">
                <span className="desktop-ctx-lb-pos mono">{r.position}</span>
                <span className="desktop-ctx-lb-name">
                  {abbreviate(r.displayName)}
                </span>
                <span className="desktop-ctx-lb-total mono">
                  {r.total === "E" ? "E" : r.total}
                </span>
                <span className="desktop-ctx-lb-thru mono">{r.thru}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="desktop-ctx-empty">
            {feed ? "No leaderboard yet" : "Loading…"}
          </div>
        )}
      </section>

      {/* Your live bets */}
      <section className="desktop-ctx-block">
        <div className="desktop-ctx-label desktop-ctx-label-row">
          <span>Your live bets</span>
          <Link href="/bets" className="desktop-ctx-link">
            All →
          </Link>
        </div>
        {activeBets.length === 0 ? (
          <div className="desktop-ctx-empty">
            Track a bet with the green ＋ to see live P&amp;L move with every
            shot.
          </div>
        ) : (
          <ul className="desktop-ctx-bets">
            {activeBets.slice(0, 5).map((b) => {
              const lv = feed ? liveValue(b, feed) : { prob: null, value: null };
              const cur = normaliseBetCurrency(b.currency);
              const placedProb =
                Number.isFinite(b.oddsTaken) && b.oddsTaken > 1
                  ? 1 / b.oddsTaken
                  : null;
              const dir: "up" | "down" | "flat" =
                lv.prob != null && placedProb != null
                  ? Math.abs(lv.prob - placedProb) < 0.005
                    ? "flat"
                    : lv.prob > placedProb
                      ? "up"
                      : "down"
                  : "flat";
              const pct = lv.prob != null ? Math.round(lv.prob * 100) : null;
              const delta =
                lv.value != null ? Math.round(lv.value - b.stake) : null;
              return (
                <li key={b.id} className="desktop-ctx-bet">
                  <Link
                    href={`/live/bet/${b.id}`}
                    className="desktop-ctx-bet-link"
                  >
                    <span className="desktop-ctx-bet-nm">
                      {playerLabel(b)}
                    </span>
                    <span className="desktop-ctx-bet-mk">
                      {marketLabel(b)} · {formatBetCurrency(b.stake, cur, {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                    <span
                      className={`desktop-ctx-bet-pct desktop-ctx-bet-${dir}`}
                    >
                      {pct != null ? `${pct}%` : "—"}
                    </span>
                    {delta != null && delta !== 0 && (
                      <span
                        className={`desktop-ctx-bet-d desktop-ctx-bet-${dir}`}
                      >
                        {delta > 0 ? "+" : "−"}
                        {formatBetCurrency(Math.abs(delta), cur, {
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Shots of the day mini reel */}
      {reelTop3.length > 0 && (
        <section className="desktop-ctx-block">
          <div className="desktop-ctx-label">Shots of the day</div>
          <ul className="desktop-ctx-reel">
            {reelTop3.map((row, i) => (
              <li key={i} className="desktop-ctx-reel-row">
                {row.event?.headline ?? ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
