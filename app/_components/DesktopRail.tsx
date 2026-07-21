"use client";

/**
 * DesktopRail — left navigation rail shown only at @media
 * (min-width: 1024px). The mobile bottom-nav is unchanged and stays
 * the primary nav under 1024px; this rail is the desktop replacement.
 *
 * Same primary destinations as BottomNav (Sweats / My bets /
 * Commentary / Groups / Sharp) plus a secondary block for Games,
 * Analysis and Notifications. Visibility is purely CSS-driven via
 * `.desktop-rail { display: none }` outside the desktop media query
 * — the React tree is still rendered on every breakpoint, but it
 * doesn't paint on mobile.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item {
  href: string;
  label: string;
  matches: string[];
  iconPath: React.ReactNode;
}

// One flat list — desktop rail reads as a single continuous menu.
// Games + Notifications used to sit in a separate bottom-pinned
// block; per design feedback they're now an inline continuation of
// the primary five, no visual separator.
const PRIMARY: Item[] = [
  {
    href: "/",
    label: "Sweats",
    matches: ["/", "/live"],
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
    href: "/commentary",
    label: "Commentary",
    matches: ["/commentary"],
    iconPath: (
      <>
        <path d="M4 6h11l4 4v9a1 1 0 0 1-1 1H4z" />
        <path d="M7 11h9M7 15h6" />
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
    href: "/games",
    label: "Games",
    matches: ["/games", "/pros", "/holes", "/connections", "/trivia", "/faces"],
    iconPath: (
      <>
        <rect x="2.5" y="7" width="19" height="10" rx="3.5" />
        <path d="M7 11v2.4M5.8 12.2h2.4" />
        <circle cx="15.5" cy="11.5" r="0.6" fill="currentColor" />
        <circle cx="17.6" cy="13.6" r="0.6" fill="currentColor" />
      </>
    ),
  },
  {
    href: "/analysis",
    label: "Analysis",
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
  {
    href: "/notifications",
    label: "Notifications",
    matches: ["/notifications"],
    iconPath: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
        <path d="M10 21a2 2 0 0 0 4 0" />
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

function Row({ item, pathname }: { item: Item; pathname: string }) {
  const active = isActive(pathname, item.matches);
  return (
    <Link
      href={item.href}
      className={`desktop-rail-link${active ? " desktop-rail-link-on" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <span className="desktop-rail-ic" aria-hidden="true">
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
          {item.iconPath}
        </svg>
      </span>
      <span className="desktop-rail-lbl">{item.label}</span>
    </Link>
  );
}

export default function DesktopRail() {
  const pathname = usePathname() || "/";
  return (
    <nav className="desktop-rail" aria-label="Primary navigation">
      <Link href="/" className="desktop-rail-brand" aria-label="Pardle">
        Par<b>dle</b>
      </Link>
      <ul className="desktop-rail-list">
        {PRIMARY.map((item) => (
          <li key={item.href}>
            <Row item={item} pathname={pathname} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
