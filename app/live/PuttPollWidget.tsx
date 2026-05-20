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

export interface PuttPollServerState {
  counts: { yes: number; no: number };
  closedAt: number | null;
  made: boolean | null;
  myVote: "yes" | "no" | null;
  polledAtStroke: number;
}

export interface PuttPollWidgetProps {
  pollId: string;
  serverState: PuttPollServerState | undefined;
  optimisticVote: "yes" | "no" | undefined;
  optimisticCounts: { yes: number; no: number } | undefined;
  onVote: (v: "yes" | "no") => void;
}

export default function PuttPollWidget({
  pollId,
  serverState,
  optimisticVote,
  optimisticCounts,
  onVote,
}: PuttPollWidgetProps) {
  const counts =
    optimisticCounts ?? serverState?.counts ?? { yes: 0, no: 0 };
  const myVote = optimisticVote ?? serverState?.myVote ?? null;
  const closed = serverState?.closedAt != null;
  const made = serverState?.made ?? null;
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

  // Open poll: vote buttons + live community split.
  return (
    <div className="putt-poll" aria-label="Putt prediction poll">
      <p className="putt-poll-prompt">Will it drop?</p>
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
      {total > 0 && (
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
      {/* Suppress the otherwise-unused param warning. */}
      <span hidden>{pollId}</span>
    </div>
  );
}
