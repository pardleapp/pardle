"use client";

/**
 * "My Sharp Score" card pinned at the top of /sharp. Reads the
 * caller's authorKey from localStorage (same key the home feed
 * uses), fetches their current stats via /api/feed, and renders
 * a hero card with a one-tap share button. The shared URL points
 * to /share/sharp/[opaque-token] — never exposes the authorKey,
 * which is also the API's write-credential for casting votes.
 */

import { useCallback, useEffect, useState } from "react";

const AUTHOR_KEY_STORAGE = "pardle_feed_author";

interface SharpStats {
  total: number;
  correct: number;
  accuracy: number;
  currentStreak: number;
  longestStreak: number;
  qualified: boolean;
  rank: number | null;
}

export default function MySharpCard({ minCalls }: { minCalls: number }) {
  const [authorKey, setAuthorKey] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [stats, setStats] = useState<SharpStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareStatus, setShareStatus] = useState<"idle" | "sending" | "sent" | "err">(
    "idle",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let key = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
    if (!key) {
      // First visit ever — no authorKey yet means no votes cast,
      // so no stats either. Skip the fetch.
      setLoading(false);
      return;
    }
    setAuthorKey(key);
    // Pull display name if Supabase auth is in play. Optional.
    try {
      const nameRaw = window.localStorage.getItem("pardle_display_name");
      if (nameRaw && nameRaw.trim().length > 0) setDisplayName(nameRaw);
    } catch {
      // silent
    }
    (async () => {
      try {
        const res = await fetch(`/api/feed?v=${encodeURIComponent(key)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { mySharp: SharpStats | null };
        if (json.mySharp) setStats(json.mySharp);
      } catch {
        // silent — show "Vote on something to get started" copy
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const share = useCallback(async () => {
    if (!authorKey) return;
    setShareStatus("sending");
    try {
      const res = await fetch("/api/sharp/share-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorKey }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { token?: string };
      const token = json.token;
      if (!token) throw new Error("no-token");
      const url = `${window.location.origin}/share/sharp/${token}`;
      const acc = stats?.qualified
        ? `${Math.round(stats.accuracy * 100)}%`
        : null;
      const text = acc
        ? `I'm calling ${acc} on Pardle Sharp Score across ${stats?.total} calls. ${url}`
        : `Building my Sharp Score on Pardle — ${stats?.total ?? 0} calls in. ${url}`;
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.share) {
        try {
          await nav.share({ title: "My Sharp Score", text, url });
          setShareStatus("sent");
          return;
        } catch {
          // user cancelled — fall through to wa.me
        }
      }
      window.open(
        `https://wa.me/?text=${encodeURIComponent(text)}`,
        "_blank",
        "noopener",
      );
      setShareStatus("sent");
    } catch {
      setShareStatus("err");
    }
  }, [authorKey, stats]);

  if (loading) {
    return (
      <div className="my-sharp-card my-sharp-card-loading" aria-busy="true">
        <div className="my-sharp-skeleton" />
      </div>
    );
  }
  if (!authorKey || !stats || stats.total === 0) {
    // Nothing to share yet — gentle prompt rather than an empty
    // share button that fires into the void.
    return (
      <div className="my-sharp-card my-sharp-card-empty">
        <p className="my-sharp-empty-line">
          <strong>Vote on a putt poll or a Sunday call</strong> to start
          your Sharp Score.
        </p>
      </div>
    );
  }
  const acc = Math.round(stats.accuracy * 100);
  const tone = !stats.qualified
    ? "neutral"
    : acc >= 60
      ? "good"
      : acc >= 50
        ? "ok"
        : "poor";
  const callsToGo = Math.max(0, minCalls - stats.total);

  return (
    <div className={`my-sharp-card my-sharp-card-${tone}`}>
      <div className="my-sharp-card-row">
        <div className="my-sharp-card-left">
          <p className="my-sharp-card-eyebrow">Your Sharp Score</p>
          <p className="my-sharp-card-headline">
            <span className="my-sharp-card-acc">{acc}%</span>
            <span className="my-sharp-card-acc-lbl">
              {stats.correct} of {stats.total} calls right
            </span>
          </p>
          <p className="my-sharp-card-sub">
            {stats.qualified
              ? `On the leaderboard${
                  stats.rank != null ? ` at #${stats.rank}` : ""
                }`
              : `${callsToGo} more ${
                  callsToGo === 1 ? "call" : "calls"
                } to land on the public leaderboard`}
            {stats.currentStreak >= 2 && ` · 🔥 ${stats.currentStreak} in a row`}
          </p>
        </div>
        <button
          type="button"
          className="my-sharp-share-btn"
          onClick={share}
          disabled={shareStatus === "sending"}
        >
          {shareStatus === "sent"
            ? "Shared ✓"
            : shareStatus === "sending"
              ? "…"
              : shareStatus === "err"
                ? "Try again"
                : "Share"}
        </button>
      </div>
      {displayName && (
        <p className="my-sharp-card-name">Signed in as {displayName}</p>
      )}
    </div>
  );
}
