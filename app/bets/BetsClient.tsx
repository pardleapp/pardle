"use client";

/**
 * BetsClient — dedicated bet-management surface for /bets.
 *
 * Polls /api/feed for the same currentOdds / projections / top-finish
 * / recent-form / hand-status data the live feed uses, then renders
 * the BetTracker management UI. No feed events, no leaderboard, no
 * reels — bets only.
 *
 * Polling cadence matches /live so the chart values tick at the same
 * pace as a user watching the feed in another tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import {
  DEFAULT_ODDS_FORMAT,
  ODDS_FORMAT_STORAGE_KEY,
  type OddsFormat,
} from "@/lib/odds-format";
import BetTracker from "../live/BetTracker";
import type {
  PlayerRoundState,
  TopFinishProbs,
  TournamentProjection,
} from "../live/bet-shared";

const REFRESH_MS = 6_000;
const REFRESH_MS_HIDDEN = 30_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_author";

interface BetsResponse {
  tournament: { id: string; name: string; isLive: boolean } | null;
  playerIndex?: CachedLeaderboardRow[];
  currentOdds?: Record<string, number>;
  playerRoundStates?: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
  topFinishCurrent?: Record<string, TopFinishProbs>;
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
  handStatus?: Record<string, "hot" | "cold">;
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

export default function BetsClient() {
  const [data, setData] = useState<BetsResponse | null>(null);
  const [error, setError] = useState(false);
  const [oddsFormat, setOddsFormat] =
    useState<OddsFormat>(DEFAULT_ODDS_FORMAT);
  const authorKey = useRef("");

  // Stamp html.pv-theme-body while /bets is mounted so the body
  // background goes warm paper and our .pv-theme overrides apply
  // across the brand bar + nav. Mirrors what FeedClient does for
  // /live. Cleans up on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  useEffect(() => {
    authorKey.current = getAuthorKey();
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
    if (raw === "american" || raw === "fractional" || raw === "decimal") {
      setOddsFormat(raw);
    }
    // Cached-first: show last response instantly while the live fetch
    // runs in the background.
    try {
      const cacheRaw = window.localStorage.getItem("pardle_bets_cache_v1");
      if (cacheRaw) {
        const env = JSON.parse(cacheRaw) as {
          ts: number;
          data: BetsResponse;
        };
        if (env?.ts && env.data && Date.now() - env.ts < 60 * 60 * 1000) {
          setData(env.data);
        }
      }
    } catch {
      // silent
    }
  }, []);

  const pickOddsFormat = useCallback((fmt: OddsFormat) => {
    setOddsFormat(fmt);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ODDS_FORMAT_STORAGE_KEY, fmt);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?v=${authorKey.current}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as BetsResponse;
      setData(json);
      setError(false);
      try {
        window.localStorage.setItem(
          "pardle_bets_cache_v1",
          JSON.stringify({ ts: Date.now(), data: json }),
        );
      } catch {
        // silent
      }
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
      <section className="v4-theme pv-theme" style={{ padding: 14 }}>
        <p className="feed-empty">
          Couldn&apos;t load your bets. Retrying automatically.
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="v4-theme pv-theme bets-page" aria-busy="true">
        <div className="skeleton-line skeleton-line-title" />
        <ul className="lb-skeleton-list" aria-label="Loading bets">
          {[0, 1, 2].map((i) => (
            <li key={i} className="lb-skeleton-row">
              <div className="skeleton-avatar lb-skeleton-avatar" />
              <div className="skeleton-line lb-skeleton-name" />
              <div className="skeleton-line lb-skeleton-total" />
              <div className="skeleton-line lb-skeleton-thru" />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="v4-theme pv-theme bets-page">
      {data.tournament && (
        <p className="bets-page-tournament">
          {data.tournament.isLive ? "Live · " : "Next up · "}
          {data.tournament.name}
        </p>
      )}
      <BetTracker
        players={data.playerIndex ?? []}
        currentOdds={data.currentOdds ?? {}}
        playerRoundStates={data.playerRoundStates ?? {}}
        tournamentProjections={data.tournamentProjections ?? {}}
        topFinishCurrent={data.topFinishCurrent}
        recentForm={data.recentForm}
        handStatus={data.handStatus}
        oddsFormat={oddsFormat}
        onPickOddsFormat={pickOddsFormat}
      />
    </section>
  );
}
