"use client";

import type { ShotTraceSegment } from "@/lib/feed/shot-trace";

/**
 * A small broadcast-style shot tracer. Strokes come in as normalised
 * 0-1 coordinates on the hole's left-to-right overhead view; we draw
 * them on a stylised fairway — tee marker, connected shot lines,
 * landing dots, and a flag at the hole.
 *
 * We don't have the real hole-diagram image (the PGA Tour CDN path
 * doesn't resolve publicly), so the background is a clean gradient
 * rather than the photographed hole — the *trace* is the story.
 */

const W = 200;
const H = 112;

export default function ShotTracer({
  trace,
}: {
  trace: ShotTraceSegment[];
}) {
  if (trace.length === 0) return null;

  const px = (x: number) => x * W;
  const py = (y: number) => y * H;

  const first = trace[0];
  const last = trace[trace.length - 1];

  return (
    <svg
      className="tracer"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="tracer-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3f7d3a" />
          <stop offset="100%" stopColor="#2c5a28" />
        </linearGradient>
      </defs>

      <rect width={W} height={H} fill="url(#tracer-turf)" />

      {/* the green — a soft disc around the final resting point */}
      <circle
        cx={px(last.toX)}
        cy={py(last.toY)}
        r={16}
        fill="rgba(255,255,255,0.16)"
      />

      {/* shot lines — a faint wide stroke under a bright thin one for glow */}
      {trace.map((s, i) => (
        <g key={i}>
          <line
            x1={px(s.fromX)}
            y1={py(s.fromY)}
            x2={px(s.toX)}
            y2={py(s.toY)}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <line
            x1={px(s.fromX)}
            y1={py(s.fromY)}
            x2={px(s.toX)}
            y2={py(s.toY)}
            stroke={s.kind === "putt" ? "#ffd64a" : "#ffffff"}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </g>
      ))}

      {/* landing dots */}
      {trace.map((s, i) => (
        <circle
          key={`d${i}`}
          cx={px(s.toX)}
          cy={py(s.toY)}
          r={2.6}
          fill="#ffffff"
        />
      ))}

      {/* tee marker */}
      <circle
        cx={px(first.fromX)}
        cy={py(first.fromY)}
        r={3.4}
        fill="#7BAE3F"
        stroke="#ffffff"
        strokeWidth={1.2}
      />

      {/* flag at the hole */}
      <g
        transform={`translate(${px(last.toX)} ${py(last.toY)})`}
        stroke="#ffffff"
        strokeWidth={1.4}
      >
        <line x1={0} y1={0} x2={0} y2={-11} />
        <path d="M0,-11 L7,-8.5 L0,-6 Z" fill="#d23b3b" stroke="none" />
      </g>
    </svg>
  );
}
