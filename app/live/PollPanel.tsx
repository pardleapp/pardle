"use client";

import { useState } from "react";
import type { PollWithVotes } from "@/lib/feed/polls";

interface Props {
  polls: PollWithVotes[];
  myVotes: Record<string, string>;
  authorKey: string;
}

export default function PollPanel({ polls, myVotes, authorKey }: Props) {
  // Local overlay of vote counts + choices so taps feel instant.
  const [localVotes, setLocalVotes] = useState<
    Record<string, Record<string, number>>
  >({});
  const [localChoice, setLocalChoice] = useState<Record<string, string>>({});

  if (polls.length === 0) return null;

  async function vote(pollId: string, optionId: string) {
    const poll = polls.find((p) => p.poll.id === pollId);
    if (!poll) return;
    const prevChoice = localChoice[pollId] ?? myVotes[pollId];
    if (prevChoice === optionId) return;

    // Optimistic: clone current counts, shift the vote.
    const base = localVotes[pollId] ?? { ...poll.votes };
    const next = { ...base };
    if (prevChoice) next[prevChoice] = Math.max(0, (next[prevChoice] ?? 0) - 1);
    next[optionId] = (next[optionId] ?? 0) + 1;

    setLocalVotes((m) => ({ ...m, [pollId]: next }));
    setLocalChoice((m) => ({ ...m, [pollId]: optionId }));

    try {
      const res = await fetch("/api/feed/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollId, optionId, visitorId: authorKey }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        votes?: Record<string, number>;
      };
      if (json.ok && json.votes) {
        setLocalVotes((m) => ({ ...m, [pollId]: json.votes! }));
      }
    } catch {
      /* optimistic state stays; next refresh reconciles */
    }
  }

  return (
    <section className="poll-panel">
      {polls.map(({ poll, votes }) => {
        const counts = localVotes[poll.id] ?? votes;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const myChoice = localChoice[poll.id] ?? myVotes[poll.id];
        return (
          <div key={poll.id} className="poll-card">
            <p className="poll-question">{poll.question}</p>
            <div className="poll-options">
              {poll.options.map((opt) => {
                const c = counts[opt.id] ?? 0;
                const pct = total > 0 ? Math.round((c / total) * 100) : 0;
                const picked = myChoice === opt.id;
                const won = poll.resolvedOptionId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`poll-option ${picked ? "poll-option-mine" : ""} ${
                      won ? "poll-option-won" : ""
                    }`}
                    onClick={() => vote(poll.id, opt.id)}
                    disabled={!!poll.resolvedOptionId}
                  >
                    <span
                      className="poll-option-fill"
                      style={{ width: `${pct}%` }}
                      aria-hidden="true"
                    />
                    <span className="poll-option-label">
                      {picked && <span aria-hidden="true">✓ </span>}
                      {opt.label}
                      {won && <span aria-hidden="true"> 🏆</span>}
                    </span>
                    <span className="poll-option-pct">{pct}%</span>
                  </button>
                );
              })}
            </div>
            <p className="poll-total">
              {total === 0
                ? "Be the first to vote"
                : `${total} vote${total === 1 ? "" : "s"}${
                    myChoice ? " · tap to change" : ""
                  }`}
            </p>
          </div>
        );
      })}
    </section>
  );
}
