"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "pardle_hero_dismissed_v1";

/**
 * One-line value-prop strip shown above the tournament header for
 * first-time visitors. Explains what Pardle is so a cold Reddit /
 * X click-through doesn't bounce wondering "is this a leaderboard,
 * a betting site, a wordle game?". Dismissed permanently via
 * localStorage once tapped — repeat visitors don't see it.
 *
 * Sized to ~64px tall on mobile so it adds minimal vertical cost
 * to the first impression while delivering the orientation.
 */
export default function HeroIntro() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHidden(!!window.localStorage.getItem(DISMISS_KEY));
  }, []);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
    setHidden(true);
  }

  if (hidden) return null;

  return (
    <section className="hero-intro" aria-label="What is Pardle">
      <div className="hero-intro-body">
        <p className="hero-intro-title">
          The live tracker for golf bettors
        </p>
        <p className="hero-intro-blurb">
          Sub-15s feed · £ swing on every shot · react with other bettors
        </p>
      </div>
      <button
        type="button"
        className="hero-intro-dismiss"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </section>
  );
}
