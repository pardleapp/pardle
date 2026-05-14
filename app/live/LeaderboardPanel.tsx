"use client";

import Link from "next/link";
import { useState } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";

interface Props {
  rows: CachedLeaderboardRow[];
}

export default function LeaderboardPanel({ rows }: Props) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  // Collapsed = top 5, expanded = top 15.
  const shown = open ? rows : rows.slice(0, 5);

  return (
    <section className="lb-panel">
      <button
        type="button"
        className="lb-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>Leaderboard</span>
        <span className="lb-toggle-hint">
          {open ? "show less ▲" : "show top 15 ▼"}
        </span>
      </button>
      <ol className="lb-list">
        {shown.map((r) => (
          <li key={r.playerId} className="lb-row">
            <span className="lb-pos">{r.position}</span>
            <Link
              href={`/live/player/${r.playerId}`}
              className="lb-name"
            >
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
