/**
 * Shared top-level nav — Live feed / Bets / Games. Used by the home
 * page, /bets, and /games hub so all three share one bar and any
 * future tab additions land in one place.
 *
 * Server component (just renders Links). The `active` prop highlights
 * the current tab.
 */

import Link from "next/link";

export type MainNavTab = "live" | "bets" | "games";

const TABS: Array<{ key: MainNavTab; href: string; label: string }> = [
  { key: "live", href: "/", label: "Live feed" },
  { key: "bets", href: "/bets", label: "Bets" },
  { key: "games", href: "/games", label: "Games" },
];

export default function MainNav({ active }: { active: MainNavTab }) {
  return (
    <nav className="hub-nav-tabs" aria-label="Section">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`hub-nav-tab${isActive ? " hub-nav-tab-active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
