"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

interface Row {
  dgId: string;
  name: string;
  teeTime: string;
  teeMinutes: number;
  sgTotal: number;
  toPar: number;
  adjusted: number;
  thru: string | number;
  startHole: number;
}

interface ChartProps {
  rows: Row[];
}

/** Gaussian-weighted rolling mean (double pass) for a smooth trend line. */
function rollingSmooth(
  points: Array<{ x: number; y: number }>,
  bandwidthMins: number,
): Array<{ x: number; y: number }> {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const gaussPass = (
    src: Array<{ x: number; y: number }>,
    sigma: number,
  ) => {
    const twoSigmaSq = 2 * sigma * sigma;
    return src.map((p) => {
      let num = 0;
      let den = 0;
      for (const q of src) {
        const dx = q.x - p.x;
        const w = Math.exp(-(dx * dx) / twoSigmaSq);
        num += w * q.y;
        den += w;
      }
      return { x: p.x, y: den > 0 ? num / den : p.y };
    });
  };
  return gaussPass(gaussPass(sorted, bandwidthMins), bandwidthMins * 0.5);
}

interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const MIN_X_SPAN = 15; // 15-minute floor so you can't zoom past uselessness
const MIN_Y_SPAN = 0.5;
const MAX_X_ZOOM_FACTOR = 8;
const MAX_Y_ZOOM_FACTOR = 8;

export default function Chart({ rows }: ChartProps) {
  const [hover, setHover] = useState<Row | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const width = 820;
  const height = 460;
  const padL = 56;
  const padR = 20;
  const padT = 24;
  const padB = 46;
  const iw = width - padL - padR;
  const ih = height - padT - padB;

  const points = useMemo(
    () => rows.map((r) => ({ x: r.teeMinutes, y: r.adjusted, row: r })),
    [rows],
  );

  // Data extent (used for the "reset" state + zoom clamps).
  const extent = useMemo(() => {
    if (points.length === 0) {
      return { xMin: 0, xMax: 60, yMin: -1, yMax: 1 };
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yPad = 0.5;
    const yRaw = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys)));
    const yBound = yRaw + yPad;
    return { xMin, xMax, yMin: -yBound, yMax: yBound };
  }, [points]);

  const [viewport, setViewport] = useState<Viewport>(extent);
  // Whenever the data extent widens (players finish), keep the current
  // zoom but expand the outer clamp accordingly.
  useEffect(() => {
    setViewport((prev) => {
      // Snap-to-full when the previous viewport was the previous extent.
      const looksLikeReset =
        Math.abs(prev.xMin - prev.xMax) < 1 ||
        (Math.abs(prev.xMin) < 1 && Math.abs(prev.xMax) < 1);
      if (looksLikeReset) return extent;
      return prev;
    });
  }, [extent]);

  const xFor = useCallback(
    (v: number) =>
      padL +
      ((v - viewport.xMin) / Math.max(1, viewport.xMax - viewport.xMin)) * iw,
    [padL, iw, viewport.xMin, viewport.xMax],
  );
  const yFor = useCallback(
    (v: number) =>
      padT + ((viewport.yMax - v) / (viewport.yMax - viewport.yMin)) * ih,
    [padT, ih, viewport.yMin, viewport.yMax],
  );
  const dataXFor = useCallback(
    (svgX: number) =>
      viewport.xMin +
      ((svgX - padL) / iw) * (viewport.xMax - viewport.xMin),
    [padL, iw, viewport.xMin, viewport.xMax],
  );
  const dataYFor = useCallback(
    (svgY: number) =>
      viewport.yMax -
      ((svgY - padT) / ih) * (viewport.yMax - viewport.yMin),
    [padT, ih, viewport.yMin, viewport.yMax],
  );

  const smooth = useMemo(
    () => rollingSmooth(points.map((p) => ({ x: p.x, y: p.y })), 60),
    [points],
  );
  const smoothPath = smooth
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.x)} ${yFor(p.y)}`)
    .join(" ");

  // Adaptive tick spacing so ticks don't crowd when zoomed in.
  const xSpan = viewport.xMax - viewport.xMin;
  const xStep =
    xSpan > 480 ? 60 : xSpan > 240 ? 30 : xSpan > 120 ? 15 : 5;
  const xTickStart = Math.ceil(viewport.xMin / xStep) * xStep;
  const xTicks: number[] = [];
  for (let t = xTickStart; t <= viewport.xMax; t += xStep) xTicks.push(t);

  const yTicks: number[] = [];
  const yTop = Math.ceil(viewport.yMax);
  const yBot = Math.floor(viewport.yMin);
  for (let y = yBot; y <= yTop; y++) yTicks.push(y);

  const formatClock = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const formatSigned = (v: number) => {
    if (Math.abs(v) < 0.05) return "0";
    return v > 0 ? `+${v.toFixed(1)}` : `−${Math.abs(v).toFixed(1)}`;
  };

  // ── Interaction state ──────────────────────────────────────────
  // Pointer drag pan + multi-pointer pinch zoom.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragOriginRef = useRef<{
    viewport: Viewport;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const pinchOriginRef = useRef<{
    viewport: Viewport;
    centerX: number;
    centerY: number;
    dist: number;
  } | null>(null);

  const clampViewport = useCallback(
    (v: Viewport): Viewport => {
      const xSpan = v.xMax - v.xMin;
      const ySpan = v.yMax - v.yMin;
      const maxXSpan = (extent.xMax - extent.xMin) * MAX_X_ZOOM_FACTOR;
      const maxYSpan = (extent.yMax - extent.yMin) * MAX_Y_ZOOM_FACTOR;
      let xMin = v.xMin;
      let xMax = v.xMax;
      let yMin = v.yMin;
      let yMax = v.yMax;
      if (xSpan < MIN_X_SPAN) {
        const c = (xMin + xMax) / 2;
        xMin = c - MIN_X_SPAN / 2;
        xMax = c + MIN_X_SPAN / 2;
      }
      if (ySpan < MIN_Y_SPAN) {
        const c = (yMin + yMax) / 2;
        yMin = c - MIN_Y_SPAN / 2;
        yMax = c + MIN_Y_SPAN / 2;
      }
      if (xMax - xMin > maxXSpan) {
        const c = (xMin + xMax) / 2;
        xMin = c - maxXSpan / 2;
        xMax = c + maxXSpan / 2;
      }
      if (yMax - yMin > maxYSpan) {
        const c = (yMin + yMax) / 2;
        yMin = c - maxYSpan / 2;
        yMax = c + maxYSpan / 2;
      }
      return { xMin, xMax, yMin, yMax };
    },
    [extent],
  );

  const pointerCoords = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (width / rect.width);
    const sy = (e.clientY - rect.top) * (height / rect.height);
    return { x: sx, y: sy };
  }, [width, height]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = pointerCoords(e);
    pointersRef.current.set(e.pointerId, p);
    const pts = [...pointersRef.current.values()];
    if (pts.length === 1) {
      dragOriginRef.current = {
        viewport: { ...viewport },
        pointerX: p.x,
        pointerY: p.y,
      };
      pinchOriginRef.current = null;
    } else if (pts.length === 2) {
      dragOriginRef.current = null;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchOriginRef.current = {
        viewport: { ...viewport },
        centerX: (pts[0].x + pts[1].x) / 2,
        centerY: (pts[0].y + pts[1].y) / 2,
        dist: Math.max(1, Math.hypot(dx, dy)),
      };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const p = pointerCoords(e);
    pointersRef.current.set(e.pointerId, p);
    const pts = [...pointersRef.current.values()];

    if (pts.length === 1 && dragOriginRef.current) {
      const o = dragOriginRef.current;
      const dxPx = p.x - o.pointerX;
      const dyPx = p.y - o.pointerY;
      const dxData = -(dxPx / iw) * (o.viewport.xMax - o.viewport.xMin);
      const dyData = (dyPx / ih) * (o.viewport.yMax - o.viewport.yMin);
      setViewport(
        clampViewport({
          xMin: o.viewport.xMin + dxData,
          xMax: o.viewport.xMax + dxData,
          yMin: o.viewport.yMin + dyData,
          yMax: o.viewport.yMax + dyData,
        }),
      );
    } else if (pts.length === 2 && pinchOriginRef.current) {
      const o = pinchOriginRef.current;
      const dxNow = pts[0].x - pts[1].x;
      const dyNow = pts[0].y - pts[1].y;
      const distNow = Math.max(1, Math.hypot(dxNow, dyNow));
      const scale = o.dist / distNow;
      const cxData =
        o.viewport.xMin +
        ((o.centerX - padL) / iw) * (o.viewport.xMax - o.viewport.xMin);
      const cyData =
        o.viewport.yMax -
        ((o.centerY - padT) / ih) * (o.viewport.yMax - o.viewport.yMin);
      const newXSpan = (o.viewport.xMax - o.viewport.xMin) * scale;
      const newYSpan = (o.viewport.yMax - o.viewport.yMin) * scale;
      setViewport(
        clampViewport({
          xMin: cxData - newXSpan / 2,
          xMax: cxData + newXSpan / 2,
          yMin: cyData - newYSpan / 2,
          yMax: cyData + newYSpan / 2,
        }),
      );
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      dragOriginRef.current = null;
      pinchOriginRef.current = null;
    }
  };

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (width / rect.width);
    const sy = (e.clientY - rect.top) * (height / rect.height);
    // Deltas from a trackpad are small; normalise so the same input
    // gives similar zoom per event across devices.
    const scale = Math.exp(e.deltaY * 0.001);
    const cx = dataXFor(sx);
    const cy = dataYFor(sy);
    const newXSpan = (viewport.xMax - viewport.xMin) * scale;
    const newYSpan = (viewport.yMax - viewport.yMin) * scale;
    setViewport(
      clampViewport({
        xMin: cx - (cx - viewport.xMin) * scale,
        xMax: cx + (viewport.xMax - cx) * scale,
        yMin: cy - (cy - viewport.yMin) * scale,
        yMax: cy + (viewport.yMax - cy) * scale,
      }),
    );
    // Silence unused warnings for locals only used for readability.
    void newXSpan;
    void newYSpan;
  };

  // Zoom buttons — centre-scale by 1.5×.
  const zoomBy = (factor: number) => {
    const cx = (viewport.xMin + viewport.xMax) / 2;
    const cy = (viewport.yMin + viewport.yMax) / 2;
    const newXSpan = (viewport.xMax - viewport.xMin) * factor;
    const newYSpan = (viewport.yMax - viewport.yMin) * factor;
    setViewport(
      clampViewport({
        xMin: cx - newXSpan / 2,
        xMax: cx + newXSpan / 2,
        yMin: cy - newYSpan / 2,
        yMax: cy + newYSpan / 2,
      }),
    );
  };

  const isZoomed =
    Math.abs(viewport.xMin - extent.xMin) > 0.01 ||
    Math.abs(viewport.xMax - extent.xMax) > 0.01 ||
    Math.abs(viewport.yMin - extent.yMin) > 0.01 ||
    Math.abs(viewport.yMax - extent.yMax) > 0.01;

  // Only render points inside the viewport (± small margin for edge cases).
  const visiblePoints = points.filter(
    (p) =>
      p.x >= viewport.xMin - 1 &&
      p.x <= viewport.xMax + 1 &&
      p.y >= viewport.yMin - 0.1 &&
      p.y <= viewport.yMax + 0.1,
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => zoomBy(0.66)}
          style={btnStyle}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.5)}
          style={btnStyle}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setViewport(extent)}
          style={{
            ...btnStyle,
            opacity: isZoomed ? 1 : 0.4,
            cursor: isZoomed ? "pointer" : "default",
          }}
          disabled={!isZoomed}
          aria-label="Reset zoom"
        >
          Reset
        </button>
        <span
          style={{
            fontSize: 11,
            color: "oklch(0.55 0.02 150)",
            alignSelf: "center",
            marginLeft: 8,
          }}
        >
          Drag to pan · scroll to zoom · pinch on mobile
        </span>
      </div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          background: "white",
          border: "1px solid oklch(0.9 0.008 95)",
          borderRadius: 8,
          maxWidth: "100%",
          height: "auto",
          touchAction: "none",
          cursor: dragOriginRef.current ? "grabbing" : "grab",
        }}
        onMouseLeave={() => setHover(null)}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Clip the chart interior so panned points don't spill onto axes. */}
        <defs>
          <clipPath id="chart-clip">
            <rect x={padL} y={padT} width={iw} height={ih} />
          </clipPath>
        </defs>

        {/* y-axis grid + labels */}
        {yTicks.map((y) => (
          <g key={y}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yFor(y)}
              y2={yFor(y)}
              stroke={y === 0 ? "#94a3b8" : "#eef0f2"}
              strokeWidth={y === 0 ? 1.5 : 1}
              strokeDasharray={y === 0 ? undefined : "3 3"}
            />
            <text
              x={padL - 8}
              y={yFor(y) + 4}
              textAnchor="end"
              fontSize={11}
              fill="#64748b"
              fontFamily="var(--font-mono, monospace)"
            >
              {formatSigned(y)}
            </text>
          </g>
        ))}

        {xTicks.map((t) => (
          <g key={t}>
            <line
              x1={xFor(t)}
              x2={xFor(t)}
              y1={padT}
              y2={height - padB}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            <text
              x={xFor(t)}
              y={height - padB + 16}
              textAnchor="middle"
              fontSize={11}
              fill="#64748b"
              fontFamily="var(--font-mono, monospace)"
            >
              {formatClock(t)}
            </text>
          </g>
        ))}

        <text
          x={12}
          y={padT + ih / 2}
          transform={`rotate(-90 12 ${padT + ih / 2})`}
          textAnchor="middle"
          fontSize={11}
          fill="#64748b"
        >
          Skill-adjusted R1 (strokes)
        </text>
        <text
          x={padL + iw / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize={11}
          fill="#64748b"
        >
          Tee time
        </text>

        <g clipPath="url(#chart-clip)">
          <path
            d={smoothPath}
            fill="none"
            stroke="#0284c7"
            strokeWidth={2.5}
            opacity={0.7}
          />

          {visiblePoints.map((p) => {
            const y = p.y;
            const color =
              y < -0.3 ? "#059669" : y > 0.3 ? "#dc2626" : "#334155";
            const isHover = hover?.dgId === p.row.dgId;
            return (
              <circle
                key={p.row.dgId}
                cx={xFor(p.x)}
                cy={yFor(y)}
                r={isHover ? 6 : 3.5}
                fill={color}
                opacity={isHover ? 1 : 0.75}
                stroke={isHover ? "white" : "none"}
                strokeWidth={2}
                onPointerEnter={() => setHover(p.row)}
              />
            );
          })}
        </g>
      </svg>

      {hover && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: "1px solid oklch(0.9 0.008 95)",
            borderRadius: 8,
            fontSize: 13,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 12,
            rowGap: 4,
            maxWidth: 480,
          }}
        >
          <strong>{hover.name}</strong>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>
            teed off {hover.teeTime} · start hole {hover.startHole} · thru{" "}
            {hover.thru}
          </span>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>Skill</span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 700,
            }}
          >
            SG total {formatSigned(hover.sgTotal)}
          </span>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>R1 to par</span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 700,
            }}
          >
            {formatSigned(hover.toPar)}
          </span>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>Adjusted</span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 700,
              color:
                hover.adjusted < -0.3
                  ? "#059669"
                  : hover.adjusted > 0.3
                    ? "#dc2626"
                    : "#334155",
            }}
          >
            {formatSigned(hover.adjusted)}
          </span>
        </div>
      )}

      <p
        style={{
          fontSize: 11,
          color: "oklch(0.55 0.02 150)",
          marginTop: 10,
        }}
      >
        Adjusted = R1 to-par + SG total. Positive = under-performed skill
        (course was harder than expected for that player), negative =
        outperformed. Blue line: Gaussian-smoothed trend across tee times.
      </p>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 13,
  fontWeight: 700,
  border: "1px solid oklch(0.85 0.013 95)",
  borderRadius: 6,
  background: "white",
  cursor: "pointer",
  color: "oklch(0.3 0.02 150)",
  minWidth: 34,
};
