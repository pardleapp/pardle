"use client";

/**
 * Single-card deck for prediction polls. One poll visible at a
 * time; vote → see community % → auto-advance to the next unvoted
 * poll. Once every open poll has a vote, the deck hides.
 *
 * Key design: track the currently-displayed poll by **pollId**, not
 * by index into the sorted list. Voting on a poll moves it to the
 * "voted" bucket in the sort, but the displayed card stays put for
 * the reveal window — without this, the just-voted card slides out
 * from under the user the instant the optimistic overlay lands.
 *
 * State machine:
 *
 *   browsing  ─── vote ───▶  revealing  ── 1.8s ──▶ browsing
 *      ▲                                                │
 *      └────── advance to next unvoted ────────────────┘
 *
 * - browsing: data refresh / new poll arriving can move the deck
 *   to the first unvoted call.
 * - revealing: the just-voted poll stays on screen so the
 *   community-% reveal is visible. Auto-jumps are suppressed.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const REVEAL_MS = 2000;

type Phase = "browsing" | "revealing";

export default function PredictionPollDeck({ polls, myVotes, onVote }: Props) {
  // Overlay optimistic votes onto the server snapshot, then sort
  // unvoted-first so the dot strip reads left-to-right as progress.
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

  // Ref to the freshest ordered list so timers fired later can
  // make decisions against the LATEST data, not a stale closure.
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  // Currently displayed poll, tracked by id so the sort can shuffle
  // the underlying list without yanking the card out from under the
  // user. Null = "deck hasn't picked anything yet" (initial mount).
  const [currentPollId, setCurrentPollId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("browsing");
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial mount + data-refresh landing rule: when we're in browsing
  // mode and either the currently-pinned poll has vanished from the
  // list OR we're sitting on a voted poll while unvoted ones exist,
  // jump to the first unvoted. Suppressed during the reveal window
  // so a vote can't be yanked off-screen mid-reveal.
  useEffect(() => {
    if (phase === "revealing") return;
    if (ordered.length === 0) {
      if (currentPollId != null) setCurrentPollId(null);
      return;
    }
    const currentEntry = currentPollId
      ? ordered.find((e) => e.poll.id === currentPollId)
      : null;
    // If the pinned poll is still in the list and still unvoted, keep it.
    if (currentEntry && currentEntry.myVote == null) return;
    // Otherwise, land on the first unvoted poll if one exists.
    const firstUnvoted = ordered.find((e) => e.myVote == null);
    if (firstUnvoted) {
      if (firstUnvoted.poll.id !== currentPollId) {
        setCurrentPollId(firstUnvoted.poll.id);
      }
      return;
    }
    // No unvoted polls left — sit on the most-recent voted poll
    // (the deck will hide via the all-voted check below unless
    // we're actively revealing).
    if (currentPollId == null) setCurrentPollId(ordered[0].poll.id);
  }, [phase, ordered, currentPollId]);

  // Clean up any in-flight timer on unmount.
  useEffect(() => {
    return () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, []);

  const handleVote = useCallback(
    (opt: string) => {
      if (!currentPollId) return;
      const justVotedId = currentPollId;
      onVote(justVotedId, opt);
      // Enter the reveal phase — locks the deck onto the just-
      // voted poll so the community % is visible.
      setPhase("revealing");
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => {
        // Use the LATEST ordered (not closure'd) to pick what to
        // show next. Find any still-unvoted poll; otherwise stay
        // on the just-voted one and let the all-voted hide kick in.
        const latest = orderedRef.current;
        const nextUnvoted = latest.find((e) => e.myVote == null);
        if (nextUnvoted && nextUnvoted.poll.id !== justVotedId) {
          setCurrentPollId(nextUnvoted.poll.id);
        }
        setPhase("browsing");
      }, REVEAL_MS);
    },
    [currentPollId, onVote],
  );

  // ── Render gates ────────────────────────────────────────────────
  if (ordered.length === 0) return null;
  const allVoted = ordered.every((e) => e.myVote != null);
  if (allVoted && phase !== "revealing") return null;

  const current =
    (currentPollId && ordered.find((e) => e.poll.id === currentPollId)) ||
    ordered[0];
  if (!current) return null;
  const currentIndex = ordered.findIndex(
    (e) => e.poll.id === current.poll.id,
  );

  const goPrev = () => {
    const target = ordered[Math.max(0, currentIndex - 1)];
    if (target) setCurrentPollId(target.poll.id);
  };
  const goNext = () => {
    const target = ordered[Math.min(ordered.length - 1, currentIndex + 1)];
    if (target) setCurrentPollId(target.poll.id);
  };

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
            disabled={currentIndex <= 0}
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
                  i === currentIndex ? "predpoll-deck-dot-on" : ""
                } ${e.myVote != null ? "predpoll-deck-dot-voted" : ""}`}
                onClick={() => setCurrentPollId(e.poll.id)}
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
            disabled={currentIndex >= ordered.length - 1}
            aria-label="Next call"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
