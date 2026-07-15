"use client";

/**
 * OffWeekLanding — what the Sweats feed renders when no tournament
 * is live (between events on the schedule, or pre-tee-off on a
 * Mon/Tue/Wed of a live week).
 *
 * Rebuilt for the v2 broadcast theme: mounts SweatHeader at the top
 * so the chrome matches the live-feed state exactly, stamps
 * pv-theme-body on mount so the brand bar + nav re-skin paper, and
 * lays everything out as warm-paper cards instead of the old dark
 * v4 grid.
 *
 * Stack:
 *   1. Up-next event hero ("The Memorial Tournament · Thu 4 Jun ·
 *      2 days until tee-off").
 *   2. Active-bets card (when the user is tracking bets for the
 *      upcoming event) → /bets.
 *   3. Sharp Score promo → /sharp.
 *   4. Last leaderboard → /leaderboard.
 *   5. Daily games (the off-week viral hook) → /games.
 *
 * Copy guardrails: no third-party data source names, no latency or
 * refresh figures — "the live feed fires up when the first group
 * hits the course" is the non-numeric anchor.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import SweatHeader from "./SweatHeader";
import TournamentChat from "./TournamentChat";
import { readBets, type TrackedBet } from "./bet-shared";

interface Tournament {
  id: string;
  name: string;
  isLive: boolean;
  startDate: number;
}

interface Props {
  /** Next-up tournament, when one exists on the schedule. */
  tournament: Tournament | null;
}

function formatStart(startDate: number): string {
  return new Date(startDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function daysUntil(startDate: number): number {
  return Math.max(0, Math.ceil((startDate - Date.now()) / 86_400_000));
}

export default function OffWeekLanding({ tournament }: Props) {
  const [trackedBets, setTrackedBets] = useState<TrackedBet[]>([]);

  // Stamp html.pv-theme-body so the brand bar / nav re-skin paper
  // and the body bg goes warm-paper end-to-end. Mirrors the hook
  // every other v2 surface uses.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  useEffect(() => {
    setTrackedBets(readBets());
  }, []);

  const days = tournament ? daysUntil(tournament.startDate) : null;
  const startStr = tournament ? formatStart(tournament.startDate) : null;

  const activeBets = trackedBets.filter((b) => !b.settledAt);
  const settledBets = trackedBets.filter((b) => b.settledAt);

  const teeOffLabel = (() => {
    if (days == null) return null;
    if (days === 0) return "Tees off today";
    if (days === 1) return "Tees off tomorrow";
    return `${days} days until tee-off`;
  })();

  return (
    <section className={`ow-pv${tournament ? " tchat-content-pad" : ""}`}>
      <SweatHeader />

      <div className="ow-pv-body">
        {tournament ? (
          <section className="ow-up-next">
            <div className="ow-up-next-tag">Up next</div>
            <h2 className="ow-up-next-name">{tournament.name}</h2>
            <p className="ow-up-next-meta">
              <span className="ow-up-next-date">{startStr}</span>
              {teeOffLabel && (
                <span className="ow-up-next-pill">{teeOffLabel}</span>
              )}
            </p>
            <p className="ow-up-next-blurb">
              The live shot-by-shot feed fires up when the first
              group hits the course. In the meantime — track your
              picks, watch the field, or sharpen up with a daily
              puzzle.
            </p>
          </section>
        ) : (
          <section className="ow-up-next">
            <div className="ow-up-next-tag">No event this week</div>
            <h2 className="ow-up-next-name">
              The PGA Tour is dark this week
            </h2>
            <p className="ow-up-next-blurb">
              Live shot-by-shot tracking fires back up at the next
              event. In the meantime, explore the rest of Pardle.
            </p>
          </section>
        )}

        {(activeBets.length > 0 || settledBets.length > 0) && (
          <Link href="/bets" className="ow-card ow-card-bets">
            <div className="ow-card-body">
              <span className="ow-card-eyebrow">Your tracker</span>
              <span className="ow-card-title">
                {activeBets.length > 0
                  ? `${activeBets.length} active ${
                      activeBets.length === 1 ? "bet" : "bets"
                    } waiting on the next event`
                  : `${settledBets.length} settled ${
                      settledBets.length === 1 ? "bet" : "bets"
                    } from last week`}
              </span>
              <span className="ow-card-blurb">See your tracker</span>
            </div>
            <span className="ow-card-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        )}

        <Link href="/sharp" className="ow-card ow-card-sharp">
          <div className="ow-card-body">
            <span className="ow-card-eyebrow">⚡ Sharp Score</span>
            <span className="ow-card-title">How sharp are you?</span>
            <span className="ow-card-blurb">
              Every putt-poll vote and tracked bet builds your accuracy
              record. The chip sits next to your name across Pardle — so
              when you call it right, everyone sees.
            </span>
            <span className="ow-card-foot">
              See where you&apos;d stack up →
            </span>
          </div>
        </Link>

        <Link href="/leaderboard" className="ow-card ow-card-grid">
          <span className="ow-card-icon" aria-hidden="true">
            📊
          </span>
          <div className="ow-card-body">
            <span className="ow-card-title">Last leaderboard</span>
            <span className="ow-card-blurb">
              Where the field finished + season form
            </span>
          </div>
          <span className="ow-card-arrow" aria-hidden="true">
            →
          </span>
        </Link>

        <Link href="/games" className="ow-card ow-card-games">
          <span className="ow-card-icon" aria-hidden="true">
            🎯
          </span>
          <div className="ow-card-body">
            <span className="ow-card-eyebrow">Daily games</span>
            <span className="ow-card-title">
              Sharpen up while you wait
            </span>
            <span className="ow-card-blurb">
              Pros, Holes, Connections — a new puzzle every day. Keep
              your streak alive.
            </span>
          </div>
          <span className="ow-card-arrow" aria-hidden="true">
            →
          </span>
        </Link>

        <p className="ow-footnote">
          Pardle is a tracker, not a bookmaker — we don&apos;t accept
          bets. 18+ only.
        </p>
      </div>
      {tournament && (
        <TournamentChat
          tournamentId={tournament.id}
          tournamentName={tournament.name}
        />
      )}
    </section>
  );
}
