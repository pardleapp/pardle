"use client";

/**
 * DesktopContextRail — right context column at @media
 * (min-width: 1280px). Surfaces real Memorial-side data using the
 * SAME components + helpers the working /live + /bets surfaces use,
 * so the rail can never diverge from the canonical valuation /
 * vote behaviour:
 *
 *   • Now playing tournament strip
 *   • Active prediction call — renders <PredictionPollCard> (the
 *     same component the in-feed deck mounts) so the vote action
 *     hits /api/predictions/vote and fills bars optimistically.
 *   • Leaderboard top 10 (real /api/feed leaderboard rows).
 *   • Your live bets — values via currentValueForBet (the same
 *     helper that powers the inline tracker + bet detail chart);
 *     prob derived from value / max-payout so a row's % matches
 *     the live % shown on its bet detail page.
 *   • Shots of the day mini (top 3 from /api/feed.bestReel).
 *
 * Mobile (<1280) unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PredictionPollCard from "@/app/live/PredictionPollCard";
import { betKindShortLabel } from "@/app/live/bet-impact";
import {
  BETS_CHANGED_EVENT,
  currentValueForBet,
  readBets,
  type PlayerRoundState,
  type TopFinishProbs,
  type TournamentProjection,
  type TrackedBet,
} from "@/app/live/bet-shared";
import {
  formatBetCurrency,
  normaliseBetCurrency,
} from "@/lib/format/bet-currency";
import type {
  PredictionPoll,
  PredictionPollCounts,
} from "@/lib/feed/prediction-polls";

interface FeedRowLike {
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
  /** Each entry is the envelope returned by /api/feed —
   *  { poll, counts, myVote, … }. We unwrap when passing into
   *  <PredictionPollCard> below. */
  predictionPolls?: Array<{
    poll?: PredictionPoll;
    counts?: PredictionPollCounts;
    myVote?: string | null;
  }>;
  bestReel?: FeedRowLike[];
}

const POLL_MS = 15_000;

function abbreviate(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function playerLabel(bet: TrackedBet): string {
  if (bet.kind === "winning-score") return "Winner";
  return ("playerName" in bet && bet.playerName) || "Player";
}

/** Derive prob from canonical value:
 *    value = stake * prob * oddsTaken  →  prob = value / maxPayout
 *  (anchoredValue uses the same identity, so this recovers prob
 *  cleanly across all bet kinds without re-deriving them inline.) */
function probFromValue(bet: TrackedBet, value: number | null): number | null {
  if (value == null) return null;
  const maxPayout = bet.stake * bet.oddsTaken;
  if (maxPayout <= 0) return null;
  return Math.max(0, Math.min(1, value / maxPayout));
}

export default function DesktopContextRail() {
  const [feed, setFeed] = useState<FeedSnapshot | null>(null);
  const [bets, setBets] = useState<TrackedBet[]>([]);
  // Optimistic vote state — mirrors FeedClient's myPredictionVotes
  // so a tap fills the bars before the next /api/feed tick lands.
  const [myVotes, setMyVotes] = useState<
    Record<string, { myVote: string; counts: PredictionPollCounts }>
  >({});
  // Stable per-visitor author key (same source the feed uses for
  // its votes / reactions). Read once on mount.
  const authorKey = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    authorKey.current =
      window.localStorage.getItem("pardle_feed_author") ?? "";
  }, []);

  // Local bet store. Re-reads on BETS_CHANGED so a freshly tracked
  // bet shows up here instantly.
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

  // Poll /api/feed. The default response carries every field the
  // rail needs (leaderboard, currentOdds, playerRoundStates,
  // tournamentProjections, topFinishCurrent, predictionPolls,
  // bestReel) — no ?include=charts required.
  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/feed?v=ctx-rail", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Partial<FeedSnapshot>;
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

  // Same optimistic-vote flow as FeedClient.sendPredictionVote.
  const sendVote = useCallback(
    async (pollId: string, optionKey: string) => {
      const entry = feed?.predictionPolls?.find(
        (p) => p?.poll?.id === pollId,
      );
      if (!entry?.poll) return;
      const base = myVotes[pollId];
      const prevVote = base?.myVote ?? entry.myVote ?? null;
      if (prevVote === optionKey) return;
      const baseCounts: PredictionPollCounts =
        base?.counts ?? entry.counts ?? {};
      const nextCounts: PredictionPollCounts = { ...baseCounts };
      if (prevVote && nextCounts[prevVote] != null) {
        nextCounts[prevVote] = Math.max(0, nextCounts[prevVote] - 1);
      }
      nextCounts[optionKey] = (nextCounts[optionKey] ?? 0) + 1;
      setMyVotes((m) => ({
        ...m,
        [pollId]: { myVote: optionKey, counts: nextCounts },
      }));
      try {
        const res = await fetch("/api/predictions/vote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pollId,
            authorKey: authorKey.current,
            optionKey,
          }),
        });
        if (!res.ok) {
          setMyVotes((m) => {
            const out = { ...m };
            delete out[pollId];
            return out;
          });
        }
      } catch {
        // Network blip — leave optimistic state; next /api/feed
        // refresh resyncs.
      }
    },
    [feed, myVotes],
  );

  const liveTournament = feed?.tournament?.isLive;

  // Pick the first non-closed poll. The wrapper guards against
  // malformed envelopes (this was the source of the production crash
  // earlier — never trust the shape until it's unwrapped).
  const openEntry = useMemo(() => {
    const polls = feed?.predictionPolls;
    if (!Array.isArray(polls)) return null;
    return (
      polls.find(
        (p) =>
          p?.poll?.id &&
          p.poll.options &&
          p.poll.options.length > 0 &&
          p.poll.question,
      ) ?? null
    );
  }, [feed]);

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

      {/* Active prediction call — uses the same component the feed
          mounts, so the vote behaviour is identical (locks the
          choice, fills the community bars, calls /api/predictions/
          vote with the visitor's authorKey). */}
      {openEntry?.poll && (
        <section className="desktop-ctx-block desktop-ctx-poll-host">
          <div className="desktop-ctx-label">Live call</div>
          <PredictionPollCard
            poll={openEntry.poll}
            counts={
              myVotes[openEntry.poll.id]?.counts ??
              openEntry.counts ??
              ({} as PredictionPollCounts)
            }
            myVote={
              myVotes[openEntry.poll.id]?.myVote ??
              openEntry.myVote ??
              null
            }
            onVote={(opt) => {
              if (openEntry.poll?.id) sendVote(openEntry.poll.id, opt);
            }}
            hideResultsUntilVote
          />
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

      {/* Your live bets — uses currentValueForBet (the canonical
          helper) so each row's % matches what /live/bet/[id] shows
          for the same bet. */}
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
              const value = feed
                ? currentValueForBet(
                    b,
                    feed.currentOdds,
                    feed.playerRoundStates,
                    feed.tournamentProjections,
                    feed.topFinishCurrent,
                    null,
                    feed.leaderboard,
                  )
                : null;
              const prob = probFromValue(b, value);
              const cur = normaliseBetCurrency(b.currency);
              const placedProb =
                Number.isFinite(b.oddsTaken) && b.oddsTaken > 1
                  ? 1 / b.oddsTaken
                  : null;
              const dir: "up" | "down" | "flat" =
                prob != null && placedProb != null
                  ? Math.abs(prob - placedProb) < 0.005
                    ? "flat"
                    : prob > placedProb
                      ? "up"
                      : "down"
                  : "flat";
              const pct = prob != null ? Math.round(prob * 100) : null;
              const delta =
                value != null ? Math.round(value - b.stake) : null;
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
                      {betKindShortLabel(b).toUpperCase()} ·{" "}
                      {formatBetCurrency(b.stake, cur, {
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
                {row?.event?.headline ?? ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
