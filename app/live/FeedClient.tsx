"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedRow } from "@/lib/feed/types";

const REFRESH_MS = 20_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_author";

interface FeedResponse {
  tournament: {
    id: string;
    name: string;
    isLive: boolean;
    startDate: number;
  } | null;
  rows: FeedRow[];
  polled: boolean;
}

/** Stable per-browser id for reactions — generated once, persisted locally. */
function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function FeedClient() {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState(false);
  const [myReactions, setMyReactions] = useState<
    Record<string, "up" | "down">
  >({});
  const authorKey = useRef<string>("");

  useEffect(() => {
    authorKey.current = getAuthorKey();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feed", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as FeedResponse;
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function sendReaction(eventId: string, dir: "up" | "down") {
    // Optimistic — flip local state immediately.
    setMyReactions((m) => ({ ...m, [eventId]: dir }));
    setData((d) => {
      if (!d) return d;
      return {
        ...d,
        rows: d.rows.map((row) => {
          if (row.event.id !== eventId) return row;
          const prev = myReactions[eventId];
          const r = { ...row.reactions };
          if (prev === dir) return row;
          if (prev === "up") r.up = Math.max(0, r.up - 1);
          if (prev === "down") r.down = Math.max(0, r.down - 1);
          r[dir] += 1;
          return { ...row, reactions: r };
        }),
      };
    });
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
      /* optimistic update stays; next refresh corrects it */
    }
  }

  // ── Empty / loading / not-live states ───────────────────────────
  if (error && !data) {
    return (
      <p className="feed-empty">
        Couldn&apos;t load the feed. It&apos;ll retry automatically.
      </p>
    );
  }
  if (!data) {
    return <p className="feed-empty">Loading the feed…</p>;
  }
  if (!data.tournament) {
    return (
      <p className="feed-empty">
        No tournament on the schedule right now. Check back on a tour week.
      </p>
    );
  }
  if (!data.tournament.isLive) {
    const days = Math.max(
      0,
      Math.ceil((data.tournament.startDate - Date.now()) / 86_400_000),
    );
    return (
      <section className="feed-status-card">
        <h2 className="feed-tournament-name">{data.tournament.name}</h2>
        <p className="feed-empty">
          Tees off in {days} day{days === 1 ? "" : "s"}. The live feed
          fires up when the first group hits the course.
        </p>
      </section>
    );
  }

  // ── Live feed ───────────────────────────────────────────────────
  return (
    <section className="feed-wrap">
      <div className="feed-header-row">
        <h2 className="feed-tournament-name">{data.tournament.name}</h2>
        <span className="feed-live-dot">
          <span className="feed-live-pulse" /> LIVE
        </span>
      </div>

      {data.rows.length === 0 ? (
        <p className="feed-empty">
          Feed is warming up — first scores will appear here within a
          minute or two of the groups going out.
        </p>
      ) : (
        <ul className="feed-list">
          {data.rows.map(({ event, reactions, commentCount }) => {
            const mine = myReactions[event.id];
            return (
              <li
                key={event.id}
                className={`feed-row feed-row-${event.result ?? "other"}`}
              >
                <span className="feed-emoji" aria-hidden="true">
                  {event.emoji}
                </span>
                <div className="feed-body">
                  <p className="feed-headline">{event.headline}</p>
                  <p className="feed-meta">
                    R{event.round} · {timeAgo(event.ts)}
                  </p>
                </div>
                <div className="feed-actions">
                  <button
                    type="button"
                    className={`feed-react ${mine === "up" ? "feed-react-on" : ""}`}
                    onClick={() => sendReaction(event.id, "up")}
                    aria-label="Like"
                  >
                    👍 {reactions.up > 0 ? reactions.up : ""}
                  </button>
                  <button
                    type="button"
                    className={`feed-react ${mine === "down" ? "feed-react-on" : ""}`}
                    onClick={() => sendReaction(event.id, "down")}
                    aria-label="Dislike"
                  >
                    👎 {reactions.down > 0 ? reactions.down : ""}
                  </button>
                  <span className="feed-comment-count" aria-hidden="true">
                    💬 {commentCount}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="feed-footnote">
        Auto-refreshes every 20s · scores via PGA Tour, ~1–2 min behind live TV
      </p>
    </section>
  );
}
