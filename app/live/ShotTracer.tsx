"use client";

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type WheelEvent as RWheelEvent,
} from "react";
import type { ShotTrace, ShotTraceSegment } from "@/lib/feed/shot-trace";

/**
 * Broadcast-style shot tracer drawn from normalised 0-1 shot
 * coordinates on the hole's overhead view.
 *
 * - `thumb` mode is a static SVG sized for reel cards — framed tight
 *   around the key segment / putt action.
 * - `full` mode wraps the same render in an interactive surface:
 *   pinch + drag on touch, scroll-wheel on desktop, double-tap to
 *   snap back to default framing. A "Reset" pill appears when the
 *   user has zoomed/panned away from default.
 *
 * Visual language (PGA Tour tracker-style):
 * - Putts: smooth solid curves, colour-progressing yellow → orange →
 *   red → deep red across the putt sequence with numbered chips at
 *   each at-rest position.
 * - Non-putt story shot: solid bright yellow arc with a dark outline
 *   and an arrow at the cup; supporting strokes are faded dashed
 *   white.
 */

const W = 200;
const H = 112;
const PUTT_COLORS = ["#ffd200", "#ff8a1f", "#ff3a2f", "#b3140e"];

function puttColor(n: number): string {
  return PUTT_COLORS[Math.min(n, PUTT_COLORS.length - 1)];
}

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
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  // Shots arc through the air; putts roll on the green with break.
  const arcHeight = len * (s.kind === "putt" ? 0.08 : 0.18);
  const cx = (fx + tx) / 2 + nx * arcHeight;
  const cy = (fy + ty) / 2 + ny * arcHeight;
  return `M${fx},${fy} Q${cx},${cy} ${tx},${ty}`;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function framingFor(trace: ShotTrace, mode: "thumb" | "full"): ViewBox {
  const { segments, keyIndex } = trace;
  if (segments.length === 0) return { x: 0, y: 0, w: W, h: H };
  const keyI = keyIndex >= 0 ? keyIndex : segments.length - 1;
  const key = segments[keyI];
  const framingPutts = segments.filter((s) => s.kind === "putt");
  const framingSegs = framingPutts.length > 0 ? framingPutts : [key];
  const shouldZoom = mode === "thumb" || trace.fullFrame;
  if (!shouldZoom) return { x: 0, y: 0, w: W, h: H };

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
  const padFactor = mode === "full" ? 0.9 : 0.6;
  const minPad = mode === "full" ? 0.14 : 0.1;
  const padX = Math.max(minPad, spanX * padFactor);
  const padY = Math.max(minPad, spanY * padFactor);
  minX = Math.max(0, minX - padX);
  maxX = Math.min(1, maxX + padX);
  minY = Math.max(0, minY - padY);
  maxY = Math.min(1, maxY + padY);
  return {
    x: minX * W,
    y: minY * H,
    w: (maxX - minX) * W,
    h: (maxY - minY) * H,
  };
}

const MIN_W = W * 0.08; // up to ~12× zoom in
const MAX_W = W;
const MIN_H = H * 0.08;
const MAX_H = H;

function clampVb(v: ViewBox): ViewBox {
  const w = Math.max(MIN_W, Math.min(MAX_W, v.w));
  const h = Math.max(MIN_H, Math.min(MAX_H, v.h));
  const x = Math.max(0, Math.min(W - w, v.x));
  const y = Math.max(0, Math.min(H - h, v.y));
  return { x, y, w, h };
}

function vbsEqual(a: ViewBox, b: ViewBox): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}

export default function ShotTracer({
  trace,
  mode = "thumb",
}: {
  trace: ShotTrace;
  mode?: "thumb" | "full";
}) {
  if (trace.segments.length === 0) return null;
  const initialVb = framingFor(trace, mode);
  if (mode === "thumb") {
    return <TracerSvg trace={trace} vb={initialVb} />;
  }
  return <InteractiveTracer trace={trace} initialVb={initialVb} />;
}

type Gesture =
  | {
      kind: "pan";
      lastClient: { x: number; y: number };
    }
  | {
      kind: "pinch";
      initialDist: number;
      initialMidVb: { x: number; y: number };
      initialVb: ViewBox;
    }
  | null;

function InteractiveTracer({
  trace,
  initialVb,
}: {
  trace: ShotTrace;
  initialVb: ViewBox;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vb, setVb] = useState<ViewBox>(initialVb);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const gestureRef = useRef<Gesture>(null);
  const lastTapRef = useRef<number>(0);
  const interactedRef = useRef<boolean>(false);
  const [showHint, setShowHint] = useState(true);

  const clientToVb = useCallback(
    (clientX: number, clientY: number, currentVb: ViewBox) => {
      const rect = containerRef.current!.getBoundingClientRect();
      return {
        x:
          currentVb.x + ((clientX - rect.left) / rect.width) * currentVb.w,
        y:
          currentVb.y + ((clientY - rect.top) / rect.height) * currentVb.h,
      };
    },
    [],
  );

  const dismissHint = useCallback(() => {
    if (!interactedRef.current) {
      interactedRef.current = true;
      setShowHint(false);
    }
  }, []);

  const startGestureFromPointers = useCallback(() => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length === 1) {
      gestureRef.current = {
        kind: "pan",
        lastClient: { x: pts[0].x, y: pts[0].y },
      };
    } else if (pts.length >= 2) {
      const [p1, p2] = pts;
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const midClient = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      };
      const midVb = clientToVb(midClient.x, midClient.y, vb);
      gestureRef.current = {
        kind: "pinch",
        initialDist: dist,
        initialMidVb: midVb,
        initialVb: vb,
      };
    } else {
      gestureRef.current = null;
    }
  }, [vb, clientToVb]);

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      containerRef.current.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      startGestureFromPointers();
      dismissHint();
    },
    [startGestureFromPointers, dismissHint],
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gestureRef.current;
      if (!g || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (g.kind === "pan" && pointersRef.current.size === 1) {
        const dx = e.clientX - g.lastClient.x;
        const dy = e.clientY - g.lastClient.y;
        const dxVb = (-dx * vb.w) / rect.width;
        const dyVb = (-dy * vb.h) / rect.height;
        const next = clampVb({
          x: vb.x + dxVb,
          y: vb.y + dyVb,
          w: vb.w,
          h: vb.h,
        });
        setVb(next);
        gestureRef.current = {
          kind: "pan",
          lastClient: { x: e.clientX, y: e.clientY },
        };
      } else if (g.kind === "pinch" && pointersRef.current.size >= 2) {
        const [p1, p2] = Array.from(pointersRef.current.values());
        const newDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (newDist < 1) return;
        const scale = g.initialDist / newDist;
        const newW = g.initialVb.w * scale;
        const newH = g.initialVb.h * scale;
        const midClient = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2,
        };
        // Anchor the initial midpoint-in-vb-coords under the current
        // midpoint-in-client-coords.
        const newX =
          g.initialMidVb.x - ((midClient.x - rect.left) / rect.width) * newW;
        const newY =
          g.initialMidVb.y -
          ((midClient.y - rect.top) / rect.height) * newH;
        setVb(clampVb({ x: newX, y: newY, w: newW, h: newH }));
      }
    },
    [vb],
  );

  const onPointerUp = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size === 0) {
        const now = Date.now();
        if (now - lastTapRef.current < 320) {
          // Double-tap → snap back to default framing.
          setVb(initialVb);
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
        }
        gestureRef.current = null;
      } else {
        startGestureFromPointers();
      }
    },
    [initialVb, startGestureFromPointers],
  );

  const onWheel = useCallback(
    (e: RWheelEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cursorVb = clientToVb(e.clientX, e.clientY, vb);
      const scale = Math.exp(e.deltaY * 0.0018);
      const newW = vb.w * scale;
      const newH = vb.h * scale;
      const newX =
        cursorVb.x - ((e.clientX - rect.left) / rect.width) * newW;
      const newY =
        cursorVb.y - ((e.clientY - rect.top) / rect.height) * newH;
      setVb(clampVb({ x: newX, y: newY, w: newW, h: newH }));
      dismissHint();
    },
    [vb, clientToVb, dismissHint],
  );

  const showReset = !vbsEqual(vb, initialVb);

  return (
    <div
      ref={containerRef}
      className="tracer-interactive"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ touchAction: "none" }}
    >
      <TracerSvg trace={trace} vb={vb} />
      {showReset && (
        <button
          type="button"
          className="tracer-reset"
          onClick={(e) => {
            e.stopPropagation();
            setVb(initialVb);
          }}
        >
          ⤺ Reset
        </button>
      )}
      {showHint && (
        <span className="tracer-hint" aria-hidden="true">
          Pinch · drag · scroll to explore
        </span>
      )}
    </div>
  );
}

function TracerSvg({ trace, vb }: { trace: ShotTrace; vb: ViewBox }) {
  const { segments, keyIndex } = trace;
  const px = (x: number) => x * W;
  const py = (y: number) => y * H;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const keyI = keyIndex >= 0 ? keyIndex : segments.length - 1;
  const key = segments[keyI];

  // Scale stroke widths so they look consistent when zoomed.
  const sc = (vb.w / W + vb.h / H) / 2;

  const puttIdxBy = new Map<number, number>();
  let puttCount = 0;
  segments.forEach((s, i) => {
    if (s.kind === "putt") {
      puttIdxBy.set(i, puttCount);
      puttCount++;
    }
  });
  const holingIdx = segments.length - 1;
  const holingIsPutt = segments[holingIdx].kind === "putt";

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
        {/* Decorative grass-grain texture for green-zoom views — short
            bright dashes at varied angles, tiled across the visible
            area. Reads as broadcast-style green texture; doesn't claim
            slope. Uses userSpaceOnUse so the tile size is in SVG
            units; when the user pinches in (smaller viewBox), more
            ticks fit per visible area, giving a natural
            denser-when-zoomed feel. */}
        <pattern
          id={`${uid}-grain`}
          width="2.6"
          height="2.6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(11)"
        >
          <line
            x1="0.3"
            y1="0.2"
            x2="0.45"
            y2="0.95"
            stroke="#f5f2dc"
            strokeWidth="0.22"
            strokeLinecap="round"
          />
          <line
            x1="1.5"
            y1="0.7"
            x2="1.7"
            y2="1.45"
            stroke="#f5f2dc"
            strokeWidth="0.22"
            strokeLinecap="round"
          />
          <line
            x1="2.3"
            y1="0.15"
            x2="2.2"
            y2="0.85"
            stroke="#f5f2dc"
            strokeWidth="0.2"
            strokeLinecap="round"
          />
          <line
            x1="0.75"
            y1="1.65"
            x2="0.9"
            y2="2.35"
            stroke="#f5f2dc"
            strokeWidth="0.22"
            strokeLinecap="round"
          />
          <line
            x1="1.95"
            y1="1.9"
            x2="2.1"
            y2="2.55"
            stroke="#f5f2dc"
            strokeWidth="0.2"
            strokeLinecap="round"
          />
        </pattern>
      </defs>

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

      {/* Grass-grain texture overlay — only on green-zoom traces.
          Solid opacity (no blend mode — blend modes on SVG are flaky
          across browsers and made the ticks invisible on lighter
          grass). The off-white tint reads as sun-lit grass blades. */}
      {trace.fullFrame && (
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill={`url(#${uid}-grain)`}
          opacity="0.9"
        />
      )}

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

      {segments.map((s, i) => {
        if (s.kind !== "putt") return null;
        const n = puttIdxBy.get(i) ?? 0;
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
              stroke={puttColor(n)}
              strokeWidth={2.4 * sc}
              strokeLinecap="round"
              fill="none"
            />
          </g>
        );
      })}

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

      {puttCount > 1 &&
        segments.map((s, i) => {
          if (s.kind !== "putt") return null;
          if (i === holingIdx) return null;
          const idx = puttIdxBy.get(i) ?? 0;
          const n = idx + 1;
          return (
            <g key={`pn${i}`}>
              <circle
                cx={px(s.toX)}
                cy={py(s.toY)}
                r={4.2 * sc}
                fill={puttColor(idx)}
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

      <circle
        cx={px(first.fromX)}
        cy={py(first.fromY)}
        r={3 * sc}
        fill={holingIsPutt ? puttColor(0) : "#ffffff"}
        stroke="#ffffff"
        strokeWidth={1.2 * sc}
      />

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
