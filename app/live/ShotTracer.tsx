"use client";

import type { ShotTrace } from "@/lib/feed/shot-trace";

/**
 * A small broadcast-style shot tracer drawn from normalised 0-1 shot
 * coordinates on the hole's overhead view.
 *
 * - `thumb` mode frames tight around the *key* segment (the stuffed
 *   approach / the long putt / the hole-out) so the card shows the
 *   shot that matters, not the whole hole flat.
 * - `full` mode shows the whole hole with the key segment highlighted.
 *
 * We don't have the real hole-diagram image (the PGA Tour CDN path
 * doesn't resolve publicly), so the backdrop is a clean gradient —
 * the trace is the story.
 */

const W = 200;
const H = 112;

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
  let vb = { x: 0, y: 0, w: W, h: H };
  if (mode === "thumb") {
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

  return (
    <svg
      className="tracer"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="tracer-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3f7d3a" />
          <stop offset="100%" stopColor="#2c5a28" />
        </linearGradient>
      </defs>

      <rect x={0} y={0} width={W} height={H} fill="url(#tracer-turf)" />

      {/* the green — a soft disc around the final resting point */}
      <circle
        cx={px(last.toX)}
        cy={py(last.toY)}
        r={15 * sc}
        fill="rgba(255,255,255,0.16)"
      />

      {/* shot lines — key segment bright + bold, the rest faded */}
      {segments.map((s, i) => {
        const isKey = i === keyI;
        return (
          <g key={i} opacity={isKey ? 1 : 0.42}>
            <line
              x1={px(s.fromX)}
              y1={py(s.fromY)}
              x2={px(s.toX)}
              y2={py(s.toY)}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={(isKey ? 6.5 : 3.5) * sc}
              strokeLinecap="round"
            />
            <line
              x1={px(s.fromX)}
              y1={py(s.fromY)}
              x2={px(s.toX)}
              y2={py(s.toY)}
              stroke={s.kind === "putt" ? "#ffd64a" : "#ffffff"}
              strokeWidth={(isKey ? 2.8 : 1.4) * sc}
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {/* landing dots */}
      {segments.map((s, i) => (
        <circle
          key={`d${i}`}
          cx={px(s.toX)}
          cy={py(s.toY)}
          r={(i === keyI ? 3.6 : 2.2) * sc}
          fill="#ffffff"
        />
      ))}

      {/* tee marker */}
      <circle
        cx={px(first.fromX)}
        cy={py(first.fromY)}
        r={3.4 * sc}
        fill="#7BAE3F"
        stroke="#ffffff"
        strokeWidth={1.2 * sc}
      />

      {/* flag at the hole */}
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
