"use client";

import Link from "next/link";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import PlayerAvatar from "./PlayerAvatar";
import RecentFormSparkline, {
  type RecentEvent,
} from "./RecentFormSparkline";

interface RecentFormEntry {
  name: string;
  recent: RecentEvent[];
}

interface Props {
  rows: CachedLeaderboardRow[];
  /**
   * `tab` = lives on its own tab (no header, render every row).
   * `inline` (default) = small panel inside the main feed view.
   */
  mode?: "inline" | "tab";
  /** Map of playerId → recent form. Renders the sparkline inline
   *  alongside each row when supplied. */
  recentForm?: Record<string, RecentFormEntry>;
  /** Hot/cold-hand status keyed by playerId. */
  handStatus?: Record<string, "hot" | "cold">;
}

function trendFor(recent: RecentEvent[]): "up" | "down" | "flat" {
  if (recent.length < 5) return "flat";
  const scoreOf = (e: RecentEvent) =>
    e.finishPos ?? (e.madeCut ? 80 : 90);
  const newer = (scoreOf(recent[0]) + scoreOf(recent[1]) + scoreOf(recent[2])) / 3;
  const older = (scoreOf(recent[3]) + scoreOf(recent[4])) / 2;
  const diff = older - newer;
  if (diff > 8) return "up";
  if (diff < -8) return "down";
  return "flat";
}

export default function LeaderboardPanel({
  rows,
  mode = "inline",
  recentForm,
  handStatus,
}: Props) {
  if (rows.length === 0) return null;
  return (
    <section className={`lb-panel ${mode === "tab" ? "lb-panel-tab" : ""}`}>
      {mode === "inline" && (
        <p className="lb-header">Leaderboard · top {rows.length}</p>
      )}
      <ol className="lb-list">
        {rows.map((r) => {
          const form = recentForm?.[r.playerId];
          const hand = handStatus?.[r.playerId];
          return (
            <li key={r.playerId} className="lb-row">
              <span className="lb-pos">{r.position}</span>
              <PlayerAvatar
                playerId={r.playerId}
                playerName={r.displayName}
                size="sm"
                state={hand ?? null}
              />
              <Link
                href={`/live/player/${r.playerId}`}
                className="lb-name"
              >
                {hand && (
                  <span
                    className={`hand-badge hand-badge-${hand}`}
                    aria-hidden="true"
                  >
                    {hand === "hot" ? "🔥" : "🥶"}
                  </span>
                )}
                {r.displayName}
              </Link>
              {form && (
                <RecentFormSparkline
                  recent={form.recent}
                  trend={trendFor(form.recent)}
                  mode="compact"
                />
              )}
              <span className="lb-total">{r.total}</span>
              <span className="lb-thru">{r.thru}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
