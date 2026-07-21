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

import type { PlayerDrivingProfile } from "@/lib/feed/tee-shots-profile";

interface Props {
  profile: PlayerDrivingProfile;
}

/** Evaluate a polynomial [a0,a1,a2,...] at t via Horner's method. */
function polyEval(coeffs: number[], t: number): number {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = acc * t + coeffs[i];
  }
  return acc;
}

/** Sample the mean trajectory as (x, y, z) triples along its
 *  timeInterval. Coords come out in the PGA Tour's normalised frame
 *  (rough yards downrange, feet height, yards side); we don't try
 *  to fold in course-specific units. */
function sampleTrajectory(
  profile: PlayerDrivingProfile,
  n = 60,
): Array<{ t: number; x: number; y: number; z: number }> {
  const [t0, t1] = profile.averageTrajectory.timeInterval;
  const { xFit, yFit, zFit } = profile.averageTrajectory;
  const out: Array<{ t: number; x: number; y: number; z: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n);
    out.push({
      t,
      x: polyEval(xFit, t),
      y: polyEval(yFit, t),
      z: polyEval(zFit, t),
    });
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
  const samples = sampleTrajectory(profile, 80);
  if (samples.length === 0) return null;
  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);
  const zs = samples.map((s) => s.z);
  const xMax = Math.max(1, Math.max(...xs));
  const yMax = Math.max(1, Math.max(...ys));
  const zAbs = Math.max(...zs.map(Math.abs), 5);

  const SIDE_W = 460;
  const SIDE_H = 200;
  const TOP_W = 460;
  const TOP_H = 200;
  const pad = { l: 40, r: 20, t: 12, b: 24 };
  const plotW = SIDE_W - pad.l - pad.r;
  const plotH = SIDE_H - pad.t - pad.b;
  const topPlotH = TOP_H - pad.t - pad.b;

  const sidePath = samples
    .map((s, i) => {
      const px = pad.l + (s.x / xMax) * plotW;
      const py = pad.t + (1 - s.y / yMax) * plotH;
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
  const topPath = samples
    .map((s, i) => {
      const px = pad.l + (s.x / xMax) * plotW;
      // z centred: 0 at midline, ±zAbs at edges. Positive z = right
      // (fade for a right-hander).
      const py = pad.t + topPlotH / 2 - (s.z / zAbs) * (topPlotH / 2 - 6);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");

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
              stroke="oklch(0.5 0.14 145)"
              strokeWidth={2}
              strokeLinecap="round"
            />
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
              {fmt(xMax, 0)} yd
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
              x={4}
              y={pad.t + plotH}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
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
            <line
              x1={pad.l}
              y1={pad.t + topPlotH / 2}
              x2={pad.l + plotW}
              y2={pad.t + topPlotH / 2}
              stroke="oklch(0.85 0.013 95)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <line
              x1={pad.l}
              y1={pad.t}
              x2={pad.l}
              y2={pad.t + topPlotH}
              stroke="oklch(0.85 0.013 95)"
              strokeWidth={1}
            />
            <path
              d={topPath}
              fill="none"
              stroke="oklch(0.5 0.14 145)"
              strokeWidth={2}
              strokeLinecap="round"
            />
            <text
              x={pad.l}
              y={TOP_H - 6}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
            >
              0
            </text>
            <text
              x={pad.l + plotW}
              y={TOP_H - 6}
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
              +{fmt(zAbs, 0)}
            </text>
            <text
              x={pad.l - 4}
              y={pad.t + topPlotH - 2}
              fontSize={10}
              fill="oklch(0.5 0.02 150)"
              textAnchor="end"
            >
              −{fmt(zAbs, 0)}
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
