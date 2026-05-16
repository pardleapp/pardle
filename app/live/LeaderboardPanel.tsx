"use client";

import Link from "next/link";
import type { CachedLeaderboardRow } from "@/lib/feed/store";

interface Props {
  rows: CachedLeaderboardRow[];
  /**
   * `tab` = lives on its own tab (no header, render every row).
   * `inline` (default) = small panel inside the main feed view.
   */
  mode?: "inline" | "tab";
}

export default function LeaderboardPanel({ rows, mode = "inline" }: Props) {
  if (rows.length === 0) return null;
  return (
    <section className={`lb-panel ${mode === "tab" ? "lb-panel-tab" : ""}`}>
      {mode === "inline" && (
        <p className="lb-header">Leaderboard · top {rows.length}</p>
      )}
      <ol className="lb-list">
        {rows.map((r) => (
          <li key={r.playerId} className="lb-row">
            <span className="lb-pos">{r.position}</span>
            <Link href={`/live/player/${r.playerId}`} className="lb-name">
              {r.displayName}
            </Link>
            <span className="lb-total">{r.total}</span>
            <span className="lb-thru">{r.thru}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
