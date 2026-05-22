"use client";

/**
 * LeaderboardClient — dedicated leaderboard surface at /leaderboard.
 *
 * Polls /api/feed for the same leaderboard + handStatus + recentForm
 * data the live feed and bets pages use, then renders LeaderboardPanel
 * in "tab" mode (one row per player, full visible list).
 *
 * Lives at /leaderboard so it can be a peer to the Live feed / Bets /
 * Games tabs in MainNav rather than a sub-toggle inside /live.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import LeaderboardPanel from "../live/LeaderboardPanel";

const REFRESH_MS = 6_000;
const REFRESH_MS_HIDDEN = 30_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_author";

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

function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

export default function LeaderboardClient() {
  const [data, setData] = useState<LbResponse | null>(null);
  const [error, setError] = useState(false);
  const authorKey = useRef("");

  useEffect(() => {
    authorKey.current = getAuthorKey();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?v=${authorKey.current}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as LbResponse;
      setData(json);
      setError(false);
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
    return (
      <section className="v4-theme" style={{ padding: 14 }}>
        <p className="feed-empty">Loading…</p>
      </section>
    );
  }
  if (!data.tournament || !data.leaderboard?.length) {
    return (
      <section className="v4-theme" style={{ padding: 14 }}>
        <p className="feed-empty">
          {data.tournament
            ? `${data.tournament.name} hasn't teed off yet.`
            : "No tournament on the schedule right now."}
        </p>
      </section>
    );
  }

  return (
    <section className="v4-theme lb-page">
      <p className="lb-page-tournament">
        {data.tournament.isLive ? "Live · " : ""}
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
