"use client";

/**
 * Putt prediction poll widget — rendered inside a feed row whenever the
 * row's event is of type `putt-poll`. Self-contained: takes the canonical
 * server poll state, an optimistic overlay (so the user's click is
 * instant), and an `onVote` callback the parent uses to POST the vote.
 *
 * Lives in its own file so the /demo/polls fixture page can render it
 * without dragging in FeedClient's tournament/leaderboard machinery.
 */

import { tourPuttMakeRate } from "@/lib/feed/tour-baselines";
import { abbreviateName } from "@/lib/text/abbreviate";

export interface PuttPollServerState {
  counts: { yes: number; no: number };
  closedAt: number | null;
  made: boolean | null;
  myVote: "yes" | "no" | null;
  polledAtStroke: number;
  /** True when the crowd consensus opposed the outcome (≥60% one way,
   *  opposite result). Surfaces the "crowd called it wrong" chip on
   *  closed rows. */
  crowdWasWrong?: boolean;
  /** Bet player's week-to-date putting SG per round (positive = better
   *  than field on the greens). Anchors the "tour avg 22% from 14ft ·
   *  Niemann +1.8 SG putting this week" line under the question. */
  playerPuttSg?: number | null;
}

export interface PuttPollWidgetProps {
  pollId: string;
  /** Distance of the putt in feet — drives the tour-baseline anchor
   *  ("tour avg 22% from 14ft"). Pulled from the feed event. */
  puttDistanceFt?: number;
  /** Player name — used in the SG anchor sentence. */
  playerName?: string;
  serverState: PuttPollServerState | undefined;
  optimisticVote: "yes" | "no" | undefined;
  optimisticCounts: { yes: number; no: number } | undefined;
  onVote: (v: "yes" | "no") => void;
}

function formatSg(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r >= 0 ? "+" : ""}${r.toFixed(1)}`;
}

/**
 * Build the small "Tour avg 22% from 14ft · Niemann +1.8 SG putting"
 * anchor that sits under the prompt. Returns null when neither side
 * of the comparison has data to show — keeps the widget clean.
 */
function buildBaselineLine(args: {
  distanceFt: number | undefined;
  playerName: string | undefined;
  playerPuttSg: number | null | undefined;
}): string | null {
  const parts: string[] = [];
  if (typeof args.distanceFt === "number" && args.distanceFt > 0) {
    const rate = tourPuttMakeRate(args.distanceFt);
    if (rate != null) {
      parts.push(
        `Tour avg ${Math.round(rate * 100)}% from ${Math.round(args.distanceFt)} ft`,
      );
    }
  }
  if (
    typeof args.playerPuttSg === "number" &&
    Number.isFinite(args.playerPuttSg) &&
    args.playerName
  ) {
    parts.push(
      `${abbreviateName(args.playerName)} ${formatSg(args.playerPuttSg)} SG putting this week`,
    );
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export default function PuttPollWidget({
  pollId,
  puttDistanceFt,
  playerName,
  serverState,
  optimisticVote,
  optimisticCounts,
  onVote,
}: PuttPollWidgetProps) {
  const baseline = buildBaselineLine({
    distanceFt: puttDistanceFt,
    playerName,
    playerPuttSg: serverState?.playerPuttSg,
  });
  const counts =
    optimisticCounts ?? serverState?.counts ?? { yes: 0, no: 0 };
  const myVote = optimisticVote ?? serverState?.myVote ?? null;
  const closed = serverState?.closedAt != null;
  const made = serverState?.made ?? null;
  const crowdWasWrong = serverState?.crowdWasWrong ?? false;
  const total = counts.yes + counts.no;
  const yesPct = total > 0 ? Math.round((counts.yes / total) * 100) : 50;
  const noPct = total > 0 ? 100 - yesPct : 50;

  // Closed poll: show the result + who was right.
  if (closed && made != null) {
    const youWon = (made && myVote === "yes") || (!made && myVote === "no");
    return (
      <div
        className={`putt-poll putt-poll-closed ${
          made ? "putt-poll-made" : "putt-poll-missed"
        }`}
        aria-label="Putt poll result"
      >
        <p className="putt-poll-result">
          {made ? "Drained it." : "Missed."}{" "}
          {myVote
            ? youWon
              ? "You called it."
              : "You called the other way."
            : ""}
        </p>
        {crowdWasWrong && (
          <p className="putt-poll-crowd-wrong">
            🤡 Crowd called it wrong
          </p>
        )}
        <div className="putt-poll-bar" aria-hidden="true">
          <span
            className={`putt-poll-bar-yes ${made ? "putt-poll-bar-win" : ""}`}
            style={{ width: `${yesPct}%` }}
          />
          <span
            className={`putt-poll-bar-no ${!made ? "putt-poll-bar-win" : ""}`}
            style={{ width: `${noPct}%` }}
          />
        </div>
        <p className="putt-poll-totals">
          {yesPct}% made / {noPct}% missed · {total}{" "}
          {total === 1 ? "vote" : "votes"}
        </p>
      </div>
    );
  }

  // Open poll: vote buttons; community split stays hidden until the
  // caller has voted. Commitment-first beats sheep-voting on whatever
  // the crowd is showing.
  const revealed = myVote != null;
  return (
    <div className="putt-poll" aria-label="Putt prediction poll">
      <p className="putt-poll-prompt">
        Will it drop?
        {!revealed && (
          <span className="putt-poll-prompt-hint">
            Vote to see what others said
          </span>
        )}
      </p>
      {baseline && <p className="putt-poll-baseline">{baseline}</p>}
      <div className="putt-poll-buttons">
        <button
          type="button"
          className={`putt-poll-btn putt-poll-btn-yes ${myVote === "yes" ? "putt-poll-btn-on" : ""}`}
          onClick={() => onVote("yes")}
          disabled={closed}
          aria-label="Vote yes"
        >
          Yes · drops
          {myVote === "yes" && <span className="putt-poll-btn-check"> ✓</span>}
        </button>
        <button
          type="button"
          className={`putt-poll-btn putt-poll-btn-no ${myVote === "no" ? "putt-poll-btn-on" : ""}`}
          onClick={() => onVote("no")}
          disabled={closed}
          aria-label="Vote no"
        >
          No · misses
          {myVote === "no" && <span className="putt-poll-btn-check"> ✓</span>}
        </button>
      </div>
      {revealed && total > 0 && (
        <>
          <div className="putt-poll-bar" aria-hidden="true">
            <span
              className="putt-poll-bar-yes"
              style={{ width: `${yesPct}%` }}
            />
            <span
              className="putt-poll-bar-no"
              style={{ width: `${noPct}%` }}
            />
          </div>
          <p className="putt-poll-totals">
            {yesPct}% / {noPct}% · {total}{" "}
            {total === 1 ? "vote" : "votes"}
          </p>
        </>
      )}
      {revealed && total === 0 && (
        <p className="putt-poll-totals">First vote in — be the bellwether</p>
      )}
      {/* Suppress the otherwise-unused param warning. */}
      <span hidden>{pollId}</span>
    </div>
  );
}
