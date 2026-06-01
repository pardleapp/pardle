"use client";

/**
 * Confetti — subtle geometric burst that overlays the settlement
 * modal on a win. Matches the design-handoff prototype's <Confetti>:
 * 22 little squares in four brand colours (emerald, tangerine, blue,
 * deep emerald) falling from above with staggered delays + slight
 * rotation. No emoji — geometric only, per the brief.
 */

import { useMemo } from "react";

const COLORS = [
  "oklch(0.60 0.15 145)",
  "oklch(0.70 0.16 45)",
  "oklch(0.55 0.14 245)",
  "oklch(0.50 0.13 155)",
];

interface Bit {
  c: string;
  left: number;
  delay: string;
  duration: string;
}

export default function Confetti() {
  // useMemo so a re-render of the parent doesn't randomise the burst
  // every paint (would look frantic). One burst per mount.
  const bits: Bit[] = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        c: COLORS[i % 4],
        left: Math.random() * 94 + 1,
        delay: (Math.random() * 0.6).toFixed(2),
        duration: (1.4 + Math.random() * 1.1).toFixed(2),
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            left: `${b.left}%`,
            background: b.c,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
