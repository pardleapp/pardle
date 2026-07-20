"use client";

/**
 * Experimental slope-inference overlay for the pin-sheet modal.
 *
 * We have no elevation data, but we have hundreds of putts per green.
 * A missed putt ends where gravity + friction pulled the ball to
 * rest — so `endpoint - pin` (for that round's pin) points, on
 * average, DOWNHILL from where the pin was.
 *
 * Algorithm:
 *   1. Filter to MISSED putts with valid start / end / pin.
 *   2. For each, compute two signals:
 *        a) roll deflection = normalise(end - start) - normalise(pin - start)
 *           — how the ball's actual path deviated from a straight
 *             aim-at-pin line. Slope curl vs random miss.
 *        b) rest offset = end - pin
 *           — where the ball SETTLED relative to the pin, in the
 *             pin's local slope neighbourhood.
 *   3. Bin the green into a grid; each cell accumulates the mean of
 *      both signals for any putt whose START, END or MIDPOINT falls
 *      in that cell.
 *   4. Render arrows at every cell that has ≥ MIN_SAMPLES putts —
 *      arrow direction = mean roll deflection (best signal for
 *      slope-induced curl during the roll), length scaled by
 *      magnitude, opacity by sample count.
 *
 * Big caveats — this is INFERENCE, not measurement:
 *   • Aim direction on a broken putt isn't straight-at-the-pin;
 *     good players aim into the break, so "deflection from aim"
 *     underestimates the true slope curl.
 *   • Player mis-read noise averages OUT with enough samples but
 *     ~5-10 putts per cell isn't enough for a clean signal.
 *   • We don't know ball speed → can't estimate steepness precisely.
 *
 * So: read this as "the aggregate direction golf balls tend to
 * curl in this zone", not "the surveyed contour of the green".
 */

import { useMemo } from "react";
import type { HolePutt, PinCoord } from "@/lib/golf-api/pgatour";

interface Props {
  putts: HolePutt[];
  pinByRound: Record<number, PinCoord>;
  /** How fine the grid is. 12 = 12×12 cells across the green
   *  diagram. Higher = more detail but sparser samples per cell. */
  gridSize?: number;
  /** Min putts per cell to draw an arrow. Filters visual noise. */
  minSamples?: number;
}

interface CellVec {
  cx: number;
  cy: number;
  /** Mean roll-deflection vector at this cell (rough downhill dir). */
  dx: number;
  dy: number;
  /** How strong the signal is (magnitude of deflection). */
  mag: number;
  /** How many putts fed this cell. */
  n: number;
}

export default function SlopeOverlay({
  putts,
  pinByRound,
  gridSize = 12,
  minSamples = 4,
}: Props) {
  const cells: CellVec[] = useMemo(() => {
    const acc = new Map<
      string,
      { sumDx: number; sumDy: number; n: number }
    >();

    for (const p of putts) {
      if (p.made) continue;
      const pin = pinByRound[p.round];
      if (!pin) continue;

      // Aim vector (straight to pin) and actual travel vector.
      const aimX = pin.x - p.x1;
      const aimY = pin.y - p.y1;
      const aimLen = Math.hypot(aimX, aimY);
      const travelX = p.x2 - p.x1;
      const travelY = p.y2 - p.y1;
      const travelLen = Math.hypot(travelX, travelY);
      // Tap-ins and coord-collapsed strokes have no useful signal.
      if (aimLen < 0.015 || travelLen < 0.015) continue;

      const aimNX = aimX / aimLen;
      const aimNY = aimY / aimLen;
      const travelNX = travelX / travelLen;
      const travelNY = travelY / travelLen;
      // Deflection: actual travel direction minus straight-to-pin.
      // Perpendicular to aim = slope-curl component; parallel =
      // roll length error. We keep both to give the arrow visual
      // energy, but the perpendicular component is where slope
      // signal really lives.
      const defX = travelNX - aimNX;
      const defY = travelNY - aimNY;

      // Distribute the contribution across all three anchors of the
      // putt (start, midpoint, end) so the vector field has
      // coverage well away from the pin.
      const anchors = [
        [p.x1, p.y1],
        [(p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2],
        [p.x2, p.y2],
      ] as const;
      for (const [ax, ay] of anchors) {
        const col = Math.floor(ax * gridSize);
        const row = Math.floor(ay * gridSize);
        const key = `${col}:${row}`;
        const cur = acc.get(key) ?? { sumDx: 0, sumDy: 0, n: 0 };
        cur.sumDx += defX;
        cur.sumDy += defY;
        cur.n += 1;
        acc.set(key, cur);
      }
    }

    const out: CellVec[] = [];
    for (const [key, cell] of acc) {
      if (cell.n < minSamples) continue;
      const [colStr, rowStr] = key.split(":");
      const col = Number(colStr);
      const row = Number(rowStr);
      const cx = (col + 0.5) / gridSize;
      const cy = (row + 0.5) / gridSize;
      const meanDx = cell.sumDx / cell.n;
      const meanDy = cell.sumDy / cell.n;
      out.push({
        cx,
        cy,
        dx: meanDx,
        dy: meanDy,
        mag: Math.hypot(meanDx, meanDy),
        n: cell.n,
      });
    }
    return out;
  }, [putts, pinByRound, gridSize, minSamples]);

  if (cells.length === 0) return null;

  // Normalise arrow lengths against the max magnitude in view so we
  // get sensible visual scale regardless of how strong the signal is.
  const maxMag = Math.max(0.01, ...cells.map((c) => c.mag));
  // SVG viewBox is 0..100 units; keep arrows chunky enough to read
  // at desktop scale but not overwhelm.
  const ARROW_MAX = 5.5; // in viewBox units
  const ARROW_MIN = 1.8;

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
          id="v4-slope-arrowhead"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.35 0.02 60)" />
        </marker>
      </defs>
      {cells.map((c, i) => {
        // Arrow length proportional to signal strength.
        const t = c.mag / maxMag;
        const len = ARROW_MIN + t * (ARROW_MAX - ARROW_MIN);
        // Turn deflection into a unit direction, then scale by len.
        const dirLen = Math.max(0.0001, Math.hypot(c.dx, c.dy));
        const ux = c.dx / dirLen;
        const uy = c.dy / dirLen;
        const x1 = c.cx * 100;
        const y1 = c.cy * 100;
        const x2 = x1 + ux * len;
        const y2 = y1 + uy * len;
        // Opacity ramps with sample count so lonely cells stay
        // faded (low confidence) while dense cells shout.
        const opacity = Math.min(0.85, 0.25 + Math.log10(c.n + 1) * 0.24);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="oklch(0.25 0.02 60)"
            strokeWidth={0.55}
            strokeOpacity={opacity}
            markerEnd="url(#v4-slope-arrowhead)"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}
