"use client";

/**
 * Inline comment thread for a single event. Fetches on first mount,
 * composes optimistically, respects the server's 8s per-visitor rate
 * limit. Kept minimal — no threading, no reactions on comments; just
 * a scrolling list + a compose box.
 *
 * Rendered inside a v4 expanded row when the user clicks the 💬 badge
 * on any event pill.
 */

import { useEffect, useRef, useState } from "react";
import type { FeedComment } from "@/lib/feed/types";

interface Props {
  eventId: string;
  authorKey: string;
  /** Persistent display name for the visitor. If missing, we prompt
   *  on first send. */
  initialAuthorName?: string | null;
  onCommentPosted?: () => void;
}

const NAME_STORAGE = "pardle_display_name";
const COMMENT_MAX = 280;

function readName(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(NAME_STORAGE);
}

function writeName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NAME_STORAGE, name);
}

function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `${diff}s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function CommentThread({
  eventId,
  authorKey,
  initialAuthorName,
  onCommentPosted,
}: Props) {
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [name, setName] = useState<string>(() => initialAuthorName ?? readName() ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/feed/comment?eventId=${encodeURIComponent(eventId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok: boolean; comments?: FeedComment[] };
        if (!cancelled) setComments(json.comments ?? []);
      } catch {
        if (!cancelled) setError("Couldn't load comments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Freshness ticker for "3s / 12m ago" labels.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    let authorName = name.trim();
    if (!authorName) {
      const suggested = window.prompt("Pick a display name (shown next to your comment):");
      if (!suggested) return;
      authorName = suggested.trim().slice(0, 30);
      if (!authorName) return;
      setName(authorName);
      writeName(authorName);
    }
    setSending(true);
    setError(null);
    // Optimistic append
    const optimistic: FeedComment = {
      id: `optimistic-${Date.now()}`,
      eventId,
      ts: Date.now(),
      authorName,
      authorKey,
      text: trimmed.slice(0, COMMENT_MAX),
    };
    setComments((c) => [...c, optimistic]);
    setText("");
    try {
      const res = await fetch("/api/feed/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          text: trimmed,
          authorName,
          authorKey,
        }),
      });
      if (!res.ok) {
        // Rewind the optimistic add
        setComments((c) => c.filter((x) => x.id !== optimistic.id));
        const body = await res.json().catch(() => ({}));
        if (body?.error === "slow-down") setError("Slow down — one comment every ~8s.");
        else setError("Couldn't post — try again");
      } else {
        onCommentPosted?.();
      }
    } catch {
      setComments((c) => c.filter((x) => x.id !== optimistic.id));
      setError("Couldn't post — try again");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="v4-comments" onClick={(e) => e.stopPropagation()}>
      <div className="v4-comments-label">
        {loading
          ? "COMMENTS…"
          : comments.length === 0
            ? "NO COMMENTS YET"
            : `${comments.length} COMMENT${comments.length === 1 ? "" : "S"}`}
      </div>
      {comments.length > 0 && (
        <ul className="v4-comments-list">
          {comments.map((c) => (
            <li key={c.id} className="v4-comment">
              <span className="v4-comment-author">{c.authorName}</span>
              <span className="v4-comment-time">· {timeAgo(c.ts, now)}</span>
              <div className="v4-comment-text">{c.text}</div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="v4-comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="v4-comment-input"
          placeholder="Say something…"
          value={text}
          maxLength={COMMENT_MAX}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
        />
        <button
          type="submit"
          className="v4-comment-send"
          disabled={sending || text.trim().length === 0}
        >
          {sending ? "…" : "Post"}
        </button>
      </form>
      {error && <div className="v4-comment-error">{error}</div>}
    </div>
  );
}
