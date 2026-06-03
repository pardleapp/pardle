"use client";

/**
 * SweatHeader — top of the Sweat Feed. Matches the design-handoff
 * prototype's .pv-head:
 *
 *   [Par**dle**]    [＋]   [🎮]   [🔔]   [🌍 The Lads ▾]
 *
 * The games/controller icon (left of the bell) routes to /games —
 * previously opened an in-place GamesHub overlay rendering the
 * same card grid, but a single tap on a card inside the overlay
 * misfired on every platform (verified on desktop too). The
 * standalone /games page already works correctly, so the icon
 * just navigates there now and the overlay variant is gone.
 *
 * The Space switcher chip is presentational for now — Groups
 * doesn't have a backend yet so it shows the static placeholder.
 */

import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function SweatHeader() {
  return (
    <>
      <header className="pv-head" aria-label="Pardle">
        <Link href="/" className="pv-head-wordmark" aria-label={BRAND.name}>
          Par<b>dle</b>
        </Link>
        <div className="pv-head-right">
          <Link
            href="/bets"
            className="pv-head-icon-btn pv-head-track"
            aria-label="Track a new bet"
            title="Track a new bet"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </Link>
          <Link
            href="/games"
            className="pv-head-icon-btn pv-head-games"
            aria-label="Daily games"
            title="Daily games"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2.5" y="7" width="19" height="10" rx="3.5" />
              <path d="M7 11v2.4M5.8 12.2h2.4" />
              <circle cx="15.5" cy="11.5" r="0.6" fill="currentColor" />
              <circle cx="17.6" cy="13.6" r="0.6" fill="currentColor" />
            </svg>
          </Link>
          <Link
            href="/notifications"
            className="pv-head-icon-btn pv-head-bell"
            aria-label="Notifications"
            title="Notifications"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
              <path d="M10 21a2 2 0 0 0 4 0" />
            </svg>
            <span className="pv-head-bell-dot" aria-label="Unread alerts" />
          </Link>
          <button
            type="button"
            className="pv-space-btn"
            aria-label="Switch space"
            aria-haspopup="menu"
          >
            <span className="pv-space-ic" aria-hidden="true">
              🌍
            </span>
            <span className="pv-space-nm">
              Global
              <small>Everyone on Pardle</small>
            </span>
            <span className="pv-space-cv" aria-hidden="true">
              ▾
            </span>
          </button>
        </div>
      </header>
    </>
  );
}
