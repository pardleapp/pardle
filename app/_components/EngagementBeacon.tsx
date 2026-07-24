"use client";

/**
 * EngagementBeacon — records that the visitor has spent meaningful
 * time on a value-proving surface (an article or an analysis tool).
 * Writes a `pardle_engaged_at` timestamp to localStorage after a short
 * dwell on any qualifying path. The subscribe popup reads that key
 * before firing so the ask only lands AFTER the visitor has seen what
 * they'd be signing up for.
 *
 * Mounted globally in the root layout — it inspects the current path
 * and only arms itself on the paths that count as "value-proving":
 *   - /commentary/[slug]  (a full article)
 *   - /analysis/<tool>    (a specific tool page; the /analysis index
 *                          alone doesn't count — that's still browse)
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "pardle_engaged_at";
const DWELL_MS = 10_000; // 10 seconds on-page counts as engagement

function pathQualifies(pathname: string): boolean {
  // Article — /commentary/<slug>
  if (/^\/commentary\/[^/]+$/.test(pathname)) return true;
  // Tool page — /analysis/<tool>, not the /analysis index itself
  if (/^\/analysis\/[^/]+/.test(pathname)) return true;
  return false;
}

export default function EngagementBeacon() {
  const pathname = usePathname() || "/";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!pathQualifies(pathname)) return;
    // Already marked engaged this visitor's history? Skip the timer.
    try {
      if (window.localStorage.getItem(KEY)) return;
    } catch {
      /* private mode — try again with the timer regardless */
    }
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* localStorage quota / private mode — silent */
      }
    }, DWELL_MS);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return null;
}
