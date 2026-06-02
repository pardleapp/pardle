"use client";

/**
 * GroupChat — realtime chat surface for one private group.
 *
 *   ┌──────────────────────────────────────┐
 *   │  Mia                                 │
 *   │  ▓▓ if scheffler bogeys 17 my parlay │
 *   │     is dead          [bet chip ↗]    │
 *   │                              just now │
 *   │                                      │
 *   │                            ▓▓ same    │
 *   │                            ▓▓ holding │
 *   │                            ▓▓ tight   │
 *   │                          You · just now│
 *   │--------------------------------------│
 *   │  [ Say something to your crew  ] [↑] │
 *   └──────────────────────────────────────┘
 *
 * Initial messages are server-rendered into props by page.tsx;
 * the component then subscribes to Supabase Realtime on
 * group_messages filtered by group_id so subsequent rows arrive
 * live without a refresh. Composer is sticky at the bottom of
 * the scroll container with `safe-area-inset-bottom` padding so
 * it sits above the iOS keyboard.
 *
 * Optimistic send: a placeholder bubble appears instantly with a
 * client-generated id (opt-N). When the POST returns the real
 * row, we swap the placeholder with the server's id. When the
 * realtime row arrives (same id), we dedup.
 *
 * v2 style language: bubbles render against the .pv tokens —
 * other-message bubbles use .pv-soft + .pv-line border; own
 * messages use .pv-emerald fill + white text and right-align.
 * No prototype component to match against (the prototype doesn't
 * include a chat surface); this follows the broadcast theme's
 * visual language for net-new behaviour.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { GroupMessageRow } from "@/lib/groups/server";
import { getSupabaseBrowser } from "@/lib/supabase/client";

interface Props {
  groupId: string;
  currentUserId: string;
  /** Server-rendered initial messages (ascending by created_at). */
  initialMessages: GroupMessageRow[];
  /** When set, the chat only renders messages referencing this
   *  bet — used by the "On this bet" thread on the bet-detail
   *  page. Defaults to undefined (all messages). */
  betIdFilter?: string;
  /** Composer placeholder copy varies between the in-group surface
   *  ("Say something to your crew") and the on-bet surface
   *  ("Comment on this bet…"). */
  placeholder?: string;
  /** Optional default bet attachment when sending — set by the
   *  bet-detail thread so every message auto-references that bet. */
  defaultBetId?: string;
}

const PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  SA: "linear-gradient(135deg,#f29a4f,#d44a4a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
};
function bgFor(initials: string): string {
  return PALETTE[initials] ?? "linear-gradient(135deg,#6b7df2,#3b1f8a)";
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function GroupChat({
  groupId,
  currentUserId,
  initialMessages,
  betIdFilter,
  placeholder = "Say something to your crew…",
  defaultBetId,
}: Props) {
  const [messages, setMessages] = useState<GroupMessageRow[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Filter when on the "On this bet" surface so the same DB rows
  // are partitioned across views without two fetches.
  const visible = useMemo(
    () =>
      betIdFilter
        ? messages.filter((m) => m.bet_id === betIdFilter)
        : messages,
    [messages, betIdFilter],
  );

  // Auto-scroll to bottom whenever the visible list grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  // Realtime subscription. Filters server-side via the channel's
  // `filter` clause so we only receive rows for this group_id.
  // Supabase Realtime applies RLS on each delivered row, so a
  // non-member of the group would never see anything anyway.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`group:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as {
            id: string;
            group_id: string;
            user_id: string;
            body: string;
            created_at: string;
            bet_id: string | null;
          };
          setMessages((prev) => {
            // Dedup — server returns the row to the sender via
            // POST first; realtime then delivers the same id.
            if (prev.some((m) => m.id === row.id)) return prev;
            // Optimistic placeholder match: same body + same user
            // + recent timestamp → swap the optimistic bubble
            // with the real row.
            const optIdx = prev.findIndex(
              (m) =>
                m.id.startsWith("opt-") &&
                m.user_id === row.user_id &&
                m.body === row.body,
            );
            const enriched: GroupMessageRow = {
              id: row.id,
              group_id: row.group_id,
              user_id: row.user_id,
              body: row.body,
              created_at: row.created_at,
              bet_id: row.bet_id,
              author_name:
                optIdx >= 0 ? prev[optIdx].author_name : "Member",
              author_initials:
                optIdx >= 0
                  ? prev[optIdx].author_initials
                  : row.user_id.replace(/-/g, "").slice(0, 2).toUpperCase(),
              bet: optIdx >= 0 ? prev[optIdx].bet : null,
            };
            if (optIdx >= 0) {
              const next = [...prev];
              next[optIdx] = enriched;
              return next;
            }
            return [...prev, enriched];
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);

  const send = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (sending) return;
      const body = input.trim();
      if (!body) return;
      setSending(true);
      setErr(null);
      const optimisticId = `opt-${Date.now()}`;
      const optimistic: GroupMessageRow = {
        id: optimisticId,
        group_id: groupId,
        user_id: currentUserId,
        body,
        created_at: new Date().toISOString(),
        bet_id: defaultBetId ?? null,
        author_name: "You",
        author_initials: "YO",
        bet: null,
      };
      setMessages((m) => [...m, optimistic]);
      setInput("");
      try {
        const res = await fetch(
          `/api/groups/${encodeURIComponent(groupId)}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body,
              betId: defaultBetId ?? null,
            }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        const json = (await res.json()) as { message: GroupMessageRow };
        setMessages((m) =>
          m.map((x) => (x.id === optimisticId ? json.message : x)),
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't send");
        // Roll back the optimistic bubble.
        setMessages((m) => m.filter((x) => x.id !== optimisticId));
        setInput(body);
      } finally {
        setSending(false);
      }
    },
    [input, sending, groupId, currentUserId, defaultBetId],
  );

  return (
    <div className="chat-stack">
      <div className="chat-scroll" ref={scrollRef}>
        {visible.length === 0 ? (
          <p className="chat-empty">
            {betIdFilter
              ? "No comments on this bet yet. Be the first."
              : "Say something to your crew."}
          </p>
        ) : (
          visible.map((m, i) => {
            const mine = m.user_id === currentUserId;
            const prev = i > 0 ? visible[i - 1] : null;
            const grouped =
              prev != null &&
              prev.user_id === m.user_id &&
              new Date(m.created_at).getTime() -
                new Date(prev.created_at).getTime() <
                4 * 60_000;
            return (
              <div
                key={m.id}
                className={`chat-row${mine ? " chat-row-mine" : ""}${
                  grouped ? " chat-row-grouped" : ""
                }`}
              >
                {!mine && !grouped && (
                  <span
                    className="chat-row-av"
                    style={{ background: bgFor(m.author_initials) }}
                    aria-hidden="true"
                  >
                    {m.author_initials}
                  </span>
                )}
                {!mine && grouped && <span className="chat-row-av-spacer" />}
                <div className="chat-row-body">
                  {!mine && !grouped && (
                    <span className="chat-row-author">{m.author_name}</span>
                  )}
                  <span className="chat-row-bubble">{m.body}</span>
                  {m.bet && (
                    <Link
                      href={`/live/bet/${encodeURIComponent(m.bet.id)}`}
                      className="chat-bet-chip"
                    >
                      <span className="chat-bet-chip-player">
                        {m.bet.player_name ?? "Bet"}
                      </span>
                      <span className="chat-bet-chip-market">
                        {m.bet.market_label}
                      </span>
                      <span className="chat-bet-chip-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </Link>
                  )}
                  <span className="chat-row-ts">{timeAgo(m.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form className="chat-composer" onSubmit={send}>
        <input
          className="chat-composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          maxLength={2000}
          disabled={sending}
          autoComplete="off"
        />
        <button
          type="submit"
          className="chat-composer-send"
          disabled={sending || !input.trim()}
          aria-label="Send"
        >
          ↑
        </button>
      </form>
      {err && <p className="chat-error">{err}</p>}
    </div>
  );
}
