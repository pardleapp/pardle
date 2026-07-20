"use client";

/**
 * v4 primary view — a live leaderboard with per-player shot updates
 * and round SG stats. The bet-native way to watch a tournament: see
 * position, current activity, and who's playing well by shot type
 * all in one scan-friendly grid.
 *
 * Data pipeline: single 3 s poll of /api/live-leaderboard, which
 * server-side joins Pardle's cached leaderboard + latest event per
 * player + DataGolf per-round SG. Client just renders the merged
 * response — no client-side joins, no per-row fetches.
 */

import { useCallback, useEffect, useState } from "react";
import LeaderRow from "./LeaderRow";
import { useFollowedPlayers } from "../useFollowedPlayers";
import { readBets, type TrackedBet } from "../bet-shared";
import type { LeaderboardResponse } from "@/app/api/live-leaderboard/route";

const POLL_MS = 3_000;
const POLL_MS_HIDDEN = 30_000;

type Filter = "all" | "mine";

export default function LeaderboardFeed() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const { followed } = useFollowedPlayers();

  useEffect(() => {
    setBets(readBets());
    const sync = () => setBets(readBets());
    window.addEventListener("focus", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("storage", sync);
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
          {/* Column header row — muted labels for scan orientation.
              Sticky under the header so the row grid stays legible when
              scrolling a full field. */}
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
            <LeaderRow key={r.playerId} row={r} isMine={mineIds.has(r.playerId)} />
          ))}
        </div>
      )}

      <p className="v4-footnote">
        Position + today via PGA Tour · SG this round · latest event streams in as it happens.
      </p>
    </section>
  );
}
