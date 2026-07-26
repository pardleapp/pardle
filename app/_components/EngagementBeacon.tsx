"use client";

/**
 * EngagementBeacon — records that the visitor has spent meaningful
 * time on a value-proving surface (an article or an analysis tool).
 * Writes a `pardle_engaged_at` timestamp to localStorage after the
 * visitor has actually consumed the page. The subscribe popup reads
 * that key before firing so the ask only lands AFTER they've seen
 * what they'd be signing up for.
 *
 * Signals per surface:
 *   - /commentary/<slug>  →  scrolled past ~85% of the article (that
 *                            is "finished reading"). 3-minute dwell
 *                            fallback for pages that fit in one
 *                            viewport or readers who never scroll.
 *   - /analysis/<tool>    →  60s dwell. Tool pages are input-driven
 *                            so scroll isn't a good signal — a user
 *                            needs time to enter values and read the
 *                            forecast that comes back.
 *
 * Both are much slower than the old 10-second trigger, which
 * interrupted people mid-read with the popup.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "pardle_engaged_at";
const TOOL_DWELL_MS = 60_000;
const ARTICLE_SCROLL_THRESHOLD = 0.85;
const ARTICLE_FALLBACK_DWELL_MS = 180_000;

type PageKind = "article" | "tool" | null;

function pathKind(pathname: string): PageKind {
  if (/^\/commentary\/[^/]+$/.test(pathname)) return "article";
  if (/^\/analysis\/[^/]+/.test(pathname)) return "tool";
  return null;
}

function markEngaged(): void {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* private mode / quota — silent */
  }
}

export default function EngagementBeacon() {
  const pathname = usePathname() || "/";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const kind = pathKind(pathname);
    if (!kind) return;
    try {
      if (window.localStorage.getItem(KEY)) return;
    } catch {
      /* private mode — try again with the timer regardless */
    }

    if (kind === "tool") {
      const t = window.setTimeout(markEngaged, TOOL_DWELL_MS);
      return () => window.clearTimeout(t);
    }

    // Article path: engage on scroll-to-bottom, with a dwell fallback.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      markEngaged();
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(fallback);
    };
    const onScroll = () => {
      const total = document.documentElement.scrollHeight;
      const view = window.innerHeight;
      // Pages that fit in a single viewport can't produce a scroll
      // signal — let the fallback dwell handle those.
      if (total - view < 100) return;
      const frac = (window.scrollY + view) / total;
      if (frac >= ARTICLE_SCROLL_THRESHOLD) finish();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const fallback = window.setTimeout(finish, ARTICLE_FALLBACK_DWELL_MS);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(fallback);
    };
  }, [pathname]);

  return null;
}
