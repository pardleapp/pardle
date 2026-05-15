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
 * Each non-putt segment is drawn as a quadratic Bezier with a small
 * perpendicular bulge — mimicking the curved arc broadcast tracers
 * paint on flight footage. Putts stay straight (they hug the ground).
 * The key segment carries a soft glow + a bright yellow→red gradient
 * and an arrowhead so it reads as "this is the shot".
 */

const W = 200;
const H = 112;

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

  // Unique-per-render IDs so multiple tracers on a page don't share
  // <defs> (the modal can stack on top of a thumb).
  const uid = `tr${Math.abs(
    (first.fromX * 1e6 + last.toX * 1e6 + segments.length) | 0,
  )}`;

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
          <path d="M0,1 L10,5 L0,9 z" fill="#fff200" />
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
      {/* Dim the diagram slightly so the trace pops. */}
      {trace.holeImage && (
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="rgba(15,31,15,0.32)"
        />
      )}

      {/* Non-key segments: faded white, dashed — the lead-in context. */}
      {segments.map((s, i) =>
        i === keyI ? null : (
          <path
            key={`bg${i}`}
            d={arcPath(s, px, py)}
            stroke="rgba(255,255,255,0.65)"
            strokeWidth={1.6 * sc}
            strokeLinecap="round"
            strokeDasharray={`${3 * sc} ${2.4 * sc}`}
            fill="none"
          />
        ),
      )}

      {/* Key segment: solid bright yellow with a dark outline so it
          stays legible on green turf, light fairway, or shadow. */}
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
        markerEnd={`url(#${uid}-arrow)`}
      />

      {/* Landing dots on non-key segments only — the key has an arrow. */}
      {segments.map((s, i) =>
        i === keyI ? null : (
          <circle
            key={`d${i}`}
            cx={px(s.toX)}
            cy={py(s.toY)}
            r={2 * sc}
            fill="rgba(255,255,255,0.85)"
          />
        ),
      )}

      {/* Start dot for the key segment — outlined bright yellow. */}
      <circle
        cx={px(key.fromX)}
        cy={py(key.fromY)}
        r={3 * sc}
        fill="#fff200"
        stroke="rgba(20,15,5,0.9)"
        strokeWidth={1.2 * sc}
      />

      {/* Tee marker if the tee shot exists and isn't the key segment. */}
      {keyI !== 0 && (
        <circle
          cx={px(first.fromX)}
          cy={py(first.fromY)}
          r={2.6 * sc}
          fill="#7BAE3F"
          stroke="#ffffff"
          strokeWidth={1 * sc}
        />
      )}

      {/* Flag at the hole. */}
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
