"use client";

/**
 * TournamentChat — persistent room chat on /live.
 *
 * Three states:
 *   1. Peek — 44px sticky bar above BottomNav, shows latest message + time.
 *   2. Half — bottom sheet at ~55vh, feed still visible above.
 *   3. Full — full-viewport chat, back-tap or drag-down to return.
 *
 * Anonymous — reuses the same cookie authorKey pattern comments +
 * putt-polls use. Author name persists in localStorage; first
 * message prompts for one.
 *
 * Poll cadence: 5s in Half/Full, 15s while collapsed to Peek —
 * cheap keep-alive to keep the peek preview line current without
 * hammering the endpoint when nobody is actively reading.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/lib/feed/store";

const NAME_STORAGE = "pardle_feed_name";
const AUTHOR_KEY_STORAGE = "pardle_feed_author";
const MSG_MAX = 280;

interface Props {
  tournamentId: string;
  tournamentName: string;
}

type SheetState = "peek" | "half" | "full";

function getOrCreateAuthorKey(): string {
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
  if (s < 10) return "just now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export default function TournamentChat({
  tournamentId,
  tournamentName,
}: Props) {
  const [state, setState] = useState<SheetState>("peek");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nameEditing, setNameEditing] = useState(false);
  const authorKey = useRef<string>("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    authorKey.current = getOrCreateAuthorKey();
    const stored = window.localStorage.getItem(NAME_STORAGE);
    if (stored) setName(stored);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/chat/room/${encodeURIComponent(tournamentId)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok: boolean;
        messages: ChatMessage[];
      };
      if (json.ok) setMessages(json.messages);
    } catch {
      /* transient — retry on next tick */
    }
  }, [tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll cadence — 5s when the sheet is open, 15s while peeked.
  useEffect(() => {
    const interval = state === "peek" ? 15_000 : 5_000;
    const id = setInterval(load, interval);
    return () => clearInterval(id);
  }, [state, load]);

  // Scroll message list to the bottom whenever new messages land
  // OR the sheet just opened.
  useEffect(() => {
    if (state === "peek") return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, state]);

  const latest = messages[messages.length - 1];

  const submit = useCallback(async () => {
    setErr(null);
    const trimmedName = name.trim();
    const trimmedText = text.trim();
    if (!trimmedName) {
      setErr("Set a display name to chat");
      setNameEditing(true);
      return;
    }
    if (!trimmedText) return;
    setBusy(true);
    try {
      window.localStorage.setItem(NAME_STORAGE, trimmedName);
      const res = await fetch(
        `/api/chat/room/${encodeURIComponent(tournamentId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: trimmedText.slice(0, MSG_MAX),
            authorName: trimmedName,
            authorKey: authorKey.current,
          }),
        },
      );
      const json = (await res.json()) as {
        ok: boolean;
        message?: ChatMessage;
        error?: string;
      };
      if (!json.ok) {
        setErr(json.error === "slow-down" ? "One sec — slow down" : "Send failed");
      } else {
        setText("");
        if (json.message) {
          setMessages((m) => [...m, json.message as ChatMessage]);
        }
        composerRef.current?.focus();
      }
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }, [name, text, tournamentId]);

  const openHalf = () => setState("half");
  const collapse = () => setState("peek");
  const toggleFull = () =>
    setState((s) => (s === "full" ? "half" : "full"));

  // Peek preview — one line of latest message + who + when.
  const peekPreview = useMemo(() => {
    if (!latest) return "Say something to the room";
    const who = latest.authorName || "Anon";
    return `${who}: ${latest.text}`;
  }, [latest]);

  const wrapperClass =
    state === "peek"
      ? "tchat tchat-peek"
      : state === "half"
        ? "tchat tchat-half"
        : "tchat tchat-full";

  return (
    <div className={wrapperClass}>
      {state === "peek" ? (
        <button
          type="button"
          className="tchat-peek-btn"
          onClick={openHalf}
          aria-label="Open tournament chat"
        >
          <span className="tchat-peek-ic" aria-hidden="true">💬</span>
          <span className="tchat-peek-preview">
            {peekPreview}
          </span>
          {latest && (
            <span className="tchat-peek-when">{timeAgo(latest.ts)}</span>
          )}
        </button>
      ) : (
        <>
          <div className="tchat-sheet-head">
            <button
              type="button"
              className="tchat-handle"
              onClick={collapse}
              aria-label="Collapse chat"
            >
              <span className="tchat-handle-bar" aria-hidden="true" />
            </button>
            <div className="tchat-sheet-title">
              <span className="tchat-sheet-name">{tournamentName}</span>
              <span className="tchat-sheet-sub">Live chat · say hi</span>
            </div>
            <button
              type="button"
              className="tchat-sheet-expand"
              onClick={toggleFull}
              aria-label={state === "full" ? "Shrink" : "Expand"}
            >
              {state === "full" ? "⌵" : "⌃"}
            </button>
          </div>
          <div className="tchat-list" ref={listRef}>
            {messages.length === 0 ? (
              <p className="tchat-empty">
                No messages yet. Kick things off.
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.authorKey === authorKey.current;
                return (
                  <div
                    key={m.id}
                    className={`tchat-msg ${mine ? "tchat-msg-mine" : ""}`}
                  >
                    <div className="tchat-msg-meta">
                      <span className="tchat-msg-author">{m.authorName}</span>
                      <span className="tchat-msg-time">{timeAgo(m.ts)}</span>
                    </div>
                    <div className="tchat-msg-text">{m.text}</div>
                  </div>
                );
              })
            )}
          </div>
          {(nameEditing || !name) && (
            <div className="tchat-name-row">
              <input
                type="text"
                className="tchat-name-input"
                placeholder="Your display name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 30))}
                maxLength={30}
                autoFocus
              />
              <button
                type="button"
                className="tchat-name-save"
                onClick={() => {
                  if (name.trim()) {
                    window.localStorage.setItem(NAME_STORAGE, name.trim());
                    setNameEditing(false);
                    composerRef.current?.focus();
                  }
                }}
              >
                Save
              </button>
            </div>
          )}
          <form
            className="tchat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              ref={composerRef}
              type="text"
              className="tchat-input"
              placeholder={name ? "Say something…" : "Set a name first"}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MSG_MAX))}
              maxLength={MSG_MAX}
              disabled={busy}
            />
            <button
              type="submit"
              className="tchat-send"
              disabled={busy || !text.trim()}
              aria-label="Send message"
            >
              →
            </button>
          </form>
          {err && <div className="tchat-err">{err}</div>}
          {name && !nameEditing && (
            <button
              type="button"
              className="tchat-name-edit"
              onClick={() => setNameEditing(true)}
            >
              Chatting as <strong>{name}</strong> — change
            </button>
          )}
        </>
      )}
    </div>
  );
}
