"use client";

/**
 * Single-card deck for prediction polls. Replaces the vertical
 * stack that gave us 4+ cards in a row eating most of the feed
 * viewport. Behaviour modelled on Real's prediction strip:
 *
 *   - One poll visible at a time
 *   - Vote → community % reveal → ~2 s pause → auto-advance to
 *     the next unvoted poll
 *   - Tiny dot strip below the card lets the user jump around
 *
 * Unvoted polls come first (newest first), then voted polls so
 * the user always lands on something they haven't called yet.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import PredictionPollCard from "./PredictionPollCard";
import type {
  PredictionPoll,
  PredictionPollCounts,
} from "@/lib/feed/prediction-polls";

interface PollEntry {
  poll: PredictionPoll;
  counts: PredictionPollCounts;
  myVote: string | null;
}

interface Props {
  polls: PollEntry[];
  myVotes: Record<
    string,
    { counts: PredictionPollCounts; myVote: string | null }
  >;
  onVote: (pollId: string, optionKey: string) => void;
}

const ADVANCE_AFTER_VOTE_MS = 1800;

export default function PredictionPollDeck({ polls, myVotes, onVote }: Props) {
  // Stable ordering: unvoted first (newest first), then voted
  // (newest first). Overlay myVotes onto the server snapshot so an
  // optimistic vote we just cast moves the poll to the "voted"
  // bucket without waiting for a refresh.
  const ordered = useMemo(() => {
    const enriched = polls.map((p) => {
      const overlay = myVotes[p.poll.id];
      return {
        poll: p.poll,
        counts: overlay?.counts ?? p.counts,
        myVote: overlay?.myVote ?? p.myVote,
      };
    });
    enriched.sort((a, b) => {
      const aV = a.myVote != null ? 1 : 0;
      const bV = b.myVote != null ? 1 : 0;
      if (aV !== bV) return aV - bV;
      return b.poll.openedAt - a.poll.openedAt;
    });
    return enriched;
  }, [polls, myVotes]);

  const [idx, setIdx] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clamp idx if the deck shrinks (a poll just settled and dropped out).
  useEffect(() => {
    if (idx >= ordered.length && ordered.length > 0) setIdx(0);
  }, [ordered.length, idx]);

  // Auto-land on the first unvoted poll whenever the unvoted set
  // changes (e.g. a new poll arrives via the next /api/feed tick).
  const firstUnvotedKey = useMemo(() => {
    const f = ordered.find((e) => e.myVote == null);
    return f ? f.poll.id : null;
  }, [ordered]);
  const lastFirstUnvotedKey = useRef<string | null>(null);
  useEffect(() => {
    if (firstUnvotedKey !== lastFirstUnvotedKey.current) {
      lastFirstUnvotedKey.current = firstUnvotedKey;
      if (firstUnvotedKey) {
        const i = ordered.findIndex((e) => e.poll.id === firstUnvotedKey);
        if (i >= 0) setIdx(i);
      }
    }
  }, [firstUnvotedKey, ordered]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  if (ordered.length === 0) return null;
  const current = ordered[Math.min(idx, ordered.length - 1)];

  const handleVote = (opt: string) => {
    onVote(current.poll.id, opt);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    // Hold the community-% reveal for a beat, then advance to the
    // next still-unvoted poll if there is one.
    advanceTimer.current = setTimeout(() => {
      const nextUnvotedIdx = ordered.findIndex(
        (e, i) => i > idx && e.myVote == null,
      );
      if (nextUnvotedIdx >= 0) {
        setIdx(nextUnvotedIdx);
      } else if (idx < ordered.length - 1) {
        setIdx(idx + 1);
      }
    }, ADVANCE_AFTER_VOTE_MS);
  };

  const goPrev = () => setIdx((i) => Math.max(0, i - 1));
  const goNext = () => setIdx((i) => Math.min(ordered.length - 1, i + 1));

  return (
    <div className="predpoll-deck">
      <PredictionPollCard
        key={current.poll.id}
        poll={current.poll}
        counts={current.counts}
        myVote={current.myVote}
        onVote={handleVote}
      />
      {ordered.length > 1 && (
        <div className="predpoll-deck-nav">
          <button
            type="button"
            className="predpoll-deck-nav-btn"
            onClick={goPrev}
            disabled={idx === 0}
            aria-label="Previous call"
          >
            ‹
          </button>
          <div className="predpoll-deck-dots">
            {ordered.map((e, i) => (
              <button
                type="button"
                key={e.poll.id}
                className={`predpoll-deck-dot ${
                  i === idx ? "predpoll-deck-dot-on" : ""
                } ${e.myVote != null ? "predpoll-deck-dot-voted" : ""}`}
                onClick={() => setIdx(i)}
                aria-label={`Call ${i + 1} of ${ordered.length}${
                  e.myVote != null ? ", voted" : ""
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            className="predpoll-deck-nav-btn"
            onClick={goNext}
            disabled={idx === ordered.length - 1}
            aria-label="Next call"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
