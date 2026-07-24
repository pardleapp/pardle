"use client";

/**
 * v4 primary view — a live leaderboard with per-player shot updates,
 * per-round SG stats, and per-SHOT social affordances (reactions,
 * comment counts, row expansion for recent-shot history).
 *
 * Reactions target the specific event id (McIlroy's 380y drive is a
 * separate reactable object from his next putt), so as the row's
 * latest event ticks over, its reactions reset — reactions belong to
 * the shot, not the row.
 *
 * Data pipeline: single 3 s poll of /api/live-leaderboard which
 * server-side joins Pardle leaderboard + latest 5 events per player
 * + DataGolf per-round SG + reactions/comment-counts for every event.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import LeaderRow from "./LeaderRow";
import { useFollowedPlayers } from "../useFollowedPlayers";
import { readBets, type TrackedBet } from "../bet-shared";
import { headlineImpactForEvent, type EventBetImpact } from "../bet-impact";
import type { LeaderboardResponse } from "@/app/api/live-leaderboard/route";

const POLL_MS = 3_000;
const POLL_MS_HIDDEN = 30_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_visitor_v1";
const MINE_STORAGE = "pardle_emoji_mine_v1";
/** Cap the number of event IDs kept in the localStorage "mine" map.
 *  Prevents unbounded growth over months of reactions. Oldest keys
 *  get evicted first. */
const MINE_CAP = 500;

type Filter = "all" | "mine";

/** Persistent visitor id — reused by /api/feed/burst for rate-limiting
 *  and by /api/feed/react as authorKey. Not secure; reactions are
 *  low-stakes. */
function ensureAuthorKey(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (existing) return existing;
  const fresh = `v${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  window.localStorage.setItem(AUTHOR_KEY_STORAGE, fresh);
  return fresh;
}

/** Load the "which emojis have I reacted with on which events" map
 *  from localStorage. Bounded to prevent unbounded growth. */
function loadMineMap(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MINE_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function persistMineMap(m: Record<string, string[]>): void {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(m);
    if (keys.length > MINE_CAP) {
      // Sort by ts embedded in event IDs (mb, ev — most start with a
      // base36 timestamp). Newest ids sort last alphabetically for our
      // scheme. Keep the newest MINE_CAP.
      keys.sort();
      const trimmed: Record<string, string[]> = {};
      for (const k of keys.slice(-MINE_CAP)) trimmed[k] = m[k];
      m = trimmed;
    }
    window.localStorage.setItem(MINE_STORAGE, JSON.stringify(m));
  } catch {
    /* quota or serialisation failure — reactions are ephemeral, ok to drop */
  }
}

interface Floater {
  key: string;
  emoji: string;
  xPct: number;
}

export default function LeaderboardFeed() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  /** Per-user emoji reactions this visitor has cast. Persisted in
   *  localStorage; merged with server-side global counts on render. */
  const [mineMap, setMineMap] = useState<Record<string, string[]>>({});
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const authorKey = useRef<string>("");
  const { followed } = useFollowedPlayers();

  useEffect(() => {
    authorKey.current = ensureAuthorKey();
    setBets(readBets());
    setMineMap(loadMineMap());
    const sync = () => setBets(readBets());
    const syncMine = () => setMineMap(loadMineMap());
    window.addEventListener("focus", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("storage", syncMine);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("storage", syncMine);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/live-leaderboard", { cache: "no-store" });
      const json = (await res.json()) as LeaderboardResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, []);

  useEffect(() => {
    load();
    let intervalMs = document.hidden ? POLL_MS_HIDDEN : POLL_MS;
    let id = window.setInterval(load, intervalMs);
    const onVis = () => {
      window.clearInterval(id);
      intervalMs = document.hidden ? POLL_MS_HIDDEN : POLL_MS;
      id = window.setInterval(load, intervalMs);
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const toggleExpanded = useCallback((playerId: string) => {
    setExpandedIds((cur) => {
      const next = new Set(cur);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  /** Emoji reaction on a specific event. Toggles the visitor's local
   *  mine list, POSTs an add/remove delta to /api/feed/emoji-react to
   *  update the global count, and fires an ephemeral floater. Next
   *  poll of /api/live-leaderboard rehydrates the global count so
   *  other viewers' reactions land automatically. */
  const react = useCallback(
    (eventId: string, emoji: string) => {
      let dir: "add" | "remove" = "add";
      setMineMap((cur) => {
        const list = cur[eventId] ?? [];
        const had = list.includes(emoji);
        dir = had ? "remove" : "add";
        const nextList = had
          ? list.filter((e) => e !== emoji)
          : [...list, emoji];
        const next: Record<string, string[]> = { ...cur };
        if (nextList.length === 0) delete next[eventId];
        else next[eventId] = nextList;
        persistMineMap(next);
        return next;
      });
      // Fire a floater on this row (visual burst)
      const key = `f${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setFloaters((f) => [...f, { key, emoji, xPct: 40 + Math.random() * 20 }]);
      window.setTimeout(() => {
        setFloaters((f) => f.filter((x) => x.key !== key));
      }, 1600);
      // Persist global count + fire an ambient floater for other
      // viewers. Both are fire-and-forget; local state is what
      // paints immediately.
      void fetch("/api/feed/emoji-react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          emoji,
          dir,
          visitorId: authorKey.current,
        }),
      }).catch(() => {});
      if (dir === "add") {
        void fetch("/api/feed/burst", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji, visitorId: authorKey.current }),
        }).catch(() => {});
      }
    },
    [],
  );

  const mineIds = new Set<string>(followed);
  for (const b of bets) {
    if (b.settledAt != null) continue;
    const pid = (b as { playerId?: string }).playerId;
    if (typeof pid === "string" && pid) mineIds.add(pid);
  }
  const canShowMine = mineIds.size > 0;
  const rows = data?.rows ?? [];
  const shown =
    filter === "mine"
      ? rows.filter((r) => mineIds.has(r.playerId))
      : rows;

  // Per-row bet impact — surfaces "your outright ↑ 4pp · +£1.20" inline
  // in the LATEST column whenever the row's latest event materially
  // moved one of the user's active bets. Direct outright + top-finish
  // work from FeedEvent fields alone. Round-score impact uses the same
  // per-hole averages the bet detail page + tee-time chart use — the
  // server now bakes them onto the response.
  const impactByPlayer = new Map<string, EventBetImpact>();
  if (bets.length > 0) {
    const holeAvgToParByRound = data?.holeAvgToParByRound;
    const roundParByRound = data?.roundParByRound;
    for (const r of rows) {
      if (!r.latestEvent) continue;
      const imp = headlineImpactForEvent(r.latestEvent, bets, {
        currentOdds: {},
        leaderboard: [],
        holeAvgToParByRound,
        roundParByRound,
      });
      if (imp) impactByPlayer.set(r.playerId, imp);
    }
  }

  return (
    <section className="feed-wrap v4-theme pv-theme tchat-content-pad feed-v4">
      <div className="v4-header">
        <div className="v4-header-title">
          <span className="v4-live-dot" aria-label="Live" />
          <span className="v4-header-name">
            {data?.tournament?.name ?? "Live leaderboard"}
          </span>
          {data?.activeRound ? (
            <span className="v4-header-round">R{data.activeRound}</span>
          ) : null}
        </div>
        <div className="v4-header-tabs" role="tablist" aria-label="Filter">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={`v4-header-tab${filter === "all" ? " v4-header-tab-on" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {canShowMine && (
            <button
              type="button"
              role="tab"
              aria-selected={filter === "mine"}
              className={`v4-header-tab${filter === "mine" ? " v4-header-tab-on" : ""}`}
              onClick={() => setFilter("mine")}
            >
              Mine
            </button>
          )}
        </div>
      </div>

      {error || (data && !data.ok) ? (
        <p className="v4-empty">Couldn&apos;t load leaderboard. Retrying…</p>
      ) : !data ? (
        <p className="v4-empty">Loading leaderboard…</p>
      ) : shown.length === 0 ? (
        <p className="v4-empty">
          {filter === "mine"
            ? "None of your players are in this field yet."
            : "No players yet."}
        </p>
      ) : (
        <div className="v4-table" role="table">
          <div className="v4-headings" role="row">
            <span className="v4-h-pos">POS</span>
            <span />
            <span className="v4-h-name">PLAYER</span>
            <span className="v4-h-total">TODAY</span>
            <span className="v4-h-thru">THRU</span>
            <span className="v4-h-latest">LATEST</span>
            <span className="v4-h-sg" title="SG: off the tee">OTT</span>
            <span className="v4-h-sg" title="SG: approach">APP</span>
            <span className="v4-h-sg" title="SG: around the green">ARG</span>
            <span className="v4-h-sg" title="SG: putting">PUTT</span>
            <span className="v4-h-sg" title="SG: total">TOT</span>
          </div>
          {shown.map((r) => (
            <LeaderRow
              key={r.playerId}
              row={r}
              isMine={mineIds.has(r.playerId)}
              social={data.social ?? {}}
              mineMap={mineMap}
              expanded={expandedIds.has(r.playerId)}
              onToggleExpanded={() => toggleExpanded(r.playerId)}
              onReact={react}
              authorKey={authorKey.current}
              betImpact={impactByPlayer.get(r.playerId) ?? null}
            />
          ))}
        </div>
      )}

      <p className="v4-footnote">
        Position + today via PGA Tour · SG this round · click any row for the last few shots · react to any shot with 🔥 😬 🎯
      </p>

      {/* Global emoji floater layer — bursts on reactions rise across
          the feed as ambient "the room is watching" energy. */}
      <div className="v4-floater-layer" aria-hidden="true">
        {floaters.map((f) => (
          <span
            key={f.key}
            className="v4-floater"
            style={{ left: `${f.xPct}%` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>
    </section>
  );
}
