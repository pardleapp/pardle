"use client";

/**
 * Single-call surfacer for prediction polls. Shows ONE open poll
 * at a time per session — the most-recently opened call the user
 * hasn't voted on or dismissed. After they vote / dismiss, the
 * card disappears entirely from this page.
 *
 * Dismissed poll ids persist to localStorage so the same call
 * doesn't reappear on the next visit. Server-side "myVote" is
 * the authority for the voted state; dismissed is purely a
 * client preference.
 *
 * Design choices vs. the old multi-poll deck:
 *   - No navigation chrome (no prev/next, no per-poll dots).
 *     Real / Threads pattern: see one, act, move on.
 *   - Pre-vote state HIDES the community % bars so "100%" doesn't
 *     read as the user's selection before they've tapped anything.
 *   - Dismiss × so a user who doesn't care about this question
 *     can clear it without a stake-y feeling vote.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const DISMISSED_KEY = "pardle_predpoll_dismissed_v1";
const POST_VOTE_HOLD_MS = 3200;

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {
    // silent
  }
}

export default function PredictionPollDeck({ polls, myVotes, onVote }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // Snapshot of the just-voted card — taken at the moment the
  // user taps an option and locked in until the hold timer
  // expires. We render this directly instead of recomputing
  // from props each render. Without this, a data refresh hitting
  // during the reveal window could briefly flip the card back to
  // pre-vote state before it disappeared (the bug the user saw).
  const [revealed, setRevealed] = useState<{
    poll: PredictionPoll;
    counts: PredictionPollCounts;
    myVote: string;
  } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One-and-done per page visit: once the user has voted or
  // dismissed the call surfaced on this mount, we don't pick
  // another one. They get a fresh question next time they
  // navigate to /live (component remounts → flag resets).
  const [interactedThisMount, setInteractedThisMount] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, []);

  // Choose the one poll to show: latest open, unvoted, not dismissed.
  // Once the user has voted or dismissed during this mount, we stop
  // picking new ones — the deck stays empty for the rest of this
  // page visit so the feed gets the screen real estate back.
  const pickedPoll = useMemo(() => {
    if (interactedThisMount) return null;
    const candidates = polls.filter((p) => {
      const myVote = myVotes[p.poll.id]?.myVote ?? p.myVote;
      if (myVote != null) return false;
      if (dismissed.has(p.poll.id)) return false;
      return true;
    });
    candidates.sort((a, b) => b.poll.openedAt - a.poll.openedAt);
    return candidates[0] ?? null;
  }, [polls, myVotes, dismissed, interactedThisMount]);

  // While the reveal snapshot exists, render IT directly — bypass
  // the prop chain. Falls through to the natural picked poll only
  // when no reveal is on screen (initial render, post-hold-expiry).
  const visibleEntry = useMemo(() => {
    if (revealed) return revealed;
    return pickedPoll
      ? {
          poll: pickedPoll.poll,
          counts:
            myVotes[pickedPoll.poll.id]?.counts ?? pickedPoll.counts,
          myVote: myVotes[pickedPoll.poll.id]?.myVote ?? pickedPoll.myVote,
        }
      : null;
  }, [revealed, pickedPoll, myVotes]);

  const handleVote = useCallback(
    (opt: string) => {
      if (!visibleEntry) return;
      const pollId = visibleEntry.poll.id;
      // Build the "voted state" snapshot from what we know right
      // now: bump the chosen option's count by 1 so the community-
      // % bar reflects the optimistic vote we're about to send.
      // This is what the card renders for the entire hold window.
      const optimisticCounts: PredictionPollCounts = {
        ...visibleEntry.counts,
      };
      optimisticCounts[opt] = (optimisticCounts[opt] ?? 0) + 1;
      onVote(pollId, opt);
      setInteractedThisMount(true);
      setRevealed({
        poll: visibleEntry.poll,
        counts: optimisticCounts,
        myVote: opt,
      });
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        setRevealed(null);
      }, POST_VOTE_HOLD_MS);
    },
    [visibleEntry, onVote],
  );

  const handleDismiss = useCallback(() => {
    if (!visibleEntry) return;
    const pollId = visibleEntry.poll.id;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(pollId);
      writeDismissed(next);
      return next;
    });
    setInteractedThisMount(true);
  }, [visibleEntry]);

  if (!visibleEntry) return null;

  return (
    <PredictionPollCard
      poll={visibleEntry.poll}
      counts={visibleEntry.counts}
      myVote={visibleEntry.myVote}
      onVote={handleVote}
      onDismiss={handleDismiss}
      hideResultsUntilVote
    />
  );
}
