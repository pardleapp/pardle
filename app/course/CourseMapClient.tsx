"use client";

/**
 * CourseMapClient — the actual 18-hole grid view. Polls /api/course
 * every 6s during live play (30s when the tab's hidden) and lays out
 * every active player at their current hole as a small avatar chip.
 *
 * Layout: two rows of 9 holes each (front nine on top, back nine
 * underneath), each hole card containing its number, par, and the
 * stack of players currently on that hole. Finished / out / not-yet-
 * teed-off players get small dedicated sections below the grid so
 * the main view stays "live action only".
 *
 * Tap a player avatar → /live/player/[id], same as everywhere else.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { abbreviateName } from "@/lib/text/abbreviate";
import PlayerAvatar from "../live/PlayerAvatar";

const REFRESH_MS = 6_000;
const REFRESH_MS_HIDDEN = 30_000;

interface Hole {
  number: number;
  par: number | null;
}

interface CoursePlayer {
  playerId: string;
  displayName: string;
  currentHole: number | null;
  status: "active" | "finished" | "not-started" | "out";
  total: string;
  thru: string;
  position: string;
}

interface CourseResponse {
  tournament: {
    id: string;
    name: string;
    currentRound: number;
    isLive: boolean;
  } | null;
  holes: Hole[];
  players: CoursePlayer[];
}

/** Parse "-3" / "E" / "+5" overall-to-par into a numeric score for
 *  colour-tone selection on the avatar's border. */
function toneFromTotal(total: string): "up" | "down" | "even" {
  if (!total) return "even";
  const t = total.trim();
  if (t === "E" || t === "0") return "even";
  if (t.startsWith("-")) return "up";
  return "down";
}

export default function CourseMapClient() {
  const [data, setData] = useState<CourseResponse | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/course", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as CourseResponse;
      setData(json);
      setError(false);
      try {
        window.localStorage.setItem(
          "pardle_course_cache_v1",
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
    // Cached-first: show last response instantly while the live fetch
    // runs in the background.
    if (typeof window !== "undefined") {
      try {
        const cacheRaw = window.localStorage.getItem(
          "pardle_course_cache_v1",
        );
        if (cacheRaw) {
          const env = JSON.parse(cacheRaw) as {
            ts: number;
            data: CourseResponse;
          };
          if (
            env?.ts &&
            env.data &&
            Date.now() - env.ts < 60 * 60 * 1000
          ) {
            setData(env.data);
          }
        }
      } catch {
        // silent
      }
    }
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
          Couldn&apos;t load the course map. Retrying automatically.
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="v4-theme course-map" aria-busy="true">
        <div className="skeleton-line skeleton-line-title" />
        <div className="course-map-grid" style={{ marginTop: 14 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="course-hole">
              <div className="skeleton-line lb-skeleton-total" />
              <div className="skeleton-line lb-skeleton-name" style={{ marginTop: 8 }} />
              <div className="skeleton-line lb-skeleton-name" style={{ marginTop: 4, width: "70%" }} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (!data.tournament) {
    return (
      <section className="v4-theme" style={{ padding: 14 }}>
        <p className="feed-empty">
          No tournament on the schedule right now.
        </p>
      </section>
    );
  }
  if (!data.tournament.isLive) {
    return (
      <section className="v4-theme" style={{ padding: 14 }}>
        <p className="feed-empty">
          {data.tournament.name} hasn&apos;t teed off yet — course map
          opens once the first group goes out.
        </p>
      </section>
    );
  }

  // Group players by current hole. Build all 18 buckets up-front so
  // empty holes still render their card (an empty fairway is data).
  const byHole = new Map<number, CoursePlayer[]>();
  for (let i = 1; i <= 18; i++) byHole.set(i, []);
  const finished: CoursePlayer[] = [];
  const notStarted: CoursePlayer[] = [];
  const out: CoursePlayer[] = [];
  for (const p of data.players) {
    if (p.status === "out") {
      out.push(p);
      continue;
    }
    if (p.status === "finished") {
      finished.push(p);
      continue;
    }
    if (p.status === "not-started" || p.currentHole == null) {
      notStarted.push(p);
      continue;
    }
    byHole.get(p.currentHole)?.push(p);
  }
  // Sort each hole's players by leaderboard position (best first) so
  // the leader's avatar sits at the top of any stack.
  for (const arr of byHole.values()) {
    arr.sort((a, b) => parsePosition(a.position) - parsePosition(b.position));
  }

  const front = data.holes.slice(0, 9);
  const back = data.holes.slice(9, 18);

  return (
    <section className="course-map">
      <div className="course-map-header">
        <h2 className="course-map-tournament">
          <span
            className="feed-live-pulse feed-live-pulse-inline"
            aria-label="Live"
            title="Live"
          />
          {data.tournament.name} · R{data.tournament.currentRound}
        </h2>
        <p className="course-map-summary">
          {countActive(data.players)} on course · {finished.length} done ·{" "}
          {notStarted.length} yet to tee
        </p>
      </div>

      <CourseRow label="Front 9" holes={front} byHole={byHole} />
      <CourseRow label="Back 9" holes={back} byHole={byHole} />

      {finished.length > 0 && (
        <PlayerStrip
          title={`Finished R${data.tournament.currentRound}`}
          players={finished}
          tone="done"
        />
      )}
      {notStarted.length > 0 && (
        <PlayerStrip
          title="Yet to tee off"
          players={notStarted}
          tone="pending"
        />
      )}
    </section>
  );
}

function CourseRow({
  label,
  holes,
  byHole,
}: {
  label: string;
  holes: Hole[];
  byHole: Map<number, CoursePlayer[]>;
}) {
  return (
    <div className="course-map-row" aria-label={label}>
      <h3 className="course-map-row-label">{label}</h3>
      <div className="course-map-grid">
        {holes.map((h) => (
          <HoleCard
            key={h.number}
            hole={h}
            players={byHole.get(h.number) ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function HoleCard({
  hole,
  players,
}: {
  hole: Hole;
  players: CoursePlayer[];
}) {
  return (
    <div
      className={`course-hole${players.length === 0 ? " course-hole-empty" : ""}`}
    >
      <div className="course-hole-head">
        <span className="course-hole-num">H{hole.number}</span>
        {hole.par != null && (
          <span className="course-hole-par">Par {hole.par}</span>
        )}
      </div>
      <div className="course-hole-players">
        {players.length === 0 ? (
          <span className="course-hole-empty-dot" aria-hidden="true" />
        ) : (
          players.map((p) => (
            <Link
              key={p.playerId}
              href={`/live/player/${p.playerId}`}
              className={`course-player course-player-${toneFromTotal(p.total)}`}
              title={`${p.displayName} · ${p.total} · ${p.position}`}
            >
              <PlayerAvatar
                playerId={p.playerId}
                playerName={p.displayName}
                size="sm"
              />
              <span className="course-player-name">
                {abbreviateName(p.displayName)}
              </span>
              <span className="course-player-total">{p.total}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function PlayerStrip({
  title,
  players,
  tone,
}: {
  title: string;
  players: CoursePlayer[];
  tone: "done" | "pending";
}) {
  return (
    <div className={`course-strip course-strip-${tone}`}>
      <h3 className="course-strip-title">{title}</h3>
      <div className="course-strip-chips">
        {players.map((p) => (
          <Link
            key={p.playerId}
            href={`/live/player/${p.playerId}`}
            className={`course-strip-chip course-player-${toneFromTotal(p.total)}`}
            title={`${p.displayName} · ${p.total}`}
          >
            <span className="course-strip-chip-name">
              {abbreviateName(p.displayName)}
            </span>
            <span className="course-strip-chip-total">{p.total}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function countActive(players: CoursePlayer[]): number {
  return players.filter((p) => p.status === "active").length;
}

function parsePosition(pos: string): number {
  if (!pos) return 999;
  const m = /^T?(\d+)$/.exec(pos);
  if (!m) return 999;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 999;
}
