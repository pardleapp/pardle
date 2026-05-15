"use client";

import type { ShotTrace, ShotTraceSegment } from "@/lib/feed/shot-trace";

/**
 * Broadcast-style shot tracer drawn from normalised 0-1 shot
 * coordinates on the hole's overhead view.
 *
 * - `thumb` mode frames tight around the *key* segment (the chip-in /
 *   the long putt / the hole-out) so the card shows the shot that
 *   matters, not the whole hole flat.
 * - `full` mode shows the whole hole with the key segment highlighted.
 *
 * The backdrop is the PGA Tour "TourCast Pickle" overhead hole-diagram
 * image (the enhanced shot coords map onto it), falling back to a
 * clean gradient when an image isn't available.
 *
 * Visual language (matches what golf broadcasts tend to use):
 * - Non-putt shots: arced solid line. The "story" shot is bright
 *   yellow with a dark outline + arrow at the cup; supporting shots
 *   (the tee, lay-ups) are faded dashed white.
 * - Putts: dashed colour-progressing lines (yellow → orange → red →
 *   deep red), each putt clearly distinct so a 3-putt reads as three
 *   strokes, not one arrow.
 */

const W = 200;
const H = 112;

const PUTT_COLORS = ["#fff200", "#ff9a1f", "#ff2f2f", "#a31010"];

function arcPath(
  s: ShotTraceSegment,
  px: (x: number) => number,
  py: (y: number) => number,
): string {
  const fx = px(s.fromX);
  const fy = py(s.fromY);
  const tx = px(s.toX);
  const ty = py(s.toY);
  if (s.kind === "putt") return `M${fx},${fy} L${tx},${ty}`;

  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return `M${fx},${fy} L${tx},${ty}`;

  // Perpendicular unit vector (rotated 90° left).
  let nx = -dy / len;
  let ny = dx / len;
  // Always bulge toward the top of the frame so the arc reads as
  // "flight" no matter which way the shot is travelling.
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const arcHeight = len * 0.18;
  const cx = (fx + tx) / 2 + nx * arcHeight;
  const cy = (fy + ty) / 2 + ny * arcHeight;
  return `M${fx},${fy} Q${cx},${cy} ${tx},${ty}`;
}

export default function ShotTracer({
  trace,
  mode = "thumb",
}: {
  trace: ShotTrace;
  mode?: "thumb" | "full";
}) {
  const { segments, keyIndex } = trace;
  if (segments.length === 0) return null;

  const px = (x: number) => x * W;
  const py = (y: number) => y * H;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const keyI = keyIndex >= 0 ? keyIndex : segments.length - 1;
  const key = segments[keyI];

  // Frame: thumb zooms around the key segment, full shows the hole.
  // `fullFrame` traces (green-zoom diagrams) are already framed —
  // show them whole even in thumb mode.
  let vb = { x: 0, y: 0, w: W, h: H };
  if (mode === "thumb" && !trace.fullFrame) {
    let minX = Math.min(key.fromX, key.toX);
    let maxX = Math.max(key.fromX, key.toX);
    let minY = Math.min(key.fromY, key.toY);
    let maxY = Math.max(key.fromY, key.toY);
    const padX = Math.max(0.2, (maxX - minX) * 0.6);
    const padY = Math.max(0.2, (maxY - minY) * 0.6);
    minX = Math.max(0, minX - padX);
    maxX = Math.min(1, maxX + padX);
    minY = Math.max(0, minY - padY);
    maxY = Math.min(1, maxY + padY);
    vb = {
      x: px(minX),
      y: py(minY),
      w: px(maxX - minX),
      h: py(maxY - minY),
    };
  }

  // Scale stroke widths / radii so they look consistent when zoomed.
  const sc = (vb.w / W + vb.h / H) / 2;

  // Assign each putt segment an index in the putt sequence so we can
  // colour-progress yellow→red across the multi-putt holes.
  const puttIdxBy = new Map<number, number>();
  let puttCount = 0;
  segments.forEach((s, i) => {
    if (s.kind === "putt") {
      puttIdxBy.set(i, puttCount);
      puttCount++;
    }
  });

  // Arrow goes on the holing stroke (the last segment, which ends in
  // the cup). When the last stroke is a putt it'll be the final
  // (highest-numbered) putt; when it's a hole-out it'll be the
  // approach itself.
  const arrowIdx = segments.length - 1;

  // Unique-per-render IDs so multiple tracers on a page don't share
  // <defs> (the modal stacks on top of the thumb).
  const uid = `tr${Math.abs(
    (first.fromX * 1e6 + last.toX * 1e6 + segments.length) | 0,
  )}`;

  // The arrow needs to match whichever colour the holing stroke uses.
  const holingPuttN = puttIdxBy.get(arrowIdx);
  const arrowFill =
    holingPuttN != null
      ? PUTT_COLORS[Math.min(holingPuttN, PUTT_COLORS.length - 1)]
      : "#fff200";

  return (
    <svg
      className="tracer"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-turf`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3f7d3a" />
          <stop offset="100%" stopColor="#2c5a28" />
        </linearGradient>
        <marker
          id={`${uid}-arrow`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth={4}
          markerHeight={4}
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,1 L10,5 L0,9 z" fill={arrowFill} />
        </marker>
      </defs>

      {/* Real PGA Tour hole diagram, with a gradient fallback behind it. */}
      <rect x={0} y={0} width={W} height={H} fill={`url(#${uid}-turf)`} />
      {trace.holeImage && (
        <image
          href={trace.holeImage}
          x={0}
          y={0}
          width={W}
          height={H}
          preserveAspectRatio="none"
        />
      )}
      {trace.holeImage && (
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="rgba(15,31,15,0.32)"
        />
      )}

      {/* Pass 1: lead-in context (non-key, non-putt) — faded dashed white. */}
      {segments.map((s, i) => {
        if (s.kind === "putt" || i === keyI) return null;
        return (
          <path
            key={`ctx${i}`}
            d={arcPath(s, px, py)}
            stroke="rgba(255,255,255,0.65)"
            strokeWidth={1.6 * sc}
            strokeLinecap="round"
            strokeDasharray={`${3 * sc} ${2.4 * sc}`}
            fill="none"
          />
        );
      })}

      {/* Pass 2: putts — each putt its own bright colour-coded dash. */}
      {segments.map((s, i) => {
        if (s.kind !== "putt") return null;
        const n = puttIdxBy.get(i) ?? 0;
        const color = PUTT_COLORS[Math.min(n, PUTT_COLORS.length - 1)];
        return (
          <g key={`putt${i}`}>
            <path
              d={arcPath(s, px, py)}
              stroke="rgba(20,15,5,0.75)"
              strokeWidth={3.6 * sc}
              strokeLinecap="round"
              strokeDasharray={`${3.2 * sc} ${1.8 * sc}`}
              fill="none"
            />
            <path
              d={arcPath(s, px, py)}
              stroke={color}
              strokeWidth={2.2 * sc}
              strokeLinecap="round"
              strokeDasharray={`${3.2 * sc} ${1.8 * sc}`}
              fill="none"
              markerEnd={i === arrowIdx ? `url(#${uid}-arrow)` : undefined}
            />
          </g>
        );
      })}

      {/* Pass 3: the key non-putt segment — solid bright yellow + outline. */}
      {key.kind !== "putt" && (
        <>
          <path
            d={arcPath(key, px, py)}
            stroke="rgba(20,15,5,0.85)"
            strokeWidth={5 * sc}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d={arcPath(key, px, py)}
            stroke="#fff200"
            strokeWidth={2.6 * sc}
            strokeLinecap="round"
            fill="none"
            markerEnd={keyI === arrowIdx ? `url(#${uid}-arrow)` : undefined}
          />
        </>
      )}

      {/* Putt landing-dot numbers — only when there are multiple putts,
          so a normal one-putt birdie stays clean. */}
      {puttCount > 1 &&
        segments.map((s, i) => {
          if (s.kind !== "putt") return null;
          const n = (puttIdxBy.get(i) ?? 0) + 1;
          const color = PUTT_COLORS[Math.min(n - 1, PUTT_COLORS.length - 1)];
          return (
            <g key={`pn${i}`}>
              <circle
                cx={px(s.toX)}
                cy={py(s.toY)}
                r={3.4 * sc}
                fill={color}
                stroke="rgba(20,15,5,0.9)"
                strokeWidth={0.8 * sc}
              />
              <text
                x={px(s.toX)}
                y={py(s.toY) + 1.6 * sc}
                textAnchor="middle"
                fontSize={4.2 * sc}
                fontWeight="900"
                fill="#1a1500"
              >
                {n}
              </text>
            </g>
          );
        })}

      {/* Landing dots on supporting shots — quieter than the putt dots. */}
      {segments.map((s, i) => {
        if (s.kind === "putt" || i === keyI || i === arrowIdx) return null;
        return (
          <circle
            key={`d${i}`}
            cx={px(s.toX)}
            cy={py(s.toY)}
            r={1.8 * sc}
            fill="rgba(255,255,255,0.85)"
          />
        );
      })}

      {/* Start dot on the first segment's ball position. */}
      <circle
        cx={px(first.fromX)}
        cy={py(first.fromY)}
        r={2.8 * sc}
        fill="#fff"
        stroke="rgba(20,15,5,0.9)"
        strokeWidth={1 * sc}
      />

      {/* Flag at the cup. */}
      <g
        transform={`translate(${px(last.toX)} ${py(last.toY)}) scale(${sc})`}
        stroke="#ffffff"
        strokeWidth={1.4}
      >
        <line x1={0} y1={0} x2={0} y2={-11} />
        <path d="M0,-11 L7,-8.5 L0,-6 Z" fill="#d23b3b" stroke="none" />
      </g>
    </svg>
  );
}
