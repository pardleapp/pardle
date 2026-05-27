/**
 * Shared top-level nav — Live feed / Bets / Games. Used by the home
 * page, /bets, and /games hub so all three share one bar and any
 * future tab additions land in one place.
 *
 * Server component (just renders Links). The `active` prop highlights
 * the current tab.
 */

import Link from "next/link";

export type MainNavTab =
  | "live"
  | "bets"
  | "leaderboard"
  | "course"
  | "games"
  /** Page is not itself one of the nav tabs (e.g. tipster channel,
   *  bet detail) but still wants the nav visible so visitors can
   *  navigate to other surfaces. No tab is highlighted. */
  | "none";

const TABS: Array<{ key: MainNavTab; href: string; label: string }> = [
  { key: "live", href: "/", label: "Feed" },
  { key: "bets", href: "/bets", label: "Bets" },
  { key: "leaderboard", href: "/leaderboard", label: "Leaderboard" },
  { key: "course", href: "/course", label: "Course" },
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
