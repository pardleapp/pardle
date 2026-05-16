"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Burst, CachedLeaderboardRow } from "@/lib/feed/store";
import type { FeedRow } from "@/lib/feed/types";
import BetTracker from "./BetTracker";
import CatchMeUp from "./CatchMeUp";
import CommentThread from "./CommentThread";
import FollowButton, { getFollows } from "./FollowButton";
import LeaderboardPanel from "./LeaderboardPanel";
import PlayerSearch from "./PlayerSearch";
import Reel from "./Reel";

const REFRESH_MS = 6_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_author";
const BURST_EMOJIS = ["🔥", "😱", "⛳", "👏", "💀", "🐐"];
const FLOATER_LIFETIME_MS = 2600;

interface FeedResponse {
  tournament: {
    id: string;
    name: string;
    isLive: boolean;
    startDate: number;
  } | null;
  rows: FeedRow[];
  bestReel: FeedRow[];
  worstReel: FeedRow[];
  bursts: Burst[];
  leaderboard: CachedLeaderboardRow[];
  playerIndex: CachedLeaderboardRow[];
  currentOdds: Record<string, number>;
  playerRoundStates: Record<
    string,
    {
      currentRound: number;
      holesPlayed: number;
      holesRemaining: number;
      strokes: number;
      parPlayed: number;
      parRemaining: number;
      roundPar: number;
      toPar: number;
      ttdPacePerHole: number;
      ttdHoles: number;
    }
  >;
  watching: number;
  seenToday: number;
  polled: boolean;
}

interface Floater {
  key: string;
  emoji: string;
  xPct: number;
}

/** Stable per-browser id for reactions/presence — generated once, persisted. */
function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

/**
 * Coarse "time ago" label. The orchestrator's score data lags real
 * play by a couple of minutes, so the `ts` we capture at detection is
 * already 1–5 minutes after the shot actually happened — second-level
 * precision would claim accuracy we don't have. Bucket to "just now" /
 * "few min ago" / "Nm ago" / "Nh ago".
 */
/** Format decimal odds as fractional ("5.0" → "4/1"). */
function fractionalOdds(decimal: number): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return "—";
  const v = decimal - 1;
  if (v >= 1) {
    return `${Math.round(v)}/1`;
  }
  // Sub-evens — render to one decimal e.g. "8/11" or "4/9" require
  // a denominator search; for compactness just say e.g. "1/2".
  const inv = Math.round(1 / v);
  return `1/${inv}`;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 120) return "just now";
  const m = Math.floor(s / 60);
  if (m < 6) return "few min ago";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function FeedClient() {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState(false);
  const [myReactions, setMyReactions] = useState<
    Record<string, "up" | "down">
  >({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>(
    {},
  );
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [filterMode, setFilterMode] = useState<"all" | "following">("all");
  const [follows, setFollowsState] = useState<string[]>([]);
  const [view, setView] = useState<"feed" | "leaderboard">("feed");

  const authorKey = useRef<string>("");
  const seenBursts = useRef<Set<string>>(new Set());

  useEffect(() => {
    authorKey.current = getAuthorKey();
  }, []);

  // Track followed players — re-read whenever a FollowButton fires the event.
  useEffect(() => {
    const sync = () => setFollowsState(getFollows());
    sync();
    window.addEventListener("pardle-follows-changed", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("pardle-follows-changed", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // ── Floating emoji bursts ──────────────────────────────────────
  const spawnFloater = useCallback((emoji: string) => {
    const key = `f${Math.random().toString(36).slice(2)}${Date.now()}`;
    const xPct = 8 + Math.random() * 84; // keep away from the very edges
    setFloaters((f) => [...f, { key, emoji, xPct }]);
    setTimeout(() => {
      setFloaters((f) => f.filter((x) => x.key !== key));
    }, FLOATER_LIFETIME_MS);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?v=${authorKey.current}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as FeedResponse;
      setData(json);
      setError(false);

      // Animate any bursts we haven't shown yet (others' taps).
      for (const b of json.bursts ?? []) {
        if (!seenBursts.current.has(b.id)) {
          seenBursts.current.add(b.id);
          // Only animate genuinely recent ones — avoids a flood when
          // first opening the page mid-tournament.
          if (Date.now() - b.ts < 12_000) {
            spawnFloater(b.emoji);
          }
        }
      }
    } catch {
      setError(true);
    }
  }, [spawnFloater]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function sendBurst(emoji: string) {
    spawnFloater(emoji); // optimistic — instant feedback for the tapper
    try {
      await fetch("/api/feed/burst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji, visitorId: authorKey.current }),
      });
    } catch {
      /* the floater still showed; no-op on failure */
    }
  }

  async function sendReaction(eventId: string, dir: "up" | "down") {
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
        body: JSON.stringify({ eventId, dir, authorKey: authorKey.current }),
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
  const followSet = new Set(follows);
  const visibleRows =
    filterMode === "following"
      ? data.rows.filter((r) => followSet.has(r.event.playerId))
      : data.rows;

  return (
    <section className="feed-wrap">
      <div className="feed-header-row">
        <h2 className="feed-tournament-name">{data.tournament.name}</h2>
        <div className="feed-header-meta">
          {data.seenToday > 0 && (
            <span className="feed-watching">
              👀 {data.seenToday.toLocaleString()} here today
            </span>
          )}
          <span className="feed-live-dot">
            <span className="feed-live-pulse" /> LIVE
          </span>
        </div>
      </div>

      <PlayerSearch players={data.playerIndex ?? []} />

      <CatchMeUp rows={data.rows ?? []} />

      <nav className="feed-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "feed"}
          className={`feed-tab ${view === "feed" ? "feed-tab-on" : ""}`}
          onClick={() => setView("feed")}
        >
          Live feed
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "leaderboard"}
          className={`feed-tab ${view === "leaderboard" ? "feed-tab-on" : ""}`}
          onClick={() => setView("leaderboard")}
        >
          Leaderboard
        </button>
      </nav>

      {view === "leaderboard" ? (
        <LeaderboardPanel rows={data.leaderboard ?? []} mode="tab" />
      ) : (
        <>
      <Reel
        title="⛳ Shots of the day"
        rows={data.bestReel ?? []}
        myReactions={myReactions}
        onReact={sendReaction}
      />

      <Reel
        title="💀 Worst of the day"
        rows={data.worstReel ?? []}
        myReactions={myReactions}
        onReact={sendReaction}
      />

      <BetTracker
        players={data.playerIndex ?? []}
        currentOdds={data.currentOdds ?? {}}
        playerRoundStates={data.playerRoundStates ?? {}}
      />

      <div className="feed-filter-row">
        <button
          type="button"
          className={`feed-filter-btn ${filterMode === "all" ? "feed-filter-on" : ""}`}
          onClick={() => setFilterMode("all")}
        >
          All shots
        </button>
        <button
          type="button"
          className={`feed-filter-btn ${filterMode === "following" ? "feed-filter-on" : ""}`}
          onClick={() => setFilterMode("following")}
        >
          ★ Following {follows.length > 0 ? `(${follows.length})` : ""}
        </button>
      </div>

      {data.rows.length === 0 ? (
        <p className="feed-empty">
          Feed is warming up — first scores will appear here within a
          minute or two of the groups going out.
        </p>
      ) : filterMode === "following" && visibleRows.length === 0 ? (
        <p className="feed-empty">
          {follows.length === 0
            ? "You're not following anyone yet. Tap a player's name to open their card and follow them."
            : "No shots from the players you follow yet — they'll show here."}
        </p>
      ) : (
        <ul className="feed-list">
          {visibleRows.map(({ event, reactions, commentCount }) => {
            const mine = myReactions[event.id];
            const isOpen = expanded === event.id;
            const count = commentCounts[event.id] ?? commentCount;
            return (
              <li
                key={event.id}
                className={`feed-row-wrap ${isOpen ? "feed-row-wrap-open" : ""}`}
              >
                <div
                  className={`feed-row ${
                    event.type === "shot"
                      ? `feed-row-shot${event.highlight ? " feed-row-shot-good" : ""}${event.lowlight ? " feed-row-shot-bad" : ""}`
                      : `feed-row-${event.result ?? "other"}`
                  }`}
                >
                  <span className="feed-emoji" aria-hidden="true">
                    {event.emoji}
                  </span>
                  <Link
                    href={`/live/player/${event.playerId}`}
                    className="feed-body feed-body-link"
                  >
                    <p className="feed-headline">{event.headline}</p>
                    {event.tags && event.tags.length > 0 && (
                      <p className="feed-tags">
                        {event.tags.map((t) => (
                          <span key={t} className="feed-tag">
                            {t}
                          </span>
                        ))}
                        {event.oddsBefore && event.oddsAfter && (
                          <span
                            className={`feed-tag feed-tag-odds ${
                              event.oddsAfter < event.oddsBefore
                                ? "feed-tag-odds-shorten"
                                : "feed-tag-odds-drift"
                            }`}
                            title="Win-market odds shift"
                          >
                            odds {fractionalOdds(event.oddsBefore)} →{" "}
                            {fractionalOdds(event.oddsAfter)}
                          </span>
                        )}
                      </p>
                    )}
                    {!event.tags?.length &&
                      event.oddsBefore &&
                      event.oddsAfter && (
                        <p className="feed-tags">
                          <span
                            className={`feed-tag feed-tag-odds ${
                              event.oddsAfter < event.oddsBefore
                                ? "feed-tag-odds-shorten"
                                : "feed-tag-odds-drift"
                            }`}
                            title="Win-market odds shift"
                          >
                            odds {fractionalOdds(event.oddsBefore)} →{" "}
                            {fractionalOdds(event.oddsAfter)}
                          </span>
                        </p>
                      )}
                    <p className="feed-meta">
                      R{event.round} · {timeAgo(event.ts)} · view card →
                    </p>
                  </Link>
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
                    <button
                      type="button"
                      className={`feed-react ${isOpen ? "feed-react-on" : ""}`}
                      onClick={() => setExpanded(isOpen ? null : event.id)}
                      aria-label="Comments"
                    >
                      💬 {count > 0 ? count : ""}
                    </button>
                    <FollowButton
                      playerId={event.playerId}
                      playerName={event.playerName}
                      variant="icon"
                    />
                  </div>
                </div>
                {isOpen && (
                  <CommentThread
                    eventId={event.id}
                    authorKey={authorKey.current}
                    onCountChange={(c) =>
                      setCommentCounts((m) => ({ ...m, [event.id]: c }))
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="feed-footnote">
        Live PGA Tour scoring · auto-refreshes every 15s · usually within
        ~30s of the course
      </p>
        </>
      )}

      {/* Floating-emoji overlay — fixed so bursts rise over the whole feed */}
      <div className="feed-floater-layer" aria-hidden="true">
        {floaters.map((f) => (
          <span
            key={f.key}
            className="feed-floater"
            style={{ left: `${f.xPct}%` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      {/* Burst reaction bar — sticky at the bottom */}
      <div className="feed-burst-bar">
        {BURST_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className="feed-burst-btn"
            onClick={() => sendBurst(e)}
            aria-label={`React ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </section>
  );
}
