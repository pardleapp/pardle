"use client";

/**
 * Horizontal-paged carousel for the top-of-feed onboarding +
 * engagement stations (first-bet CTA, sharp-score onboard,
 * prediction polls, catch-me-up). Replaces what used to be a
 * vertical stack of 4 cards eating ~600 px of viewport before
 * the live feed could even start.
 *
 * Design choices:
 *
 * - **CSS scroll-snap** drives the swipe. Native mobile inertia
 *   feels right out of the box; no JS gesture library.
 * - **No auto-advance**. Mid-read interruption frustrates more
 *   than it discovers; users will swipe / tap dots themselves.
 * - **IntersectionObserver** drives the active dot — the station
 *   that's most in view wins, so the dots track the user's swipe
 *   regardless of how they got there (gesture, dot tap, scroll
 *   wheel).
 * - **Hidden entirely when no children pass through**. Parent is
 *   responsible for deciding which stations are applicable — when
 *   none are, the carousel returns null and the feed lifts up.
 * - **Single child = no dots**. A lone station shouldn't read as
 *   "page 1 of 1"; just render the card directly.
 */

import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function TopCarousel({ children }: Props) {
  // Flatten + filter falsy children (so the parent can use
  // `{showX && <X />}` patterns without leaking empty slots).
  const stations = useMemo(() => {
    const out: ReactNode[] = [];
    Children.forEach(children, (child) => {
      if (child == null || child === false) return;
      if (typeof child === "string" && child.trim() === "") return;
      if (isValidElement(child) || typeof child === "string") {
        out.push(child);
      }
    });
    return out;
  }, [children]);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const stationRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // Track which station is in view via IntersectionObserver so
  // the dot strip stays in sync with the actual scroll position
  // (covers both swipe and programmatic scroll-to from dot taps).
  useEffect(() => {
    if (stations.length <= 1) return;
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx = activeIdx;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            const idx = stationRefs.current.findIndex(
              (el) => el === entry.target,
            );
            if (idx >= 0) bestIdx = idx;
          }
        }
        if (bestRatio > 0.5) setActiveIdx(bestIdx);
      },
      {
        root: track,
        threshold: [0.25, 0.5, 0.75, 1],
      },
    );
    for (const el of stationRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [stations.length, activeIdx]);

  const goTo = (idx: number) => {
    const el = stationRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  // ── Render gates ────────────────────────────────────────────────
  if (stations.length === 0) return null;
  if (stations.length === 1) {
    // Single station — render as a plain block, no carousel chrome.
    return <div className="top-carousel-solo">{stations[0]}</div>;
  }

  return (
    <div className="top-carousel">
      <div
        className="top-carousel-track"
        ref={trackRef}
        role="region"
        aria-label="Featured cards"
      >
        {stations.map((station, i) => (
          <div
            key={i}
            ref={(el) => {
              stationRefs.current[i] = el;
            }}
            className="top-carousel-station"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${stations.length}`}
          >
            {station}
          </div>
        ))}
      </div>
      <div className="top-carousel-dots" role="tablist" aria-label="Slide">
        {stations.map((_, i) => (
          <button
            type="button"
            key={i}
            role="tab"
            aria-selected={i === activeIdx}
            aria-label={`Slide ${i + 1} of ${stations.length}`}
            className={`top-carousel-dot${
              i === activeIdx ? " top-carousel-dot-on" : ""
            }`}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
  );
}
