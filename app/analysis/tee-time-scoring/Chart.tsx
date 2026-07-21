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
import WeatherStrip, {
  type DailyWeatherView,
} from "../_components/WeatherStrip";

type RoundNum = 1 | 2 | 3 | 4;

interface Row {
  dgId: string;
  name: string;
  round: RoundNum;
  teeTime: string;
  teeMinutes: number;
  sgTotal: number;
  toPar: number;
  adjusted: number;
  thru: string | number;
  startHole: number;
  noSkill?: boolean;
  projected?: boolean;
  thruHoles?: number;
  currentToPar?: number;
}

type RoundFilter = "all" | "r1" | "r2" | "r3" | "r4";

/** Per-round visual encoding — colour, mark shape, dash pattern for
 *  the actual & projected trend lines. Kept side-by-side so any
 *  future ramp changes touch a single spot. */
const ROUND_STYLE: Record<
  RoundNum,
  {
    color: string;
    shape: "circle" | "square" | "triangle" | "diamond";
    actualDash: string | undefined;
    projectedDash: string;
  }
> = {
  1: { color: "#0284c7", shape: "circle", actualDash: undefined, projectedDash: "2 4" },
  2: { color: "#d97706", shape: "square", actualDash: "7 5", projectedDash: "1 4" },
  3: { color: "#7c3aed", shape: "triangle", actualDash: "2 3 8 3", projectedDash: "1 3" },
  4: { color: "#db2777", shape: "diamond", actualDash: "5 3", projectedDash: "1 3" },
};

const ROUND_LABEL: Record<RoundNum, string> = {
  1: "R1",
  2: "R2",
  3: "R3",
  4: "R4",
};

interface ChartProps {
  rows: Row[];
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
}

/** Gaussian-weighted rolling mean (double pass). */
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

/** Interpolate the smoothed line at an arbitrary x. */
function interpolate(
  smooth: Array<{ x: number; y: number }>,
  x: number,
): number | null {
  if (smooth.length === 0) return null;
  if (x <= smooth[0].x) return smooth[0].y;
  if (x >= smooth[smooth.length - 1].x) return smooth[smooth.length - 1].y;
  for (let i = 1; i < smooth.length; i++) {
    if (smooth[i].x >= x) {
      const a = smooth[i - 1];
      const b = smooth[i];
      const t = (x - a.x) / Math.max(0.001, b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return null;
}

export default function Chart({ rows, weatherByRound }: ChartProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  return (
    <>
      <ChartCore
        rows={rows}
        expanded={false}
        onExpand={() => setExpanded(true)}
        weatherByRound={weatherByRound ?? null}
      />
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded scoring chart"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.72)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 10,
              padding: 16,
              width: "100%",
              maxWidth: 1400,
              maxHeight: "94vh",
              // Only allow vertical scroll — horizontal scroll made
              // the whole chart shift right of the viewport instead
              // of fitting to width.
              overflowX: "hidden",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
          >
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{
                float: "right",
                border: "1px solid oklch(0.85 0.013 95)",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 700,
                background: "white",
                cursor: "pointer",
              }}
            >
              Close ✕
            </button>
            <ChartCore
              rows={rows}
              expanded={true}
              onExpand={null}
              weatherByRound={weatherByRound ?? null}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** Render one of 4 categorical mark shapes. Used both for scatter
 *  dots and for the cursor trend markers so the same shape carries
 *  round identity everywhere. */
function ShapeMark({
  shape,
  cx,
  cy,
  size,
  fill,
  stroke,
  strokeWidth,
  strokeDasharray,
  opacity,
  onPointerEnter,
}: {
  shape: "circle" | "square" | "triangle" | "diamond";
  cx: number;
  cy: number;
  size: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity?: number;
  onPointerEnter?: () => void;
}) {
  const commonProps = {
    fill,
    stroke,
    strokeWidth,
    strokeDasharray,
    opacity,
    onPointerEnter,
  };
  if (shape === "circle") {
    return <circle cx={cx} cy={cy} r={size} {...commonProps} />;
  }
  if (shape === "square") {
    return (
      <rect
        x={cx - size}
        y={cy - size}
        width={size * 2}
        height={size * 2}
        {...commonProps}
      />
    );
  }
  if (shape === "triangle") {
    const h = size * 1.15;
    return (
      <polygon
        points={`${cx},${cy - h} ${cx - h},${cy + h * 0.85} ${cx + h},${cy + h * 0.85}`}
        {...commonProps}
      />
    );
  }
  // diamond
  return (
    <polygon
      points={`${cx},${cy - size * 1.15} ${cx + size * 1.15},${cy} ${cx},${cy + size * 1.15} ${cx - size * 1.15},${cy}`}
      {...commonProps}
    />
  );
}

interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const MIN_X_SPAN = 15;
const MIN_Y_SPAN = 0.5;
const MAX_X_ZOOM_FACTOR = 8;
const MAX_Y_ZOOM_FACTOR = 8;

function ChartCore({
  rows,
  expanded,
  onExpand,
  weatherByRound,
}: {
  rows: Row[];
  expanded: boolean;
  onExpand: (() => void) | null;
  weatherByRound: Record<string, DailyWeatherView | null> | null;
}) {
  const [hover, setHover] = useState<Row | null>(null);
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [roundFilter, setRoundFilter] = useState<RoundFilter>("all");
  const [showPoints, setShowPoints] = useState(true);
  /** When false, the y-axis shows raw round-score-to-par (each dot is
   *  where that player finished the round vs par). When true (default),
   *  the y-axis shows the skill-adjusted deviation (score + skill
   *  baseline — negative = over-performed, positive = under-performed).
   *  Toggle lets bettors flip between "who actually shot low today?"
   *  and "who out-played their form today?" without leaving the chart. */
  const [showAdjusted, setShowAdjusted] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Dimensions scale up in expanded mode.
  const width = expanded ? 1280 : 820;
  const height = expanded ? 680 : 460;
  const padL = 64;
  const padR = 20;
  const padT = 24;
  const padB = 46;
  const iw = width - padL - padR;
  const ih = height - padT - padB;

  const activeRounds = useMemo<RoundNum[]>(() => {
    if (roundFilter === "all") return [1, 2, 3, 4];
    if (roundFilter === "r1") return [1];
    if (roundFilter === "r2") return [2];
    if (roundFilter === "r3") return [3];
    return [4];
  }, [roundFilter]);

  const activeRoundSet = useMemo(
    () => new Set(activeRounds),
    [activeRounds],
  );

  /** Pick which y-value the chart should use — adjusted (skill-baseline
   *  corrected) or raw round-to-par. Same function used by the point
   *  scatter and the per-round trend bucketing so the two stay in
   *  sync when the toggle flips. */
  const yOf = useCallback(
    (r: Row) => (showAdjusted ? r.adjusted : r.toPar),
    [showAdjusted],
  );

  const points = useMemo(
    () =>
      rows
        .filter((r) => activeRoundSet.has(r.round))
        .map((r) => ({ x: r.teeMinutes, y: yOf(r), row: r })),
    [rows, activeRoundSet, yOf],
  );

  // Per-round buckets — actual (finished) vs all (finished + projected).
  // Smooth uses ALL; render splits at the max-actual-x boundary so
  // actual segment is solid and projected segment is dashed.
  const byRound = useMemo<
    Record<
      RoundNum,
      {
        actual: Array<{ x: number; y: number }>;
        all: Array<{ x: number; y: number }>;
        boundary: number | null;
      }
    >
  >(() => {
    const out: Record<
      RoundNum,
      {
        actual: Array<{ x: number; y: number }>;
        all: Array<{ x: number; y: number }>;
        boundary: number | null;
      }
    > = {
      1: { actual: [], all: [], boundary: null },
      2: { actual: [], all: [], boundary: null },
      3: { actual: [], all: [], boundary: null },
      4: { actual: [], all: [], boundary: null },
    };
    for (const r of rows) {
      const pt = { x: r.teeMinutes, y: yOf(r) };
      out[r.round].all.push(pt);
      if (!r.projected) out[r.round].actual.push(pt);
    }
    (Object.keys(out) as unknown as RoundNum[]).forEach((k) => {
      const num = Number(k) as RoundNum;
      const bucket = out[num];
      bucket.boundary =
        bucket.actual.length > 0
          ? Math.max(...bucket.actual.map((p) => p.x))
          : null;
    });
    return out;
  }, [rows, yOf]);

  const extent = useMemo(() => {
    if (points.length === 0) {
      return { xMin: 0, xMax: 60, yMin: -1, yMax: 1 };
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    // Small x-padding so the extreme tee times don't sit right on the
    // axis and get half-clipped by the chart edge.
    const xPad = Math.max(15, (Math.max(...xs) - Math.min(...xs)) * 0.03);
    const xMin = Math.min(...xs) - xPad;
    const xMax = Math.max(...xs) + xPad;
    const yPad = 0.5;
    const yRaw = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys)));
    const yBound = yRaw + yPad;
    return { xMin, xMax, yMin: -yBound, yMax: yBound };
  }, [points]);

  // User-controlled viewport is stored separately from the auto-fit
  // one. When userViewport is null, we DERIVE viewport from extent
  // every render — so any data update (new finisher, new rows prop)
  // immediately widens the visible range. When the user zooms or pans,
  // userViewport is set and takes over until Reset clears it.
  const [userViewport, setUserViewport] = useState<Viewport | null>(null);
  const viewport = userViewport ?? extent;
  const setViewport = useCallback((v: Viewport) => {
    setUserViewport(v);
  }, []);
  const hasUserZoomedRef = useRef(false);
  useEffect(() => {
    hasUserZoomedRef.current = userViewport != null;
  }, [userViewport]);

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

  // Smoothed lines: use ALL points (actuals + projections) so the
  // trend flows across the full tee-time span. Split into two paths
  // per round at the max-actual-x boundary — solid up to that x,
  // dashed beyond it.
  const smoothByRound = useMemo(
    () => ({
      1: rollingSmooth(byRound[1].all, 60),
      2: rollingSmooth(byRound[2].all, 60),
      3: rollingSmooth(byRound[3].all, 60),
      4: rollingSmooth(byRound[4].all, 60),
    }),
    [byRound],
  );

  const buildSplitPaths = (
    smooth: Array<{ x: number; y: number }>,
    boundary: number | null,
  ) => {
    if (smooth.length === 0) return { actualPath: "", projectedPath: "" };
    const buildPath = (pts: Array<{ x: number; y: number }>) =>
      pts
        .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.x)} ${yFor(p.y)}`)
        .join(" ");
    if (boundary == null) {
      return { actualPath: "", projectedPath: buildPath(smooth) };
    }
    const actualPts = smooth.filter((p) => p.x <= boundary);
    const projectedPts = smooth.filter((p) => p.x >= boundary);
    return {
      actualPath: buildPath(actualPts),
      projectedPath: projectedPts.length > 1 ? buildPath(projectedPts) : "",
    };
  };

  const pathsByRound: Record<
    RoundNum,
    { actualPath: string; projectedPath: string }
  > = {
    1: buildSplitPaths(smoothByRound[1], byRound[1].boundary),
    2: buildSplitPaths(smoothByRound[2], byRound[2].boundary),
    3: buildSplitPaths(smoothByRound[3], byRound[3].boundary),
    4: buildSplitPaths(smoothByRound[4], byRound[4].boundary),
  };

  // Per-round wave averages — split each round's field in half at
  // its median tee time and mean the current y-metric. Uses `rows`
  // (not `points`) so all four rounds show even when the round
  // filter is narrowed to one; `yOf` is folded in so the numbers
  // track the Skill-adjusted toggle without a re-render dance.
  const waveByRound = useMemo(() => {
    const out: Record<
      RoundNum,
      { early: number | null; late: number | null; count: number }
    > = {
      1: { early: null, late: null, count: 0 },
      2: { early: null, late: null, count: 0 },
      3: { early: null, late: null, count: 0 },
      4: { early: null, late: null, count: 0 },
    };
    ([1, 2, 3, 4] as const).forEach((r) => {
      const roundRows = rows.filter((row) => row.round === r);
      if (roundRows.length === 0) return;
      const sorted = [...roundRows].sort(
        (a, b) => a.teeMinutes - b.teeMinutes,
      );
      const half = Math.floor(sorted.length / 2);
      const early = sorted.slice(0, half);
      const late = sorted.slice(half);
      const meanOf = (arr: Row[]) =>
        arr.length === 0
          ? null
          : arr.reduce((s, x) => s + yOf(x), 0) / arr.length;
      out[r] = {
        early: meanOf(early),
        late: meanOf(late),
        count: sorted.length,
      };
    });
    return out;
  }, [rows, yOf]);

  const trendReadouts = useMemo(() => {
    if (cursorX == null) return [] as Array<{ round: RoundNum; value: number }>;
    const out: Array<{ round: RoundNum; value: number }> = [];
    for (const r of activeRounds) {
      const smooth = smoothByRound[r];
      const v = interpolate(smooth, cursorX);
      if (v != null) out.push({ round: r, value: v });
    }
    return out;
  }, [cursorX, activeRounds, smoothByRound]);

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
    const rounded = Math.round(mins);
    const h = Math.floor(rounded / 60) % 24;
    const m = rounded % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const formatSigned = (v: number) => {
    if (Math.abs(v) < 0.05) return "0";
    return v > 0 ? `+${v.toFixed(1)}` : `−${Math.abs(v).toFixed(1)}`;
  };

  // ── Pointer interactions ────────────────────────────────────────
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

  const pointerCoords = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (width / rect.width);
      const sy = (e.clientY - rect.top) * (height / rect.height);
      return { x: sx, y: sy };
    },
    [width, height],
  );

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
    const p = pointerCoords(e);
    // Always track cursor for the trend readout, whether or not
    // we're dragging.
    if (
      p.x >= padL &&
      p.x <= width - padR &&
      p.y >= padT &&
      p.y <= height - padB
    ) {
      setCursorX(dataXFor(p.x));
    } else {
      setCursorX(null);
    }

    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, p);
    const pts = [...pointersRef.current.values()];

    if (pts.length === 1 && dragOriginRef.current) {
      const o = dragOriginRef.current;
      const dxPx = p.x - o.pointerX;
      const dyPx = p.y - o.pointerY;
      // Any meaningful drag counts as user zoom / pan — skip the
      // "we haven't moved" no-op to keep auto-fit alive until the
      // user actually shifts the chart.
      if (Math.abs(dxPx) + Math.abs(dyPx) > 4) {
        hasUserZoomedRef.current = true;
      }
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
      hasUserZoomedRef.current = true;
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
    hasUserZoomedRef.current = true;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (width / rect.width);
    const sy = (e.clientY - rect.top) * (height / rect.height);
    const scale = Math.exp(e.deltaY * 0.001);
    const cx = dataXFor(sx);
    const cy = dataYFor(sy);
    setViewport(
      clampViewport({
        xMin: cx - (cx - viewport.xMin) * scale,
        xMax: cx + (viewport.xMax - cx) * scale,
        yMin: cy - (cy - viewport.yMin) * scale,
        yMax: cy + (viewport.yMax - cy) * scale,
      }),
    );
  };

  const zoomBy = (factor: number) => {
    hasUserZoomedRef.current = true;
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

  const resetZoom = () => {
    hasUserZoomedRef.current = false;
    setUserViewport(null);
  };

  // "Zoomed" now simply means the user has taken control of the
  // viewport (userViewport != null). Auto-fit state → not zoomed.
  const isZoomed = userViewport != null;

  // Render EVERY point and let the SVG clip path hide anything
  // outside the chart interior. The previous filter-then-render
  // approach was hiding dots that should have been visible when the
  // viewport had drifted or the padded extent boundary was applied
  // ambiguously. Circles are cheap — 127 of them cost nothing.
  const visiblePoints = points;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          marginBottom: 8,
          flexWrap: "wrap",
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
          onClick={resetZoom}
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
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            style={btnStyle}
            aria-label="Expand chart"
          >
            ⛶ Expand
          </button>
        )}
        <span
          style={{
            fontSize: 11,
            color: "oklch(0.55 0.02 150)",
            marginLeft: 8,
          }}
        >
          Drag · scroll · pinch to zoom
        </span>
        {/* Both toggles use the same visual grammar: fixed label,
            black background when the feature is ON, white when OFF.
            "Skill adjusted" black = adjustment applied (default).
            "Hide points" black = scatter dots hidden. */}
        <button
          type="button"
          onClick={() => setShowAdjusted((v) => !v)}
          aria-pressed={showAdjusted}
          style={{
            ...btnStyle,
            marginLeft: "auto",
            background: showAdjusted ? "oklch(0.25 0.02 150)" : "white",
            color: showAdjusted ? "white" : "oklch(0.3 0.02 150)",
          }}
          title={
            showAdjusted
              ? "Y-axis is skill-adjusted — click for raw round-to-par"
              : "Y-axis is raw round-to-par — click for skill-adjusted"
          }
        >
          Skill adjusted
        </button>
        <button
          type="button"
          onClick={() => setShowPoints((v) => !v)}
          aria-pressed={!showPoints}
          style={{
            ...btnStyle,
            background: !showPoints ? "oklch(0.25 0.02 150)" : "white",
            color: !showPoints ? "white" : "oklch(0.3 0.02 150)",
          }}
          title={
            showPoints
              ? "Hide the scatter — trend lines only"
              : "Show individual players"
          }
        >
          Hide points
        </button>
        {/* Round filter — pill group covers all 4 rounds + "All". */}
        <div
          role="group"
          aria-label="Round filter"
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          {(["all", "r1", "r2", "r3", "r4"] as const).map((f) => {
            const active = roundFilter === f;
            const label = f === "all" ? "All" : f.toUpperCase();
            return (
              <button
                key={f}
                type="button"
                onClick={() => setRoundFilter(f)}
                style={{
                  padding: "8px 14px",
                  fontSize: 14,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: "1px solid oklch(0.85 0.013 95)",
                  background: active ? "oklch(0.25 0.02 150)" : "white",
                  color: active ? "white" : "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend row — shape + ring hue encode round, fill hue encodes polarity. */}
      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 11,
          color: "oklch(0.5 0.02 150)",
          marginBottom: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {([1, 2, 3, 4] as const).map((r) => {
          const style = ROUND_STYLE[r];
          return (
            <span
              key={r}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <svg width={16} height={16} viewBox="-8 -8 16 16">
                <ShapeMark
                  shape={style.shape}
                  cx={0}
                  cy={0}
                  size={5}
                  fill="#334155"
                  stroke={style.color}
                  strokeWidth={2}
                />
              </svg>
              <strong style={{ color: style.color }}>{ROUND_LABEL[r]}</strong>
            </span>
          );
        })}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: 4,
          }}
        >
          fill:{" "}
          <span style={{ color: "#059669", fontWeight: 700 }}>green</span> =
          outperformed ·{" "}
          <span style={{ color: "#dc2626", fontWeight: 700 }}>red</span> = under
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width={16} height={16} viewBox="-8 -8 16 16">
            <circle
              r={5}
              cx={0}
              cy={0}
              fill="white"
              stroke="#334155"
              strokeWidth={2}
              strokeDasharray="3 2"
            />
          </svg>
          hollow dashed = model projection (still on course)
        </span>
      </div>

      {/* Trend readout — shows the smoothed-line value under cursor */}
      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "baseline",
          fontSize: 13,
          marginBottom: 6,
          minHeight: 22,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "oklch(0.5 0.02 150)" }}>
          Trend at{" "}
          <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {cursorX != null ? formatClock(cursorX) : "—"}
          </strong>
        </span>
        {activeRounds.map((r) => {
          const readout = trendReadouts.find((t) => t.round === r);
          return (
            <span
              key={r}
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 800,
                fontSize: 16,
                color: ROUND_STYLE[r].color,
              }}
            >
              {ROUND_LABEL[r]}: {readout ? formatSigned(readout.value) : "—"}
            </span>
          );
        })}
        {/* Diagnostic — shows what's actually loaded vs shown. Helps
            spot when a viewport isn't fitting the data. */}
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            color: "oklch(0.55 0.02 150)",
            marginLeft: "auto",
          }}
        >
          {points.length} loaded · {visiblePoints.length} shown · axis{" "}
          {formatClock(viewport.xMin)}–{formatClock(viewport.xMax)} · data{" "}
          {formatClock(extent.xMin)}–{formatClock(extent.xMax)}
        </span>
      </div>
      {/* Wave averages — early vs late half of each round's field.
          Uses yOf so the numbers flip with the Skill-adjusted toggle.
          Δ = late − early; negative = late wave scored better; that's
          the "afternoon had it easier" signal. */}
      <div
        style={{
          border: "1px solid oklch(0.9 0.008 95)",
          borderRadius: 10,
          padding: "14px 16px 16px",
          marginBottom: 12,
          background: "oklch(0.985 0.005 95)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 10,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <strong style={{ fontSize: 15, letterSpacing: 0.3 }}>
            Wave average ·{" "}
            <span style={{ color: "oklch(0.4 0.02 150)", fontWeight: 500 }}>
              {showAdjusted ? "skill adjusted" : "raw to par"}
            </span>
          </strong>
          <span
            style={{
              fontSize: 12,
              color: "oklch(0.5 0.02 150)",
            }}
          >
            Split each round&apos;s field in half at the median tee time.
            Δ = late − early.
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
          }}
        >
          {([1, 2, 3, 4] as const).map((r) => {
            const wave = waveByRound[r];
            const style = ROUND_STYLE[r];
            const delta =
              wave.early != null && wave.late != null
                ? wave.late - wave.early
                : null;
            const deltaColor =
              delta == null
                ? "oklch(0.5 0.02 150)"
                : delta < -0.15
                  ? "#059669"
                  : delta > 0.15
                    ? "#dc2626"
                    : "#334155";
            return (
              <div
                key={r}
                style={{
                  border: "1px solid oklch(0.92 0.008 95)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  background: "white",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <strong
                    style={{
                      color: style.color,
                      fontSize: 15,
                      fontFamily:
                        "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                      letterSpacing: 0.3,
                    }}
                  >
                    {ROUND_LABEL[r]}
                  </strong>
                  <span
                    style={{
                      fontSize: 11,
                      color: "oklch(0.55 0.02 150)",
                    }}
                  >
                    {wave.count} rounds
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    columnGap: 10,
                    rowGap: 6,
                  }}
                >
                  <span style={{ color: "oklch(0.5 0.02 150)", fontSize: 13 }}>Early</span>
                  <span style={{ textAlign: "right", fontWeight: 700, fontSize: 17 }}>
                    {wave.early != null ? formatSigned(wave.early) : "—"}
                  </span>
                  <span style={{ color: "oklch(0.5 0.02 150)", fontSize: 13 }}>Late</span>
                  <span style={{ textAlign: "right", fontWeight: 700, fontSize: 17 }}>
                    {wave.late != null ? formatSigned(wave.late) : "—"}
                  </span>
                  <span style={{ color: "oklch(0.5 0.02 150)", fontSize: 13 }}>Δ</span>
                  <span
                    style={{
                      textAlign: "right",
                      fontWeight: 800,
                      fontSize: 18,
                      color: deltaColor,
                    }}
                  >
                    {delta != null ? formatSigned(delta) : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <svg
        ref={svgRef}
        // No fixed width/height attributes — viewBox handles the aspect
        // ratio, and CSS width:100% makes the SVG shrink to fit whatever
        // container it lands in (small chart, expanded modal, phone in
        // landscape, etc). Prevents the horizontal scroll people were
        // seeing when the fixed 1280px expanded width exceeded the
        // viewport.
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          background: "white",
          border: "1px solid oklch(0.9 0.008 95)",
          borderRadius: 8,
          width: "100%",
          height: "auto",
          maxHeight: expanded ? "80vh" : undefined,
          display: "block",
          touchAction: "none",
          cursor: dragOriginRef.current ? "grabbing" : "crosshair",
        }}
        onMouseLeave={() => {
          setHover(null);
          setCursorX(null);
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <clipPath id="chart-clip">
            <rect x={padL} y={padT} width={iw} height={ih} />
          </clipPath>
        </defs>

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
          x={16}
          y={padT + ih / 2}
          transform={`rotate(-90 16 ${padT + ih / 2})`}
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
          {/* Per-round trend lines. Each round contributes an actual
              (solid, style-specific dash) and optional projected
              (thinner dash, lower opacity) segment. Loop over the
              active rounds only so filter toggles hide/show them all
              consistently. */}
          {activeRounds.map((r) => {
            const style = ROUND_STYLE[r];
            const { actualPath, projectedPath } = pathsByRound[r];
            return (
              <g key={`trend-${r}`}>
                {actualPath && (
                  <>
                    <path
                      d={actualPath}
                      fill="none"
                      stroke="white"
                      strokeWidth={5}
                      opacity={0.9}
                    />
                    <path
                      d={actualPath}
                      fill="none"
                      stroke={style.color}
                      strokeWidth={3}
                      strokeDasharray={style.actualDash}
                    />
                  </>
                )}
                {projectedPath && (
                  <>
                    <path
                      d={projectedPath}
                      fill="none"
                      stroke="white"
                      strokeWidth={5}
                      opacity={0.85}
                    />
                    <path
                      d={projectedPath}
                      fill="none"
                      stroke={style.color}
                      strokeWidth={3}
                      opacity={0.65}
                      strokeDasharray={style.projectedDash}
                    />
                  </>
                )}
              </g>
            );
          })}

          {showPoints &&
            visiblePoints.map((p) => {
              const y = p.y;
              const polarityColor =
                y < -0.3 ? "#059669" : y > 0.3 ? "#dc2626" : "#334155";
              const isHover =
                hover?.dgId === p.row.dgId && hover?.round === p.row.round;
              const noSkill = p.row.noSkill === true;
              const isProjected = p.row.projected === true;
              const style = ROUND_STYLE[p.row.round];
              const cx = xFor(p.x);
              const cy = yFor(y);
              const size = isHover ? 7 : 4;
              const fill = isProjected || noSkill ? "white" : polarityColor;
              const stroke = isProjected ? polarityColor : style.color;
              const strokeWidth = isProjected ? 2 : isHover ? 3 : 1.8;
              const dash = isProjected ? "3 2" : undefined;
              const opacity = isHover ? 1 : isProjected ? 0.7 : 0.85;
              return (
                <ShapeMark
                  key={`${p.row.dgId}-${p.row.round}`}
                  shape={style.shape}
                  cx={cx}
                  cy={cy}
                  size={size}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                  opacity={opacity}
                  onPointerEnter={() => setHover(p.row)}
                />
              );
            })}

          {/* Cursor guideline + per-round trend markers */}
          {cursorX != null && (
            <>
              <line
                x1={xFor(cursorX)}
                x2={xFor(cursorX)}
                y1={padT}
                y2={height - padB}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="4 4"
                pointerEvents="none"
              />
              {trendReadouts.map((t) => {
                const style = ROUND_STYLE[t.round];
                const cx = xFor(cursorX);
                const cy = yFor(t.value);
                return (
                  <ShapeMark
                    key={t.round}
                    shape={style.shape}
                    cx={cx}
                    cy={cy}
                    size={6}
                    fill={style.color}
                    stroke="white"
                    strokeWidth={2}
                  />
                );
              })}
            </>
          )}
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
          <strong>
            {hover.name} · R{hover.round}
            {hover.projected && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "oklch(0.94 0.02 250)",
                  color: "oklch(0.35 0.05 250)",
                  fontWeight: 700,
                  letterSpacing: 0.4,
                }}
              >
                PROJECTED
              </span>
            )}
          </strong>
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
          {hover.projected && typeof hover.currentToPar === "number" && (
            <>
              <span style={{ color: "oklch(0.5 0.02 150)" }}>
                Current (thru {hover.thruHoles ?? hover.thru})
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: 700,
                }}
              >
                {formatSigned(hover.currentToPar)}
              </span>
            </>
          )}
          <span style={{ color: "oklch(0.5 0.02 150)" }}>
            {hover.projected ? "Projected final" : `R${hover.round} to par`}
          </span>
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
        {showAdjusted
          ? "Adjusted = round to-par + pre-tournament skill. Positive = under-performed skill, negative = outperformed."
          : "Raw = round to-par (no skill correction). Positive = over par, negative = under par."}{" "}
        Blue line: Gaussian-smoothed trend across tee times.
      </p>

      {/* Weather strip — only when a single round tab is active. The
          "All" tab collapses four days into one chart, so pinning
          weather to a single day would be misleading. */}
      {roundFilter !== "all" && weatherByRound && (
        <WeatherStrip
          day={weatherByRound[String(activeRounds[0])] ?? null}
          roundLabel={`R${activeRounds[0]} weather`}
        />
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 14,
  fontWeight: 700,
  border: "1px solid oklch(0.85 0.013 95)",
  borderRadius: 6,
  background: "white",
  cursor: "pointer",
  color: "oklch(0.3 0.02 150)",
  minWidth: 42,
};
