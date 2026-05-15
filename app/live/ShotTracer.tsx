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

// Single bright accent colour for putts — matches the PGA Tour
// imaging look. Numbered chips at each at-rest position carry the
// "which putt was this" information; no need for colour progression.
const PUTT_COLOR = "#2ea7f0";

function curvePath(
  s: ShotTraceSegment,
  px: (x: number) => number,
  py: (y: number) => number,
): string {
  const fx = px(s.fromX);
  const fy = py(s.fromY);
  const tx = px(s.toX);
  const ty = py(s.toY);
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return `M${fx},${fy} L${tx},${ty}`;

  // Perpendicular unit vector (rotated 90° left).
  let nx = -dy / len;
  let ny = dx / len;
  // Always bulge toward the top of the frame so the arc reads
  // consistently no matter the shot direction.
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  // Shots arc through the air; putts roll on the green and curve
  // gently with break. Smaller bulge for putts.
  const arcHeight = len * (s.kind === "putt" ? 0.08 : 0.18);
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

  // Frame around the action so the strokes that matter are big enough
  // to read. For putt traces (long putt, 3-putt) frame around all the
  // putts — otherwise a 3-putt's misses get lost on a giant green
  // diagram. For other traces frame around the key segment.
  //
  // - thumb mode: always zoom (the reel card is small).
  // - full (modal) mode: zoom when the trace is already a green-zoom
  //   diagram (otherwise the putts are dwarfed by the green); show the
  //   whole hole when the backdrop IS the whole hole.
  const framingPutts = segments.filter((s) => s.kind === "putt");
  const framingSegs =
    framingPutts.length > 0 ? framingPutts : [key];
  const shouldZoom = mode === "thumb" || trace.fullFrame;

  let vb = { x: 0, y: 0, w: W, h: H };
  if (shouldZoom) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of framingSegs) {
      minX = Math.min(minX, s.fromX, s.toX);
      maxX = Math.max(maxX, s.fromX, s.toX);
      minY = Math.min(minY, s.fromY, s.toY);
      maxY = Math.max(maxY, s.fromY, s.toY);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    // Wider padding in the modal so it feels less cramped; tighter in
    // the thumb where every pixel counts.
    const padFactor = mode === "full" ? 0.9 : 0.6;
    const minPad = mode === "full" ? 0.14 : 0.1;
    const padX = Math.max(minPad, spanX * padFactor);
    const padY = Math.max(minPad, spanY * padFactor);
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

  // Assign each putt segment its sequential putt index (0-based).
  const puttIdxBy = new Map<number, number>();
  let puttCount = 0;
  segments.forEach((s, i) => {
    if (s.kind === "putt") {
      puttIdxBy.set(i, puttCount);
      puttCount++;
    }
  });

  // The holing stroke is the last segment — it ends in the cup.
  const holingIdx = segments.length - 1;
  const holingIsPutt = segments[holingIdx].kind === "putt";

  // Unique-per-render IDs so multiple tracers on a page don't share
  // <defs> (the modal stacks on top of the thumb).
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
            d={curvePath(s, px, py)}
            stroke="rgba(255,255,255,0.65)"
            strokeWidth={1.6 * sc}
            strokeLinecap="round"
            strokeDasharray={`${3 * sc} ${2.4 * sc}`}
            fill="none"
          />
        );
      })}

      {/* Pass 2: putts — smooth solid bright-blue curves, with a thin
          white halo behind for legibility on the green texture. */}
      {segments.map((s, i) => {
        if (s.kind !== "putt") return null;
        return (
          <g key={`putt${i}`}>
            <path
              d={curvePath(s, px, py)}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={4.8 * sc}
              strokeLinecap="round"
              fill="none"
            />
            <path
              d={curvePath(s, px, py)}
              stroke={PUTT_COLOR}
              strokeWidth={2.4 * sc}
              strokeLinecap="round"
              fill="none"
            />
          </g>
        );
      })}

      {/* Pass 3: the key non-putt segment — solid bright yellow + outline. */}
      {key.kind !== "putt" && (
        <>
          <path
            d={curvePath(key, px, py)}
            stroke="rgba(20,15,5,0.85)"
            strokeWidth={5 * sc}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d={curvePath(key, px, py)}
            stroke="#fff200"
            strokeWidth={2.6 * sc}
            strokeLinecap="round"
            fill="none"
            markerEnd={
              keyI === holingIdx ? `url(#${uid}-arrow)` : undefined
            }
          />
        </>
      )}

      {/* Numbered chips at each putt's at-rest position (PGA-style).
          Skip the holing putt — its destination is the cup, marked by
          the flag below. Skip entirely when there's only one putt. */}
      {puttCount > 1 &&
        segments.map((s, i) => {
          if (s.kind !== "putt") return null;
          if (i === holingIdx) return null;
          const n = (puttIdxBy.get(i) ?? 0) + 1;
          return (
            <g key={`pn${i}`}>
              <circle
                cx={px(s.toX)}
                cy={py(s.toY)}
                r={4.2 * sc}
                fill={PUTT_COLOR}
                stroke="#ffffff"
                strokeWidth={1.2 * sc}
              />
              <text
                x={px(s.toX)}
                y={py(s.toY) + 1.7 * sc}
                textAnchor="middle"
                fontSize={4.6 * sc}
                fontWeight="900"
                fill="#ffffff"
              >
                {n}
              </text>
            </g>
          );
        })}

      {/* Landing dots on supporting shots — quieter than the putt chips. */}
      {segments.map((s, i) => {
        if (s.kind === "putt" || i === keyI || i === holingIdx) return null;
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

      {/* Start dot on the first segment's ball position — matches the
          tracker style when there's a clear "ball started here". */}
      <circle
        cx={px(first.fromX)}
        cy={py(first.fromY)}
        r={3 * sc}
        fill={holingIsPutt ? PUTT_COLOR : "#ffffff"}
        stroke="#ffffff"
        strokeWidth={1.2 * sc}
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
