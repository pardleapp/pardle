"use client";

/**
 * SweatHeader — top of the Sweat Feed. Matches the design-handoff
 * prototype's .pv-head:
 *
 *   [Par**dle**]                 [bell] [🏌️ The Lads ▾]
 *
 * Replaces the old brand-bar + MainNav for pv-theme'd surfaces. The
 * Space switcher chip is presentational for now — Groups doesn't
 * have a backend yet so it shows the static placeholder. The bell
 * routes to the notifications surface when one exists; today it's a
 * silent indicator.
 */

import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function SweatHeader() {
  return (
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
        <button
          type="button"
          className="pv-head-icon-btn pv-head-bell"
          aria-label="Notifications"
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
        </button>
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
  );
}
