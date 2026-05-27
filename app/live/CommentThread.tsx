"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedComment } from "@/lib/feed/types";

const NAME_STORAGE = "pardle_feed_name";
const COMMENT_MAX = 280;

interface Props {
  eventId: string;
  authorKey: string;
  /** Bubble the new total up so the row's 💬 count stays in sync. */
  onCountChange?: (count: number) => void;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export default function CommentThread({
  eventId,
  authorKey,
  onCountChange,
}: Props) {
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const loadedName = useRef(false);

  // Load persisted display name once.
  useEffect(() => {
    if (loadedName.current) return;
    loadedName.current = true;
    const stored = window.localStorage.getItem(NAME_STORAGE);
    if (stored) setName(stored);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/feed/comment?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok: boolean;
        comments: FeedComment[];
      };
      if (json.ok) {
        setComments(json.comments);
        onCountChange?.(json.comments.length);
      }
    } catch {
      setComments([]);
    }
  }, [eventId, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedText = text.trim();
    if (!trimmedName) {
      setErr("Pick a display name first.");
      return;
    }
    if (!trimmedText || busy) return;

    setBusy(true);
    setErr(null);
    window.localStorage.setItem(NAME_STORAGE, trimmedName);

    try {
      const res = await fetch("/api/feed/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          text: trimmedText,
          authorName: trimmedName,
          authorKey,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        comment?: FeedComment;
      };
      if (!json.ok) {
        setErr(
          json.error === "slow-down"
            ? "Easy — wait a few seconds between comments."
            : "Couldn't post that. Try again.",
        );
        return;
      }
      if (json.comment) {
        setComments((c) => {
          const next = [...(c ?? []), json.comment!];
          onCountChange?.(next.length);
          return next;
        });
        setText("");
      }
    } catch {
      setErr("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="feed-thread">
      {comments === null ? (
        <ul className="feed-thread-list" aria-busy="true">
          {[0, 1].map((i) => (
            <li key={i} className="feed-comment feed-comment-skeleton">
              <span className="skeleton-line feed-comment-skel-author" />
              <span className="skeleton-line feed-comment-skel-text" />
            </li>
          ))}
        </ul>
      ) : comments.length === 0 ? (
        <p className="feed-thread-loading">
          No comments yet — say something.
        </p>
      ) : (
        <ul className="feed-thread-list">
          {comments.map((c) => (
            <li key={c.id} className="feed-comment">
              <span className="feed-comment-author">{c.authorName}</span>
              <span className="feed-comment-text">{c.text}</span>
              <span className="feed-comment-time">{timeAgo(c.ts)}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="feed-comment-form">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={30}
          className="feed-comment-name"
          aria-label="Your display name"
        />
        <div className="feed-comment-input-row">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What a shot…"
            maxLength={COMMENT_MAX}
            className="feed-comment-input"
            aria-label="Your comment"
          />
          <button
            type="submit"
            disabled={busy || !text.trim() || !name.trim()}
            className="feed-comment-send"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
        {err && <p className="feed-comment-err">{err}</p>}
      </form>
    </div>
  );
}
