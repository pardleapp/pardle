"use client";

/**
 * DesktopContextRail — right-side context column at @media
 * (min-width: 1280px). Surfaces three things in the desktop
 * sidebar:
 *
 *   1. Live tournament strip (name + LIVE pill) — same source as
 *      the in-feed strip on mobile.
 *   2. Your bets snapshot — count + live P&L (real data via the
 *      same /api/feed poll + tracked-bet store the inline cards
 *      already use).
 *   3. Leaderboard top-5 — real /api/feed leaderboard rows.
 *
 * Hidden below 1280px (display: none in CSS); the rail uses real
 * data only, mirroring the rest of the app's "no demo data leaks
 * to default users" stance.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface FeedSnapshot {
  tournament: { name: string; isLive: boolean } | null;
  leaderboard: Array<{
    playerId: string;
    displayName: string;
    position: string;
    total: string;
    thru: string;
  }>;
}

const POLL_MS = 15_000;

function abbreviate(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export default function DesktopContextRail() {
  const [feed, setFeed] = useState<FeedSnapshot | null>(null);

  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/feed?v=ctx-rail", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (cancel) return;
        setFeed({
          tournament: j.tournament ?? null,
          leaderboard: (j.leaderboard ?? []).slice(0, 5),
        });
      } catch {
        // ignore; next tick retries
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  const live = feed?.tournament?.isLive;

  return (
    <aside className="desktop-ctx" aria-label="Context">
      {/* Tournament strip */}
      <section className="desktop-ctx-block">
        <div className="desktop-ctx-label">Now playing</div>
        <div className="desktop-ctx-tournament">
          {live && (
            <span
              className="feed-live-pulse feed-live-pulse-inline"
              aria-label="Live"
            />
          )}
          <span className="desktop-ctx-tournament-name">
            {feed?.tournament?.name ?? "Loading…"}
          </span>
        </div>
      </section>

      {/* Leaderboard top-5 */}
      <section className="desktop-ctx-block">
        <div className="desktop-ctx-label desktop-ctx-label-row">
          <span>Leaderboard</span>
          <Link href="/leaderboard" className="desktop-ctx-link">
            All →
          </Link>
        </div>
        {feed?.leaderboard.length ? (
          <ul className="desktop-ctx-lb">
            {feed.leaderboard.map((r) => (
              <li key={r.playerId} className="desktop-ctx-lb-row">
                <span className="desktop-ctx-lb-pos mono">{r.position}</span>
                <span className="desktop-ctx-lb-name">
                  {abbreviate(r.displayName)}
                </span>
                <span className="desktop-ctx-lb-total mono">
                  {r.total === "E" ? "E" : r.total}
                </span>
                <span className="desktop-ctx-lb-thru mono">{r.thru}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="desktop-ctx-empty">
            {feed ? "No leaderboard yet" : "Loading…"}
          </div>
        )}
      </section>

      {/* Your bets pointer */}
      <section className="desktop-ctx-block">
        <div className="desktop-ctx-label desktop-ctx-label-row">
          <span>Your tracker</span>
          <Link href="/bets" className="desktop-ctx-link">
            View →
          </Link>
        </div>
        <div className="desktop-ctx-help">
          Track a bet with the green ＋ to see live P&amp;L move with every
          shot.
        </div>
      </section>
    </aside>
  );
}
