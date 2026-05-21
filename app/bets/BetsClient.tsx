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

  useEffect(() => {
    authorKey.current = getAuthorKey();
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
    if (raw === "american" || raw === "fractional" || raw === "decimal") {
      setOddsFormat(raw);
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
          Couldn&apos;t load your bets. Retrying automatically.
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="v4-theme" style={{ padding: 14 }}>
        <p className="feed-empty">Loading your bets…</p>
      </section>
    );
  }

  return (
    <section className="v4-theme bets-page">
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
