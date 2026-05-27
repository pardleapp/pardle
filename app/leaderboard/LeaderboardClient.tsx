"use client";

/**
 * LeaderboardClient — dedicated leaderboard surface at /leaderboard.
 *
 * Polls /api/feed for the same leaderboard + handStatus + recentForm
 * data the live feed and bets pages use, then renders LeaderboardPanel
 * in "tab" mode (one row per player, full visible list).
 *
 * Cached-first + skeleton loading pattern shared with FeedClient:
 *   - Last response written to localStorage; next visit shows it
 *     instantly while a fresh fetch runs in the background.
 *   - First-time visit sees a ghost leaderboard skeleton instead of
 *     the old plain "Loading…" text.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import LeaderboardPanel from "../live/LeaderboardPanel";

const REFRESH_MS = 6_000;
const REFRESH_MS_HIDDEN = 30_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_author";
const CACHE_STORAGE = "pardle_lb_cache_v1";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface LbResponse {
  tournament: { id: string; name: string; isLive: boolean } | null;
  leaderboard?: CachedLeaderboardRow[];
  handStatus?: Record<string, "hot" | "cold">;
  recentForm?: Record<
    string,
    {
      name: string;
      recent: Array<{
        season: number;
        tournament: string;
        finishText: string;
        finishPos: number | null;
        madeCut: boolean;
      }>;
    }
  >;
}

interface CacheEnvelope {
  ts: number;
  data: LbResponse;
}

function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

function readCache(): LbResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    if (!env?.ts || !env.data) return null;
    if (Date.now() - env.ts > CACHE_TTL_MS) return null;
    return env.data;
  } catch {
    return null;
  }
}

function writeCache(data: LbResponse): void {
  if (typeof window === "undefined") return;
  try {
    const env: CacheEnvelope = { ts: Date.now(), data };
    window.localStorage.setItem(CACHE_STORAGE, JSON.stringify(env));
  } catch {
    // localStorage full / disabled — silent.
  }
}

export default function LeaderboardClient() {
  const [data, setData] = useState<LbResponse | null>(null);
  const [error, setError] = useState(false);
  const authorKey = useRef("");

  useEffect(() => {
    authorKey.current = getAuthorKey();
    // Cached-first: show last response instantly while the live
    // fetch runs in the background.
    const cached = readCache();
    if (cached) setData(cached);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/feed?v=${authorKey.current}&prefer=last-completed`,
        {
          cache: "no-store",
        },
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as LbResponse;
      setData(json);
      setError(false);
      writeCache(json);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const isHidden = () =>
      typeof document !== "undefined" && document.hidden;
    const start = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(load, isHidden() ? REFRESH_MS_HIDDEN : REFRESH_MS);
    };
    start();
    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  if (error && !data) {
    return (
      <section className="v4-theme" style={{ padding: 14 }}>
        <p className="feed-empty">
          Couldn&apos;t load the leaderboard. Retrying automatically.
        </p>
      </section>
    );
  }
  if (!data) {
    return <LeaderboardSkeleton />;
  }
  if (!data.tournament || !data.leaderboard?.length) {
    return (
      <section className="v4-theme lb-page">
        <div className="lb-offweek">
          <p className="lb-offweek-eyebrow">No live event</p>
          <h2 className="lb-offweek-title">
            {data.tournament
              ? `${data.tournament.name} hasn't teed off yet`
              : "The PGA Tour is dark this week"}
          </h2>
          <p className="lb-offweek-blurb">
            Live leaderboard fires up the moment the first group hits
            the course. In the meantime, here&apos;s where to land.
          </p>
          <div className="lb-offweek-ctas">
            <Link href="/" className="lb-offweek-cta">
              See the feed home →
            </Link>
            <Link href="/players" className="lb-offweek-cta-quiet">
              Player statistics
            </Link>
            <Link href="/sharp" className="lb-offweek-cta-quiet">
              Sharp Score
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="v4-theme lb-page">
      <p className="lb-page-tournament">
        {data.tournament.isLive ? "Live · " : "Final · "}
        {data.tournament.name}
      </p>
      <LeaderboardPanel
        rows={data.leaderboard}
        mode="tab"
        recentForm={data.recentForm}
        handStatus={data.handStatus}
      />
    </section>
  );
}

/**
 * Ghost leaderboard rows shown during the first cold load when no
 * cached data exists. Shimmer reuses the same animation as the
 * feed skeleton so the perceived-load language stays consistent.
 */
function LeaderboardSkeleton() {
  return (
    <section className="v4-theme lb-page" aria-busy="true">
      <div className="skeleton-line skeleton-line-title" />
      <ul
        className="lb-skeleton-list"
        aria-label="Loading leaderboard"
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i} className="lb-skeleton-row">
            <div className="skeleton-line lb-skeleton-pos" />
            <div className="skeleton-avatar lb-skeleton-avatar" />
            <div className="skeleton-line lb-skeleton-name" />
            <div className="lb-skeleton-score">
              <div className="skeleton-line lb-skeleton-total" />
              <div className="skeleton-line lb-skeleton-thru" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
