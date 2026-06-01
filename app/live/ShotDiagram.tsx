"use client";

/**
 * ShotDiagram — small SVG thumbnail of a shot's trajectory beside
 * a feed card or inside a Shots-of-the-day reel item. When the
 * orchestrator gave us coordinates (`event.trace` populated), we
 * render via the existing ShotTracer; otherwise we fall back to a
 * stylised hole shape with a generic arc so the card still reads
 * as "this happened on a golf hole" rather than going blank.
 *
 * Two sizes:
 *   thumb (default) — 88×60, used inline on shot cards + reel
 *   wide            — 200×112, used in expanded share / reel-tap
 *                     view (passes through to ShotTracer's `full`
 *                     mode so the user can pinch/zoom).
 */

import type { FeedEvent, ScoreResult } from "@/lib/feed/types";
import ShotTracer from "./ShotTracer";

interface Props {
  event: FeedEvent;
  size?: "thumb" | "wide";
}

/** Result → fallback story arc shape. Eagles/birdies use a high
 *  approach arc into a centred green; bogeys/doubles use a flat
 *  drift to one side; putts use a short on-green curve. */
function fallbackArcKind(result: ScoreResult | undefined): "approach" | "putt" | "miss" {
  if (!result) return "approach";
  if (result === "eagle" || result === "albatross") return "approach";
  if (result === "bogey" || result === "double" || result === "triple-plus") {
    return "miss";
  }
  return "approach";
}

function FallbackHole({ kind }: { kind: "approach" | "putt" | "miss" }) {
  // Simple stylised hole — tee at top, green oval at bottom, flag
  // on the green. Different arc per kind so a 4-putt diagram reads
  // visibly different to a hole-out.
  const arc =
    kind === "putt"
      ? "M50,82 C 56,76 64,72 70,68"
      : kind === "miss"
        ? "M50,16 Q 35,46 28,68"
        : "M50,16 Q 76,38 70,68";
  const ballAt =
    kind === "putt"
      ? { cx: 70, cy: 68 }
      : kind === "miss"
        ? { cx: 28, cy: 68 }
        : { cx: 70, cy: 68 };
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="diag-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.08 145)" />
          <stop offset="100%" stopColor="oklch(0.65 0.10 150)" />
        </linearGradient>
      </defs>
      {/* Tee box at top — narrow rectangle. */}
      <rect
        x="42"
        y="6"
        width="16"
        height="8"
        rx="2"
        fill="oklch(0.55 0.08 60)"
      />
      {/* Fairway shape — tapering rectangle. */}
      <path
        d="M40,14 L60,14 L74,66 L26,66 Z"
        fill="url(#diag-turf)"
      />
      {/* Green oval at bottom. */}
      <ellipse
        cx="50"
        cy="76"
        rx="34"
        ry="14"
        fill="oklch(0.85 0.10 145)"
        stroke="oklch(0.55 0.10 145)"
        strokeWidth="1.2"
      />
      {/* Shot arc. */}
      <path
        d={arc}
        stroke={kind === "miss" ? "var(--pv-down)" : "var(--pv-emerald)"}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={kind === "miss" ? "3 3" : undefined}
      />
      {/* Ball end position. */}
      <circle
        cx={ballAt.cx}
        cy={ballAt.cy}
        r="2.6"
        fill="#ffffff"
        stroke={kind === "miss" ? "var(--pv-down)" : "var(--pv-emerald)"}
        strokeWidth="1.2"
      />
      {/* Flag near the cup. */}
      <line
        x1="50"
        y1="62"
        x2="50"
        y2="74"
        stroke="oklch(0.35 0.08 150)"
        strokeWidth="1.2"
      />
      <path d="M50,62 L57,64 L50,66 Z" fill="oklch(0.55 0.18 28)" />
    </svg>
  );
}

export default function ShotDiagram({ event, size = "thumb" }: Props) {
  const className = `shot-diagram shot-diagram-${size}`;
  if (event.trace && event.trace.segments && event.trace.segments.length > 0) {
    return (
      <div className={className} aria-hidden="true">
        <ShotTracer
          trace={event.trace}
          mode={size === "wide" ? "full" : "thumb"}
        />
      </div>
    );
  }
  return (
    <div className={className} aria-hidden="true">
      <FallbackHole kind={fallbackArcKind(event.result)} />
    </div>
  );
}
