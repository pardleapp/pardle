"use client";

/**
 * BottomNav — fixed-position mobile nav strip. Tabs (as of the
 * Commentary launch): Sweats / My bets / Commentary / Groups / Sharp
 * / Analysis. Leaders was retired — the /leaderboard route still
 * exists for old bookmarks but is no longer promoted. Hidden on
 * desktop (>=768px) via CSS; the existing top MainNav handles
 * desktop routing.
 *
 * Groups doesn't exist yet (handoff build order step 4) — its tab
 * routes to /groups which renders a coming-soon page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  href: string;
  label: string;
  /** Tab is active when the current pathname matches any of these
   *  prefixes. */
  matches: string[];
  /** Inline SVG path data — 24×24 viewBox. */
  iconPath: React.ReactNode;
}

const TABS: Tab[] = [
  {
    href: "/",
    label: "Insights",
    matches: ["/", "/commentary"],
    iconPath: (
      <>
        <path d="M4 6h11l4 4v9a1 1 0 0 1-1 1H4z" />
        <path d="M7 11h9M7 15h6" />
      </>
    ),
  },
  {
    href: "/live",
    label: "Feed",
    matches: ["/live"],
    iconPath: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
      </>
    ),
  },
  {
    href: "/bets",
    label: "My bets",
    matches: ["/bets"],
    iconPath: (
      <>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </>
    ),
  },
  {
    href: "/groups",
    label: "Groups",
    matches: ["/groups"],
    iconPath: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16 6a3 3 0 0 1 0 6" />
        <path d="M18 13.5a5.5 5.5 0 0 1 2.5 4.5" />
      </>
    ),
  },
  {
    href: "/sharp",
    label: "Sharp",
    matches: ["/sharp"],
    iconPath: (
      <>
        <path d="M12 3v18" />
        <path d="M4 9h16M4 15h16" />
      </>
    ),
  },
  {
    href: "/analysis",
    label: "Tools",
    matches: ["/analysis"],
    iconPath: (
      <>
        <path d="M4 20V4" />
        <path d="M4 20h16" />
        <path d="M8 16v-4" />
        <path d="M12 16V9" />
        <path d="M16 16v-6" />
      </>
    ),
  },
];

function isActive(pathname: string, matches: string[]): boolean {
  for (const m of matches) {
    if (m === "/") {
      if (pathname === "/") return true;
    } else if (pathname === m || pathname.startsWith(`${m}/`)) {
      return true;
    }
  }
  return false;
}

export default function BottomNav() {
  const pathname = usePathname() || "/";
  return (
    <nav className="bottom-nav" aria-label="Primary mobile">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.matches);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`bottom-nav-btn${active ? " bottom-nav-btn-on" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="bottom-nav-ic" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {tab.iconPath}
              </svg>
            </span>
            <span className="bottom-nav-lbl">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
