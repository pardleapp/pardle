"use client";

/**
 * Off-week landing — what the home feed shows when no tournament is
 * live (no event on the schedule, or one's upcoming but pre-tee-off).
 *
 * Before this component, the page rendered a single grey "Tees off
 * in 4 days" line — a dead end on the ~70% of calendar weeks with no
 * live PGA event. Now the page is a useful destination Mon-Wed of
 * any week: countdown + value-prop recap + a row of cards linking to
 * the things a golf bettor can still do here (browse last event's
 * leaderboard, play the daily Pros puzzle, find tipster channels,
 * see the live-feed demo).
 *
 * All client-side, no extra API calls — works off the same /api/feed
 * response the rest of the FeedClient consumes. Cheap to render.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
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

export default function OffWeekLanding({ tournament }: Props) {
  const [trackedBets, setTrackedBets] = useState<TrackedBet[]>([]);

  useEffect(() => {
    setTrackedBets(readBets());
  }, []);

  const days = tournament
    ? Math.max(
        0,
        Math.ceil((tournament.startDate - Date.now()) / 86_400_000),
      )
    : null;
  const startStr = tournament
    ? new Date(tournament.startDate).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;

  // Bets the user placed for the upcoming event (or last week's if
  // it just settled). Counted by stake placed — used to render a
  // "tracking N bets" callout that nudges them to /bets between
  // events instead of waiting passively for the feed to fire.
  const activeBets = trackedBets.filter((b) => !b.settledAt);
  const settledBets = trackedBets.filter((b) => b.settledAt);

  return (
    <section className="offweek-wrap v4-theme">
      {tournament ? (
        <section className="offweek-next">
          <div className="offweek-next-tag">Up next</div>
          <h2 className="offweek-next-name">{tournament.name}</h2>
          <p className="offweek-next-meta">
            {startStr} ·{" "}
            <strong>
              {days === 0
                ? "tees off today"
                : days === 1
                ? "tees off tomorrow"
                : `${days} days until tee-off`}
            </strong>
          </p>
          <p className="offweek-next-blurb">
            The live shot-by-shot feed fires up when the first group
            hits the course. In the meantime — track your picks, watch
            the field, or sharpen up with a daily puzzle.
          </p>
        </section>
      ) : (
        <section className="offweek-next">
          <div className="offweek-next-tag">No event this week</div>
          <h2 className="offweek-next-name">
            The PGA Tour is dark this week
          </h2>
          <p className="offweek-next-blurb">
            Live shot-by-shot tracking fires back up at the next event.
            In the meantime, explore the rest of Pardle.
          </p>
        </section>
      )}

      {(activeBets.length > 0 || settledBets.length > 0) && (
        <Link href="/bets" className="offweek-bets-strip">
          <div className="offweek-bets-strip-body">
            <span className="offweek-bets-strip-title">
              {activeBets.length > 0
                ? `${activeBets.length} active bet${activeBets.length === 1 ? "" : "s"} waiting on the next event`
                : `${settledBets.length} settled bet${settledBets.length === 1 ? "" : "s"} from last week`}
            </span>
            <span className="offweek-bets-strip-blurb">
              See your tracker
            </span>
          </div>
          <span className="offweek-bets-strip-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      )}

      <Link href="/sharp" className="offweek-sharp">
        <div className="offweek-sharp-head">
          <span className="offweek-sharp-pill">⚡ Sharp Score</span>
          <span className="offweek-sharp-arrow" aria-hidden="true">→</span>
        </div>
        <p className="offweek-sharp-title">
          How sharp are you?
        </p>
        <p className="offweek-sharp-blurb">
          Every putt-poll vote and tracked bet builds your accuracy
          record. The chip sits next to your name across Pardle — so
          when you call it right, everyone sees.
        </p>
        <p className="offweek-sharp-foot">
          Top callers ranked on the leaderboard. See where you&apos;d
          stack up →
        </p>
      </Link>

      <div className="offweek-cards">
        <Link href="/leaderboard" className="offweek-card">
          <span className="offweek-card-icon" aria-hidden="true">
            📊
          </span>
          <div className="offweek-card-body">
            <span className="offweek-card-title">Last leaderboard</span>
            <span className="offweek-card-blurb">
              Where the field finished + season form
            </span>
          </div>
        </Link>

        <Link href="/players" className="offweek-card">
          <span className="offweek-card-icon" aria-hidden="true">
            🏌️
          </span>
          <div className="offweek-card-body">
            <span className="offweek-card-title">Player statistics</span>
            <span className="offweek-card-blurb">
              Season form, SG breakdowns, every round of every event
            </span>
          </div>
        </Link>

        <Link href="/tipster" className="offweek-card">
          <span className="offweek-card-icon" aria-hidden="true">
            📌
          </span>
          <div className="offweek-card-body">
            <span className="offweek-card-title">Tipster channels</span>
            <span className="offweek-card-blurb">
              Follow bettors posting picks for the upcoming event
            </span>
          </div>
        </Link>

        <Link href="/demo/cj-cup-watch" className="offweek-card">
          <span className="offweek-card-icon" aria-hidden="true">
            🚀
          </span>
          <div className="offweek-card-body">
            <span className="offweek-card-title">
              See what a live Sunday looks like
            </span>
            <span className="offweek-card-blurb">
              Animated replay: Clark&apos;s CJ Cup back 9
            </span>
          </div>
        </Link>
      </div>

      <p className="offweek-footnote">
        Live PGA Tour scoring · bet tracker · social
      </p>
    </section>
  );
}
