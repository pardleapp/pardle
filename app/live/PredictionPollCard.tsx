"use client";

/**
 * Single prediction-poll card. Used by the "Sunday call" surfacer
 * to ask one big-moment question (will the leader hold? who shoots
 * lower? will player X break par?) and credit the user's Sharp
 * Score when it settles.
 *
 * UX patterns:
 *   - Pre-vote: option buttons render plain — NO community %
 *     bars. Tapping a button locks the answer and reveals the
 *     community split.
 *   - Post-vote: bars animate in, user's pick gets the
 *     "mine" border, others read as community-only.
 *   - Optional dismiss × for users who don't want to call this
 *     one — closes the card without staking a Sharp Score
 *     position.
 */

import { useState } from "react";
import type {
  PredictionPoll,
  PredictionPollCounts,
} from "@/lib/feed/prediction-polls";

interface Props {
  poll: PredictionPoll;
  counts: PredictionPollCounts;
  myVote: string | null;
  /** Triggered when user taps an option. Parent handles auth/
   *  optimistic update + API call. */
  onVote: (optionKey: string) => void;
  /** Optional — when set, renders a dismiss × in the corner. The
   *  Sunday-call surfacer uses this to let users skip a question
   *  they don't want to call. */
  onDismiss?: () => void;
  /** When true and the user hasn't voted yet, the community % bars
   *  are hidden — "100%" pre-vote was reading as the user's own
   *  selection. Bars appear once the user has cast their vote. */
  hideResultsUntilVote?: boolean;
}

export default function PredictionPollCard({
  poll,
  counts,
  myVote,
  onVote,
  onDismiss,
  hideResultsUntilVote,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const hasVoted = myVote != null;
  const showCommunityBars = hasVoted || !hideResultsUntilVote;

  const handleVote = (key: string) => {
    if (pending) return;
    if (hasVoted) return;
    setPending(key);
    onVote(key);
    // Visual feedback only; parent triggers refresh which clears
    // pending on the next poll counts arriving.
    setTimeout(() => setPending(null), 1200);
  };

  const eyebrow =
    poll.type === "head-to-head" ? "Head-to-head" : "Sunday call";
  const variant =
    poll.type === "head-to-head" ? "predpoll-h2h" : "predpoll-lead";

  return (
    <article
      className={`predpoll ${variant} ${
        hasVoted ? "predpoll-voted" : "predpoll-pre"
      }`}
      aria-live="polite"
    >
      {onDismiss && (
        <button
          type="button"
          className="predpoll-dismiss"
          onClick={onDismiss}
          aria-label="Skip this call"
        >
          ×
        </button>
      )}
      <p className="predpoll-eyebrow">{eyebrow}</p>
      <h3 className="predpoll-question">{poll.question}</h3>
      <div className="predpoll-options">
        {poll.options.map((opt) => {
          const c = counts[opt.key] ?? 0;
          const pct = total > 0 ? (c / total) * 100 : 0;
          const isMine = myVote === opt.key;
          const isPending = pending === opt.key;
          return (
            <button
              type="button"
              key={opt.key}
              className={`predpoll-option ${
                isMine ? "predpoll-option-mine" : ""
              } ${isPending ? "predpoll-option-pending" : ""} ${
                hasVoted ? "predpoll-option-after" : "predpoll-option-before"
              }`}
              onClick={() => handleVote(opt.key)}
              disabled={isPending || hasVoted}
              aria-pressed={isMine}
            >
              {showCommunityBars && (
                <span
                  className="predpoll-option-bar"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
              )}
              <span className="predpoll-option-label">{opt.label}</span>
              {showCommunityBars && (
                <span className="predpoll-option-count">
                  {total === 0 ? "—" : `${Math.round(pct)}%`}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hasVoted && (
        <p className="predpoll-meta">
          {total === 0
            ? "First call — counts toward your Sharp Score"
            : `${total} ${total === 1 ? "call" : "calls"} so far · counts toward your Sharp Score`}
        </p>
      )}
    </article>
  );
}
