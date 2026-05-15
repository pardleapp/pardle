"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedRow } from "@/lib/feed/types";
import Reel from "./Reel";

const AUTHOR_KEY_STORAGE = "pardle_feed_author";

/** Stable per-browser id — same one /live uses for reactions/presence. */
function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

interface Props {
  best: FeedRow[];
  worst: FeedRow[];
}

/**
 * Renders the player's highlights + worst moments as Reels with working
 * 👍/👎. Reactions update optimistically locally and POST to the same
 * endpoint the main feed uses, so counts stay consistent.
 */
export default function PlayerHighlights({ best, worst }: Props) {
  const [bestRows, setBestRows] = useState(best);
  const [worstRows, setWorstRows] = useState(worst);
  const [myReactions, setMyReactions] = useState<
    Record<string, "up" | "down">
  >({});
  const authorKey = useRef<string>("");

  useEffect(() => {
    authorKey.current = getAuthorKey();
  }, []);

  async function sendReaction(eventId: string, dir: "up" | "down") {
    const prev = myReactions[eventId];
    if (prev === dir) return;

    const apply = (rows: FeedRow[]): FeedRow[] =>
      rows.map((r) => {
        if (r.event.id !== eventId) return r;
        const rc = { ...r.reactions };
        if (prev === "up") rc.up = Math.max(0, rc.up - 1);
        if (prev === "down") rc.down = Math.max(0, rc.down - 1);
        rc[dir] += 1;
        return { ...r, reactions: rc };
      });

    setMyReactions((m) => ({ ...m, [eventId]: dir }));
    setBestRows(apply);
    setWorstRows(apply);

    try {
      await fetch("/api/feed/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          dir,
          authorKey: authorKey.current,
        }),
      });
    } catch {
      /* optimistic update stays; next page load reconciles */
    }
  }

  if (bestRows.length === 0 && worstRows.length === 0) return null;

  return (
    <>
      {bestRows.length > 0 && (
        <Reel
          title="⛳ Top plays"
          rows={bestRows}
          myReactions={myReactions}
          onReact={sendReaction}
        />
      )}
      {worstRows.length > 0 && (
        <Reel
          title="💀 Worst moments"
          rows={worstRows}
          myReactions={myReactions}
          onReact={sendReaction}
        />
      )}
    </>
  );
}
