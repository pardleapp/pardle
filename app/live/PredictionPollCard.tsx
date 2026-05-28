"use client";

/**
 * Big-moment prediction poll card. Renders inline above the feed
 * list when a head-to-head or hold-the-lead poll is open.
 *
 * Different from putt polls in pace + UI:
 *   - Resolves in hours, not seconds → no urgency animation
 *   - Larger card so the "this is the question" stakes are clear
 *   - 2 or 3 vote buttons depending on poll type
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
}

export default function PredictionPollCard({
  poll,
  counts,
  myVote,
  onVote,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const handleVote = (key: string) => {
    if (pending) return;
    setPending(key);
    onVote(key);
    // Visual feedback only; parent triggers refresh which clears
    // pending on the next poll counts arriving.
    setTimeout(() => setPending(null), 1200);
  };

  const eyebrow =
    poll.type === "head-to-head" ? "⚔️ Head-to-head" : "🏆 Sunday call";
  const variant =
    poll.type === "head-to-head" ? "predpoll-h2h" : "predpoll-lead";

  return (
    <article className={`predpoll ${variant}`} aria-live="polite">
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
              } ${isPending ? "predpoll-option-pending" : ""}`}
              onClick={() => handleVote(opt.key)}
              disabled={isPending}
              aria-pressed={isMine}
            >
              <span
                className="predpoll-option-bar"
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
              <span className="predpoll-option-label">{opt.label}</span>
              <span className="predpoll-option-count">
                {total === 0 ? "—" : `${Math.round(pct)}%`}
              </span>
            </button>
          );
        })}
      </div>
      <p className="predpoll-meta">
        {total === 0
          ? "Be the first to call it."
          : `${total} ${total === 1 ? "call" : "calls"} so far · counts toward your Sharp Score`}
      </p>
    </article>
  );
}
