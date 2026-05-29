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
  // Some station components render null based on their own
  // internal state (e.g. SharpScoreOnboard reads its dismissed
  // flag from localStorage; CatchMeUp returns null when there's
  // nothing to catch up on). The parent JSX passes them
  // unconditionally so we measure each station's height after
  // render — any station that ended up empty gets excluded from
  // the dot strip and the swipe sequence. ResizeObserver keeps
  // this in sync if a station goes empty after the user interacts
  // (vote on last poll, etc.).
  const [stationHeights, setStationHeights] = useState<number[]>([]);
  useEffect(() => {
    const observers: ResizeObserver[] = [];
    const heights = stationRefs.current.map((el) => el?.offsetHeight ?? 0);
    setStationHeights(heights);
    stationRefs.current.forEach((el, i) => {
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        const h = entries[0]?.contentRect.height ?? 0;
        setStationHeights((prev) => {
          if (prev[i] === h) return prev;
          const next = prev.slice();
          next[i] = h;
          return next;
        });
      });
      ro.observe(el);
      observers.push(ro);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, [stations]);
  const visibleStationIndices = useMemo(
    () => stations.map((_, i) => i).filter((i) => (stationHeights[i] ?? 1) > 0),
    [stations, stationHeights],
  );

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
  // Single visible station — render as a plain block so the
  // user doesn't see a carousel with no swipe affordance (looks
  // broken). Two or more stations → real carousel chrome.
  if (visibleStationIndices.length <= 1) {
    return <div className="top-carousel-solo">{stations}</div>;
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
            className={`top-carousel-station${
              (stationHeights[i] ?? 1) === 0
                ? " top-carousel-station-empty"
                : ""
            }`}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${stations.length}`}
          >
            {station}
          </div>
        ))}
      </div>
      <div className="top-carousel-dots" role="tablist" aria-label="Slide">
        {visibleStationIndices.map((stationIdx, dotIdx) => (
          <button
            type="button"
            key={stationIdx}
            role="tab"
            aria-selected={stationIdx === activeIdx}
            aria-label={`Slide ${dotIdx + 1} of ${visibleStationIndices.length}`}
            className={`top-carousel-dot${
              stationIdx === activeIdx ? " top-carousel-dot-on" : ""
            }`}
            onClick={() => goTo(stationIdx)}
          />
        ))}
      </div>
    </div>
  );
}
