"use client";

/**
 * Detail-page back button that pops the actual history stack
 * instead of a hard-coded destination. Use anywhere a page can
 * be reached from multiple parents — bet detail (opened from
 * Sweats / My-bets / chat bet-chip / member profile), player
 * page (opened from Sweats / Leaders / Groups / bet detail),
 * etc.
 *
 *   <BackButton fallback="/leaderboard" className="bd-pv-back" />
 *
 * Behaviour:
 *  - Normal case (browser session has a previous entry): runs
 *    router.back() — returns the user to wherever they came
 *    from, with their scroll position preserved.
 *  - No-history case (user opened the URL directly via a shared
 *    link / bookmark / push notif): navigates to `fallback`
 *    instead, so the back arrow never strands them.
 *
 * Children default to the arrow glyph; override to add a label.
 */

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

interface Props {
  /** Where to go when history is empty (e.g. direct-link arrival). */
  fallback: string;
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
}

export default function BackButton({
  fallback,
  className,
  ariaLabel = "Back",
  children = "←",
}: Props) {
  const router = useRouter();
  function onClick() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
