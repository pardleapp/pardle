"use client";

/**
 * Slope-inference overlay — v2, streamlines instead of arrows.
 *
 * Same underlying signal (roll deflection = actual putt direction
 * minus straight-at-the-pin direction), but rendered as flowing
 * curves that trace how a ball would roll through the vector field,
 * following the aggregate downhill direction.
 *
 * How the field is built (unchanged from v1):
 *   • Filter to putts with valid start/end/pin.
 *   • For each: deflection = normalise(end - start) − normalise(pin - start).
 *   • Bin the green into a grid. Each putt contributes its deflection
 *     to the cells its start / midpoint / end fall in, so coverage
 *     spreads out beyond the pin zone.
 *   • Bilinear interpolation between adjacent cells so the field
 *     reads smoothly, not blocky.
 *
 * How streamlines are traced:
 *   • Distribute ~64 seed points evenly across the green (8×8 grid).
 *   • From each seed, integrate forward AND backward along the field
 *     at a small step size. Bail on hitting a low-signal zone, going
 *     off the edge, or exceeding max steps.
 *   • Render each streamline as a smooth SVG polyline.
 *
 * Streamlines converge on low spots and diverge from high spots, so
 * the visual pattern IS an approximation of the green's flow — read
 * as "which way does a ball roll from here" not as surveyed contour.
 */

import { useMemo } from "react";
import type { HolePutt, PinCoord } from "@/lib/golf-api/pgatour";

interface Props {
  putts: HolePutt[];
  pinByRound: Record<number, PinCoord>;
  /** Grid resolution for the vector field. */
  gridSize?: number;
  /** Min putts per cell to include in the field. */
  minSamples?: number;
  /** Seed density (√N per side). 8 = 64 seed points. */
  seedGrid?: number;
}

interface FieldCell {
  dx: number;
  dy: number;
  n: number;
}

function buildField(
  putts: HolePutt[],
  pinByRound: Record<number, PinCoord>,
  gridSize: number,
  minSamples: number,
): (FieldCell | null)[][] {
  const acc = new Map<
    string,
    { sumDx: number; sumDy: number; n: number }
  >();
  for (const p of putts) {
    // Use ALL putts (made + missed) for the field — made putts still
    // carry directional information via their travel angle vs the
    // straight-line-to-pin aim.
    const pin = pinByRound[p.round];
    if (!pin) continue;
    const aimX = pin.x - p.x1;
    const aimY = pin.y - p.y1;
    const aimLen = Math.hypot(aimX, aimY);
    const travelX = p.x2 - p.x1;
    const travelY = p.y2 - p.y1;
    const travelLen = Math.hypot(travelX, travelY);
    if (aimLen < 0.015 || travelLen < 0.015) continue;
    const aimNX = aimX / aimLen;
    const aimNY = aimY / aimLen;
    const travelNX = travelX / travelLen;
    const travelNY = travelY / travelLen;
    const defX = travelNX - aimNX;
    const defY = travelNY - aimNY;
    const anchors: Array<[number, number]> = [
      [p.x1, p.y1],
      [(p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2],
      [p.x2, p.y2],
    ];
    for (const [ax, ay] of anchors) {
      const col = Math.max(0, Math.min(gridSize - 1, Math.floor(ax * gridSize)));
      const row = Math.max(0, Math.min(gridSize - 1, Math.floor(ay * gridSize)));
      const key = `${col}:${row}`;
      const cur = acc.get(key) ?? { sumDx: 0, sumDy: 0, n: 0 };
      cur.sumDx += defX;
      cur.sumDy += defY;
      cur.n += 1;
      acc.set(key, cur);
    }
  }
  const field: (FieldCell | null)[][] = [];
  for (let row = 0; row < gridSize; row++) {
    const line: (FieldCell | null)[] = [];
    for (let col = 0; col < gridSize; col++) {
      const cell = acc.get(`${col}:${row}`);
      if (cell && cell.n >= minSamples) {
        line.push({ dx: cell.sumDx / cell.n, dy: cell.sumDy / cell.n, n: cell.n });
      } else {
        line.push(null);
      }
    }
    field.push(line);
  }
  return field;
}

/** Bilinear-interpolated sample of the field at continuous (x,y),
 *  0..1 space. Falls back to nearest non-null when some corners
 *  are missing. Returns null when all 4 nearest corners are empty. */
function sampleField(
  field: (FieldCell | null)[][],
  gridSize: number,
  x: number,
  y: number,
): { dx: number; dy: number; n: number } | null {
  const col = x * gridSize - 0.5;
  const row = y * gridSize - 0.5;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const fx = col - c0;
  const fy = row - r0;
  const get = (r: number, c: number): FieldCell | null =>
    r < 0 || r >= gridSize || c < 0 || c >= gridSize ? null : field[r][c];
  const a = get(r0, c0);
  const b = get(r0, c0 + 1);
  const cc = get(r0 + 1, c0);
  const d = get(r0 + 1, c0 + 1);
  if (!a && !b && !cc && !d) return null;
  let dx = 0,
    dy = 0,
    n = 0,
    weight = 0;
  const contribs: Array<[FieldCell | null, number]> = [
    [a, (1 - fx) * (1 - fy)],
    [b, fx * (1 - fy)],
    [cc, (1 - fx) * fy],
    [d, fx * fy],
  ];
  for (const [cell, w] of contribs) {
    if (cell) {
      dx += cell.dx * w;
      dy += cell.dy * w;
      n += cell.n * w;
      weight += w;
    }
  }
  if (weight === 0) return null;
  return { dx: dx / weight, dy: dy / weight, n: n / weight };
}

interface StreamPoint {
  x: number;
  y: number;
  n: number;
}

function traceOneDirection(
  field: (FieldCell | null)[][],
  gridSize: number,
  startX: number,
  startY: number,
  sign: 1 | -1,
  maxSteps: number,
  step: number,
  minMag: number,
): StreamPoint[] {
  const points: StreamPoint[] = [];
  let x = startX;
  let y = startY;
  for (let i = 0; i < maxSteps; i++) {
    const v = sampleField(field, gridSize, x, y);
    if (!v) break;
    const mag = Math.hypot(v.dx, v.dy);
    if (mag < minMag) break;
    points.push({ x, y, n: v.n });
    x += sign * (v.dx / mag) * step;
    y += sign * (v.dy / mag) * step;
    if (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98) {
      points.push({ x, y, n: v.n });
      break;
    }
  }
  return points;
}

function traceStreamline(
  field: (FieldCell | null)[][],
  gridSize: number,
  seedX: number,
  seedY: number,
): StreamPoint[] {
  const step = 0.018;
  const maxSteps = 24;
  const minMag = 0.03;
  const forward = traceOneDirection(field, gridSize, seedX, seedY, 1, maxSteps, step, minMag);
  const backward = traceOneDirection(field, gridSize, seedX, seedY, -1, maxSteps, step, minMag);
  // Combine backward (reversed) + forward, dropping the duplicated seed.
  return [...backward.reverse(), ...forward.slice(1)];
}

/** Smoothed SVG path (catmull-like) from a polyline. Uses cubic
 *  Béziers so streamlines read as flowing curves not zig-zags. */
function pathFromPoints(pts: StreamPoint[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return `M ${pts[0].x * 100} ${pts[0].y * 100} L ${pts[1].x * 100} ${pts[1].y * 100}`;
  }
  let d = `M ${pts[0].x * 100} ${pts[0].y * 100}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    void p0;
    d += ` Q ${p1.x * 100} ${p1.y * 100} ${cx * 100} ${cy * 100}`;
  }
  const last = pts[pts.length - 1];
  d += ` T ${last.x * 100} ${last.y * 100}`;
  return d;
}

export default function SlopeOverlay({
  putts,
  pinByRound,
  gridSize = 14,
  minSamples = 4,
  seedGrid = 9,
}: Props) {
  const streams = useMemo(() => {
    if (putts.length === 0) return [] as { path: string; opacity: number }[];
    const field = buildField(putts, pinByRound, gridSize, minSamples);
    const out: { path: string; opacity: number }[] = [];
    for (let sr = 0; sr < seedGrid; sr++) {
      for (let sc = 0; sc < seedGrid; sc++) {
        const seedX = (sc + 0.5) / seedGrid;
        const seedY = (sr + 0.5) / seedGrid;
        const pts = traceStreamline(field, gridSize, seedX, seedY);
        if (pts.length < 3) continue;
        // Opacity ramps with the mean sample count of the cells the
        // streamline crossed — lonely regions stay ghostly, dense
        // ones read strongly.
        const meanN =
          pts.reduce((sum, p) => sum + p.n, 0) / Math.max(1, pts.length);
        const opacity = Math.min(0.75, 0.15 + Math.log10(meanN + 1) * 0.28);
        out.push({ path: pathFromPoints(pts), opacity });
      }
    }
    return out;
  }, [putts, pinByRound, gridSize, minSamples, seedGrid]);

  if (streams.length === 0) return null;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="v4-flow-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="3.2"
          markerHeight="3.2"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.22 0.02 60 / 0.9)" />
        </marker>
      </defs>
      {/* Two-pass stroke — dark shadow behind + tan streamline on top
          so the flow reads on both light and dark parts of the green
          image. */}
      {streams.map((s, i) => (
        <path
          key={`shadow-${i}`}
          d={s.path}
          stroke="oklch(0.15 0.02 60)"
          strokeWidth={0.8}
          strokeOpacity={s.opacity * 0.6}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {streams.map((s, i) => (
        <path
          key={`line-${i}`}
          d={s.path}
          stroke="oklch(0.9 0.05 60)"
          strokeWidth={0.45}
          strokeOpacity={s.opacity}
          fill="none"
          strokeLinecap="round"
          markerEnd="url(#v4-flow-arrow)"
        />
      ))}
    </svg>
  );
}
