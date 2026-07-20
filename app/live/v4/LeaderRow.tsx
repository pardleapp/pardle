"use client";

/**
 * One row in the v4 leaderboard-with-live-updates view. Same skeleton
 * for every player so the eye scans down a clean column grid, but the
 * "latest" column carries whatever that player just did (birdie, drive,
 * putt, bunker escape) and the SG columns show how they're playing
 * this round.
 *
 * Live pulse: rows whose latest event landed within the last 60 s
 * flash a green dot next to the event — draws the eye to whoever
 * just did something without shifting the row order.
 */

import { useEffect, useState } from "react";
import type { FeedEvent } from "@/lib/feed/types";
import PlayerAvatar from "../PlayerAvatar";
import type { LeaderboardRow } from "@/app/api/live-leaderboard/route";

interface Props {
  row: LeaderboardRow;
  isMine: boolean;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function holeLabel(n: number | undefined): string {
  if (typeof n !== "number") return "";
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${s}`;
}

function formatSg(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v > 0.005 ? "+" : v < -0.005 ? "−" : "";
  return `${sign}${abs.toFixed(1)}`;
}

function sgClass(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (v > 0.2) return "v4-sg-plus";
  if (v < -0.2) return "v4-sg-minus";
  return "";
}

function totalClass(total: string): string {
  if (!total || total === "E" || total === "—") return "v4-total-even";
  if (total.startsWith("-") || total.startsWith("−")) return "v4-total-under";
  if (total.startsWith("+")) return "v4-total-over";
  return "";
}

function formatEventTime(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

/** Very compact one-line event summary — this drops into a column,
 *  not a card. Keep it small and monospace where possible. */
function eventVerb(ev: FeedEvent): { tag: string; kind: string; text: string; anchor: string } {
  const h = (ev.headline ?? "").toLowerCase();
  const hole = holeLabel(ev.hole);
  // Ace / eagle / birdie / bogey / etc.
  if (ev.ace) return { tag: "ACE", kind: "ace", text: `Ace ${hole}`, anchor: "" };
  if (ev.result === "albatross") return { tag: "ALB", kind: "eagle", text: `Alb ${hole}`, anchor: "" };
  if (ev.result === "eagle") return { tag: "EAGLE", kind: "eagle", text: `Eagle ${hole}`, anchor: "" };
  if (ev.result === "birdie") return { tag: "BIRDIE", kind: "birdie", text: `Birdie ${hole}`, anchor: "" };
  if (ev.result === "bogey") return { tag: "BOGEY", kind: "bogey", text: `Bogey ${hole}`, anchor: "" };
  if (ev.result === "double") return { tag: "DBL", kind: "double", text: `Double ${hole}`, anchor: "" };
  if (ev.result === "triple-plus") return { tag: "TRIP+", kind: "double", text: `Blow-up ${hole}`, anchor: "" };
  // Shot event — check the headline verb.
  if (ev.type === "shot") {
    if (/\bputts?\b/.test(h)) {
      const anchor =
        typeof ev.imgShotDistance === "number" && ev.imgShotDistanceUnit === "ft"
          ? `${Math.round(ev.imgShotDistance)}ft`
          : typeof ev.proximityInches === "number"
            ? `${Math.round(ev.proximityInches / 12)}ft`
            : "";
      return { tag: "PUTT", kind: "shot", text: `Putts ${hole}`, anchor };
    }
    if (/\b(bunker|sand)\b/.test(h)) {
      return { tag: "SAND", kind: "shot", text: `Sand ${hole}`, anchor: "" };
    }
    if (/\bapproach(es|ing)?\b/.test(h)) {
      const anchor =
        typeof ev.proximityInches === "number"
          ? `${Math.round(ev.proximityInches / 12)}ft`
          : "";
      return { tag: "APPR", kind: "shot", text: `Approach ${hole}`, anchor };
    }
    if (typeof ev.imgShotDistance === "number" && ev.imgShotDistanceUnit === "yds") {
      return { tag: "DRIVE", kind: "shot", text: `Drive ${hole}`, anchor: `${Math.round(ev.imgShotDistance)}y` };
    }
    return { tag: "SHOT", kind: "shot", text: `Shot ${hole}`, anchor: "" };
  }
  if (ev.type === "position") {
    return { tag: "MOVE", kind: "misc", text: ev.headline ?? "", anchor: "" };
  }
  return { tag: (ev.type ?? "").toUpperCase(), kind: "misc", text: ev.headline ?? "", anchor: "" };
}

export default function LeaderRow({ row, isMine }: Props) {
  // Ticks every 20s so the "1m ago" freshness updates without a
  // full re-render from the parent.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  const ev = row.latestEvent;
  const eventFresh = ev != null && now - ev.ts < 60_000;
  const verb = ev ? eventVerb(ev) : null;
  const state = (row.playerState ?? "").toUpperCase();
  const isCut = state === "CUT" || state === "MC" || state === "WD" || state === "DQ";

  return (
    <div
      className={`v4-row${isMine ? " v4-row-mine" : ""}${isCut ? " v4-row-cut" : ""}${eventFresh ? " v4-row-fresh" : ""}`}
    >
      <span className="v4-pos">{row.position}</span>
      <span className="v4-avatar">
        <PlayerAvatar playerId={row.playerId} playerName={row.playerName} size="sm" />
      </span>
      <span className="v4-name">
        <span className="v4-name-primary">{shortName(row.playerName)}</span>
        {isCut && <span className="v4-name-cut">{state}</span>}
      </span>
      <span className={`v4-total ${totalClass(row.total)}`}>{row.total?.replace(/^-/, "−") || "—"}</span>
      <span className="v4-thru">{row.thru || "—"}</span>
      <span className="v4-latest">
        {verb ? (
          <>
            <span
              className={`v4-latest-pulse${eventFresh ? " v4-latest-pulse-on" : ""}`}
              aria-hidden="true"
            />
            <span className={`v4-latest-tag v4-latest-tag-${verb.kind}`}>{verb.tag}</span>
            <span className="v4-latest-text">{verb.text}</span>
            {verb.anchor && <span className="v4-latest-anchor">{verb.anchor}</span>}
            <span className="v4-latest-time">{ev ? formatEventTime(ev.ts, now) : ""}</span>
          </>
        ) : (
          <span className="v4-latest-empty">—</span>
        )}
      </span>
      <span className={`v4-sg ${sgClass(row.sg?.ott ?? null)}`}>{formatSg(row.sg?.ott ?? null)}</span>
      <span className={`v4-sg ${sgClass(row.sg?.app ?? null)}`}>{formatSg(row.sg?.app ?? null)}</span>
      <span className={`v4-sg ${sgClass(row.sg?.arg ?? null)}`}>{formatSg(row.sg?.arg ?? null)}</span>
      <span className={`v4-sg ${sgClass(row.sg?.putt ?? null)}`}>{formatSg(row.sg?.putt ?? null)}</span>
      <span className={`v4-sg v4-sg-total ${sgClass(row.sg?.total ?? null)}`}>
        {formatSg(row.sg?.total ?? null)}
      </span>
    </div>
  );
}
