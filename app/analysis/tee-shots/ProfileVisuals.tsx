"use client";

/**
 * The three visuals stacked on the profile page:
 *   1. Stat card — mean±std across the radar dimensions.
 *   2. Side & top view of the mean ball flight, reconstructed by
 *      evaluating xFit/yFit/zFit as polynomials over the profile's
 *      timeInterval. Side view = downrange distance vs height. Top
 *      view = downrange vs side offset (fade+/draw−).
 *   3. Shot cloud — every stored shot at (ball speed, carry side)
 *      so shape variance is visible at a glance.
 *
 * All svgs are `viewBox`-driven; container width dictates rendered
 * size and no fixed pixel dimensions leak into the layout.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayerDrivingProfile } from "@/lib/feed/tee-shots-profile";

interface Props {
  profile: PlayerDrivingProfile;
}

const FLIGHT_MS = 2800; // one loop of the ball animation
const REST_MS = 900; // pause at landing before restart, so the eye can register the final side offset

/** Lagrange quadratic through (0,0), (x1,y1), (x2,y2) — the
 *  smooth curve every arc panel below uses. */
function lagrange(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (x1 === 0 || x2 === 0 || x1 === x2) return 0;
  const l1 = (x * (x - x2)) / (x1 * (x1 - x2));
  const l2 = (x * (x - x1)) / (x2 * (x2 - x1));
  return y1 * l1 + y2 * l2;
}

/** Sample the average side profile (height vs downrange) from the
 *  three scalar points we have: launch, apex, landing. Piecewise
 *  parabolas that both peak at the apex point keep the peak in the
 *  right place instead of at midpoint. */
function sampleSide(
  carryYd: number,
  apexRangeFt: number,
  apexHeightFt: number,
  n = 60,
): Array<{ x: number; y: number }> {
  const carryFt = carryYd * 3;
  // Guard against apex data that would collapse the piecewise
  // parabolas (apex at 0 or beyond landing).
  const apexX = Math.max(1, Math.min(carryFt - 1, apexRangeFt));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const xFt = (i / n) * carryFt;
    let y = 0;
    if (xFt <= apexX) {
      const u = (apexX - xFt) / apexX;
      y = apexHeightFt * (1 - u * u);
    } else {
      const u = (xFt - apexX) / (carryFt - apexX);
      y = apexHeightFt * (1 - u * u);
    }
    out.push({ x: xFt / 3, y }); // convert x back to yards for the axis
  }
  return out;
}

/** Sample the average top profile (side offset vs downrange) as a
 *  quadratic through (0,0) → (apexRangeYd, apexSideYd) → (carry,
 *  carrySide). Captures the aim + curve of the shot. */
function sampleTop(
  carryYd: number,
  apexRangeFt: number,
  apexSideFt: number,
  carrySideYd: number,
  n = 60,
): Array<{ x: number; z: number }> {
  const apexRangeYd = apexRangeFt / 3;
  const apexSideYd = apexSideFt / 3;
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * carryYd;
    const z = lagrange(x, apexRangeYd, apexSideYd, carryYd, carrySideYd);
    out.push({ x, z });
  }
  return out;
}

/** Simple rounding, safe for negatives + missing values. */
function fmt(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function StatRow({
  label,
  mean,
  std,
  unit,
  digits = 1,
}: {
  label: string;
  mean: number;
  std: number;
  unit: string;
  digits?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 12,
        padding: "6px 0",
        borderBottom: "1px solid oklch(0.94 0.008 95)",
        alignItems: "baseline",
      }}
    >
      <span style={{ fontSize: 12, color: "oklch(0.35 0.02 150)" }}>
        {label}
      </span>
      <span
        style={{
          fontFamily:
            "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 14,
          fontWeight: 600,
          color: "oklch(0.2 0.02 150)",
        }}
      >
        {fmt(mean, digits)} {unit}
      </span>
      <span
        style={{
          fontFamily:
            "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 11,
          color: "oklch(0.55 0.02 150)",
          minWidth: 56,
          textAlign: "right",
        }}
      >
        ±{fmt(std, digits)}
      </span>
    </div>
  );
}

function TrajectoryPanel({ profile }: { profile: PlayerDrivingProfile }) {
  const { carry, apexHeight, apexRange, apexSide, carrySide } = profile.shape;

  const sideSamples = useMemo(
    () => sampleSide(carry, apexRange, apexHeight, 80),
    [carry, apexRange, apexHeight],
  );
  const topSamples = useMemo(
    () => sampleTop(carry, apexRange, apexSide, carrySide, 80),
    [carry, apexRange, apexSide, carrySide],
  );

  const SIDE_W = 460;
  const SIDE_H = 200;
  // TOP is portrait — tee at bottom, ball flies up. Side drift
  // reads as horizontal deviation, which is more intuitive than
  // Y-axis deviation for "fade vs draw".
  const TOP_W = 260;
  const TOP_H = 420;
  const pad = { l: 44, r: 20, t: 14, b: 24 };
  const topPad = { l: 30, r: 30, t: 22, b: 32 };
  const plotW = SIDE_W - pad.l - pad.r;
  const plotH = SIDE_H - pad.t - pad.b;
  const topPlotW = TOP_W - topPad.l - topPad.r;
  const topPlotH = TOP_H - topPad.t - topPad.b;

  // Project the sampled arcs into SVG-space once; the animator
  // interpolates within these arrays every frame.
  const geom = useMemo(() => {
    const xs = sideSamples.map((s) => s.x);
    const ys = sideSamples.map((s) => s.y);
    const zs = topSamples.map((s) => s.z);
    const xMax = Math.max(1, Math.max(...xs));
    const yMax = Math.max(20, Math.max(...ys) * 1.1);
    const zAbs = Math.max(10, ...zs.map(Math.abs));
    const sidePts = sideSamples.map((s) => ({
      x: pad.l + (s.x / xMax) * plotW,
      y: pad.t + (1 - s.y / yMax) * plotH,
    }));
    // TOP: downrange runs bottom → top, side offset runs left ← 0
    // → right. Positive z (fade for a right-hander) shows to the
    // right of the centre line.
    const topPts = topSamples.map((s) => ({
      x:
        topPad.l +
        topPlotW / 2 +
        (s.z / zAbs) * (topPlotW / 2 - 6),
      y: topPad.t + topPlotH - (s.x / xMax) * topPlotH,
    }));
    return { xMax, yMax, zAbs, sidePts, topPts };
  }, [
    sideSamples,
    topSamples,
    pad.l,
    pad.t,
    plotW,
    plotH,
    topPad.l,
    topPad.t,
    topPlotW,
    topPlotH,
  ]);

  // Ticker — a fraction in [0, 1) that loops every FLIGHT_MS with
  // a REST_MS pause at the end. Positions the ball dot each frame.
  const [phase, setPhase] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    let start: number | null = null;
    const cycle = FLIGHT_MS + REST_MS;
    const step = (now: number) => {
      if (start == null) start = now;
      const elapsed = (now - start) % cycle;
      const p = elapsed < FLIGHT_MS ? elapsed / FLIGHT_MS : 1;
      setPhase(p);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  // Reset the ball to the tee whenever the target player changes so
  // the eye doesn't see it teleport to a new arc's midpoint.
  useEffect(() => {
    setPhase(0);
  }, [profile.playerId]);

  if (!Number.isFinite(carry) || carry <= 0) return null;

  const { xMax, yMax, zAbs, sidePts, topPts } = geom;

  const sidePath = sidePts
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
    )
    .join(" ");
  const topPath = topPts
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
    )
    .join(" ");

  // Ease-out on the ball so it decelerates near landing — feels
  // right for a real drive dropping into the fairway.
  const eased = 1 - Math.pow(1 - phase, 1.6);
  const idx = Math.min(
    sidePts.length - 1,
    Math.floor(eased * (sidePts.length - 1)),
  );
  const ballSide = sidePts[idx];
  const ballTop = topPts[idx];

  // Landing marker on the (portrait) top view — sits at the top of
  // the plot, offset horizontally by the mean carrySide.
  const landPx =
    topPad.l + topPlotW / 2 + (carrySide / zAbs) * (topPlotW / 2 - 6);
  const landPy = topPad.t;
  // Tee marker sits at the bottom-centre.
  const teePx = topPad.l + topPlotW / 2;
  const teePy = topPad.t + topPlotH;
  // Apex marker for the side view — the peak point of the arc.
  const apexPx = pad.l + (apexRange / 3 / xMax) * plotW;
  const apexPy = pad.t + (1 - apexHeight / yMax) * plotH;

  return (
    <div
      style={{
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 10,
        background: "white",
        padding: 14,
        marginTop: 12,
      }}
    >
      <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>
        Average ball flight
      </h3>
      <p
        style={{
          fontSize: 11,
          color: "oklch(0.5 0.02 150)",
          margin: "0 0 10px",
        }}
      >
        Side view is height vs downrange; top view is the same downrange
        axis with side drift. Curve to the right = fade, left = draw.
      </p>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 0.4,
              color: "oklch(0.5 0.02 150)",
              marginBottom: 4,
            }}
          >
            SIDE
          </div>
          <svg
            viewBox={`0 0 ${SIDE_W} ${SIDE_H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
          >
            <line
              x1={pad.l}
              y1={pad.t + plotH}
              x2={pad.l + plotW}
              y2={pad.t + plotH}
              stroke="oklch(0.85 0.013 95)"
              strokeWidth={1}
            />
            <line
              x1={pad.l}
              y1={pad.t}
              x2={pad.l}
              y2={pad.t + plotH}
              stroke="oklch(0.85 0.013 95)"
              strokeWidth={1}
            />
            <path
              d={sidePath}
              fill="none"
              stroke="oklch(0.75 0.05 145)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="3 4"
            />
            <circle
              cx={apexPx}
              cy={apexPy}
              r={3}
              fill="oklch(0.55 0.14 145)"
            />
            {ballSide && (
              <>
                <circle
                  cx={ballSide.x}
                  cy={ballSide.y}
                  r={7}
                  fill="oklch(0.55 0.14 145 / 0.18)"
                />
                <circle
                  cx={ballSide.x}
                  cy={ballSide.y}
                  r={4.5}
                  fill="white"
                  stroke="oklch(0.25 0.02 150)"
                  strokeWidth={1.2}
                />
              </>
            )}
            <text
              x={apexPx}
              y={apexPy - 6}
              fontSize={10}
              fill="oklch(0.3 0.02 150)"
              textAnchor="middle"
            >
              apex {fmt(apexHeight, 0)} ft
            </text>
            <text
              x={pad.l}
              y={SIDE_H - 6}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
            >
              0
            </text>
            <text
              x={pad.l + plotW}
              y={SIDE_H - 6}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
              textAnchor="end"
            >
              {fmt(carry, 0)} yd
            </text>
            <text
              x={4}
              y={pad.t + 8}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
            >
              {fmt(yMax, 0)} ft
            </text>
            <text
              x={pad.l - 4}
              y={pad.t + plotH}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
              textAnchor="end"
            >
              0
            </text>
          </svg>
        </div>
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 0.4,
              color: "oklch(0.5 0.02 150)",
              marginBottom: 4,
            }}
          >
            TOP
          </div>
          <svg
            viewBox={`0 0 ${TOP_W} ${TOP_H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
          >
            {/* Vertical centre line = aim / straight-ahead reference. */}
            <line
              x1={topPad.l + topPlotW / 2}
              y1={topPad.t}
              x2={topPad.l + topPlotW / 2}
              y2={topPad.t + topPlotH}
              stroke="oklch(0.85 0.013 95)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {/* Tee-box baseline. */}
            <line
              x1={topPad.l}
              y1={topPad.t + topPlotH}
              x2={topPad.l + topPlotW}
              y2={topPad.t + topPlotH}
              stroke="oklch(0.85 0.013 95)"
              strokeWidth={1}
            />
            <path
              d={topPath}
              fill="none"
              stroke="oklch(0.75 0.05 145)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="3 4"
            />
            <circle
              cx={teePx}
              cy={teePy}
              r={2.5}
              fill="oklch(0.55 0.02 150)"
            />
            <circle
              cx={landPx}
              cy={landPy}
              r={3}
              fill="oklch(0.55 0.14 145)"
            />
            {ballTop && (
              <>
                <circle
                  cx={ballTop.x}
                  cy={ballTop.y}
                  r={7}
                  fill="oklch(0.55 0.14 145 / 0.18)"
                />
                <circle
                  cx={ballTop.x}
                  cy={ballTop.y}
                  r={4.5}
                  fill="white"
                  stroke="oklch(0.25 0.02 150)"
                  strokeWidth={1.2}
                />
              </>
            )}
            <text
              x={landPx}
              y={landPy - 8}
              fontSize={10}
              fill="oklch(0.3 0.02 150)"
              textAnchor="middle"
            >
              {carrySide >= 0 ? "+" : "−"}
              {fmt(Math.abs(carrySide), 1)} yd
            </text>
            <text
              x={topPad.l + topPlotW / 2}
              y={topPad.t + topPlotH + 14}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
              textAnchor="middle"
            >
              tee
            </text>
            <text
              x={topPad.l + topPlotW / 2}
              y={topPad.t - 8}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
              textAnchor="middle"
            >
              {fmt(carry, 0)} yd carry
            </text>
            {/* Side-offset scale — halfway markers on both edges. */}
            <text
              x={topPad.l - 4}
              y={topPad.t + topPlotH / 2 + 3}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
              textAnchor="end"
            >
              −{fmt(zAbs, 0)}
            </text>
            <text
              x={topPad.l + topPlotW + 4}
              y={topPad.t + topPlotH / 2 + 3}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
            >
              +{fmt(zAbs, 0)}
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}

function ShotCloud({ profile }: { profile: PlayerDrivingProfile }) {
  const cloud = profile.cloud;
  if (cloud.length === 0) return null;

  const W = 460;
  const H = 260;
  const pad = { l: 40, r: 16, t: 12, b: 28 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const carries = cloud.map((c) => c.carry);
  const sides = cloud.map((c) => c.carrySide);
  const xMin = Math.min(...carries) - 5;
  const xMax = Math.max(...carries) + 5;
  const yAbs = Math.max(...sides.map((s) => Math.abs(s)), 10);

  const px = (v: number) =>
    pad.l + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const py = (v: number) =>
    pad.t + plotH / 2 - (v / yAbs) * (plotH / 2 - 8);

  return (
    <div
      style={{
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 10,
        background: "white",
        padding: 14,
        marginTop: 12,
      }}
    >
      <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>
        Every drive — carry vs side
      </h3>
      <p
        style={{
          fontSize: 11,
          color: "oklch(0.5 0.02 150)",
          margin: "0 0 10px",
        }}
      >
        One dot per stored tee shot. X = carry distance (yards), Y = side
        offset at landing (right +, left −). Tight cluster = repeatable
        shape; wide vertical spread = two-way shot dispersion.
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <line
          x1={pad.l}
          y1={pad.t + plotH / 2}
          x2={pad.l + plotW}
          y2={pad.t + plotH / 2}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <line
          x1={pad.l}
          y1={pad.t}
          x2={pad.l}
          y2={pad.t + plotH}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
        />
        <line
          x1={pad.l}
          y1={pad.t + plotH}
          x2={pad.l + plotW}
          y2={pad.t + plotH}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
        />
        {cloud.map((c, i) => (
          <circle
            key={i}
            cx={px(c.carry)}
            cy={py(c.carrySide)}
            r={2.4}
            fill="oklch(0.55 0.12 145 / 0.55)"
          />
        ))}
        <text
          x={pad.l}
          y={H - 6}
          fontSize={10}
          fill="oklch(0.5 0.02 150)"
        >
          {fmt(xMin, 0)}
        </text>
        <text
          x={pad.l + plotW}
          y={H - 6}
          fontSize={10}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          {fmt(xMax, 0)} yd
        </text>
        <text
          x={pad.l - 4}
          y={pad.t + 10}
          fontSize={10}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          +{fmt(yAbs, 0)}
        </text>
        <text
          x={pad.l - 4}
          y={pad.t + plotH - 2}
          fontSize={10}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          −{fmt(yAbs, 0)}
        </text>
      </svg>
    </div>
  );
}

export default function ProfileVisuals({ profile }: Props) {
  const s = profile.stats;
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <h3 style={{ fontSize: 18, margin: 0 }}>{profile.playerName}</h3>
        <span
          style={{
            fontSize: 11,
            color: "oklch(0.5 0.02 150)",
            fontFamily:
              "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
          }}
        >
          {profile.shotCount} drives · {profile.eventsCovered} events
        </span>
      </div>
      <div
        style={{
          border: "1px solid oklch(0.9 0.008 95)",
          borderRadius: 10,
          background: "white",
          padding: "10px 14px 4px",
        }}
      >
        <StatRow
          label="Ball speed"
          mean={s.ballSpeed.mean}
          std={s.ballSpeed.std}
          unit="mph"
        />
        <StatRow
          label="Carry"
          mean={s.carry.mean}
          std={s.carry.std}
          unit="yd"
        />
        <StatRow
          label="Apex height"
          mean={s.apexHeight.mean}
          std={s.apexHeight.std}
          unit="ft"
          digits={0}
        />
        <StatRow
          label="Launch angle"
          mean={s.verticalLaunchAngle.mean}
          std={s.verticalLaunchAngle.std}
          unit="°"
        />
        <StatRow
          label="Aim (horiz. launch)"
          mean={s.horizontalLaunchAngle.mean}
          std={s.horizontalLaunchAngle.std}
          unit="°"
        />
        <StatRow
          label="Curve (draw− / fade+)"
          mean={s.curve.mean}
          std={s.curve.std}
          unit="yd"
        />
        <StatRow
          label="Landing side (left− / right+)"
          mean={s.carrySide.mean}
          std={s.carrySide.std}
          unit="yd"
        />
        <StatRow
          label="Launch spin"
          mean={s.launchSpin.mean}
          std={s.launchSpin.std}
          unit="rpm"
          digits={0}
        />
        <StatRow
          label="Side spin (derived)"
          mean={s.sideSpin.mean}
          std={s.sideSpin.std}
          unit="rpm"
          digits={0}
        />
      </div>
      <TrajectoryPanel profile={profile} />
      <ShotCloud profile={profile} />
    </div>
  );
}
