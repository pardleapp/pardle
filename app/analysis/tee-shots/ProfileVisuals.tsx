"use client";

/**
 * Dashboard-grade layout for the selected player's profile:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Player header (name · shot count · events)          │
 *   ├──────────────────────┬───────────────────────────────┤
 *   │  Stats grid (2-col)  │  Ball flight card             │
 *   ├──────────────────────┤   (SIDE landscape stacked on  │
 *   │  Similar drivers     │    TOP portrait, both animated) │
 *   ├──────────────────────┴───────────────────────────────┤
 *   │  Shot cloud — every drive, carry vs side              │
 *   └──────────────────────────────────────────────────────┘
 *
 * The outer grid lives in globals.css (.ts-dashboard); this file
 * just supplies the four area contents plus the ball animation
 * ticker. Mobile ignores the grid areas and the cards stack in
 * their DOM order.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayerDrivingProfile } from "@/lib/feed/tee-shots-profile";
import SimilarList from "./SimilarList";

interface Props {
  profile: PlayerDrivingProfile;
}

const FLIGHT_MS = 2800; // one loop of the ball animation
const REST_MS = 900;

// ── Ball-flight sampling ────────────────────────────────────────────

/** Lagrange quadratic through (0,0), (x1,y1), (x2,y2). */
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

/** Piecewise parabolas through launch → apex → landing so the peak
 *  stays anchored to the mean apex range instead of drifting to the
 *  arithmetic midpoint. */
function sampleSide(
  carryYd: number,
  apexRangeFt: number,
  apexHeightFt: number,
  n = 60,
): Array<{ x: number; y: number }> {
  const carryFt = carryYd * 3;
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
    out.push({ x: xFt / 3, y });
  }
  return out;
}

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

// ── Formatters ──────────────────────────────────────────────────────

function fmt(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtSigned(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05 && digits < 2) return "0";
  return v > 0 ? `+${v.toFixed(digits)}` : `−${Math.abs(v).toFixed(digits)}`;
}

// ── Card chrome ────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  border: "1px solid oklch(0.9 0.008 95)",
  borderRadius: 10,
  background: "white",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const CARD_TITLE: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  fontWeight: 700,
  color: "oklch(0.35 0.02 150)",
  margin: 0,
};

const CARD_SUBTITLE: React.CSSProperties = {
  fontSize: 13,
  color: "oklch(0.5 0.02 150)",
  margin: "4px 0 14px",
  lineHeight: 1.4,
};

const MONO: React.CSSProperties = {
  fontFamily:
    "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
  fontVariantNumeric: "tabular-nums",
};

// ── Player header (spans full width) ────────────────────────────────

function PlayerHeader({ profile }: { profile: PlayerDrivingProfile }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "0 2px 10px",
        borderBottom: "1px solid oklch(0.92 0.008 95)",
        marginBottom: 12,
      }}
    >
      <h3
        style={{
          fontSize: 22,
          margin: 0,
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, sans-serif",
          letterSpacing: "-0.01em",
        }}
      >
        {profile.playerName}
      </h3>
      <span
        style={{
          ...MONO,
          fontSize: 12,
          color: "oklch(0.5 0.02 150)",
        }}
      >
        {profile.shotCount} drives · {profile.eventsCovered} events
      </span>
    </header>
  );
}

// ── Stats card — dense 2-column grid ────────────────────────────────

interface Stat {
  label: string;
  mean: number;
  std: number;
  unit: string;
  digits?: number;
  signed?: boolean;
}

function StatCell({ stat }: { stat: Stat }) {
  const value = stat.signed
    ? fmtSigned(stat.mean, stat.digits ?? 1)
    : fmt(stat.mean, stat.digits ?? 1);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        alignItems: "baseline",
        columnGap: 12,
        padding: "10px 0",
        borderBottom: "1px solid oklch(0.945 0.008 95)",
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "oklch(0.42 0.02 150)",
          letterSpacing: 0.2,
        }}
      >
        {stat.label}
      </span>
      <span
        style={{
          ...MONO,
          fontSize: 17,
          fontWeight: 700,
          color: "oklch(0.18 0.02 150)",
          whiteSpace: "nowrap",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
        <span
          style={{ color: "oklch(0.55 0.02 150)", fontWeight: 400, fontSize: 13 }}
        >{` ${stat.unit}`}</span>
      </span>
      <span
        style={{
          ...MONO,
          fontSize: 12,
          color: "oklch(0.58 0.02 150)",
          minWidth: 54,
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        ±{fmt(stat.std, stat.digits ?? 1)}
      </span>
    </div>
  );
}

function StatsCard({ profile }: { profile: PlayerDrivingProfile }) {
  const s = profile.stats;
  const stats: Stat[] = [
    { label: "Ball speed", mean: s.ballSpeed.mean, std: s.ballSpeed.std, unit: "mph" },
    { label: "Carry", mean: s.carry.mean, std: s.carry.std, unit: "yd" },
    {
      label: "Apex height",
      mean: s.apexHeight.mean,
      std: s.apexHeight.std,
      unit: "ft",
      digits: 0,
    },
    {
      label: "Launch angle",
      mean: s.verticalLaunchAngle.mean,
      std: s.verticalLaunchAngle.std,
      unit: "°",
    },
    {
      label: "Aim",
      mean: s.horizontalLaunchAngle.mean,
      std: s.horizontalLaunchAngle.std,
      unit: "°",
      signed: true,
    },
    {
      label: "Curve",
      mean: s.curve.mean,
      std: s.curve.std,
      unit: "yd",
      signed: true,
    },
    {
      label: "Landing side",
      mean: s.carrySide.mean,
      std: s.carrySide.std,
      unit: "yd",
      signed: true,
    },
    {
      label: "Launch spin",
      mean: s.launchSpin.mean,
      std: s.launchSpin.std,
      unit: "rpm",
      digits: 0,
    },
    {
      label: "Side spin",
      mean: s.sideSpin.mean,
      std: s.sideSpin.std,
      unit: "rpm",
      digits: 0,
      signed: true,
    },
  ];
  return (
    <div style={CARD} className="ts-area-stats">
      <h4 style={CARD_TITLE}>Radar profile</h4>
      <p style={CARD_SUBTITLE}>Mean and ±1σ across every stored drive.</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          columnGap: 20,
        }}
      >
        {stats.map((stat) => (
          <StatCell key={stat.label} stat={stat} />
        ))}
      </div>
    </div>
  );
}

// ── Ball flight card ────────────────────────────────────────────────

function BallFlightCard({ profile }: { profile: PlayerDrivingProfile }) {
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
  const SIDE_H = 180;
  const TOP_W = 260;
  const TOP_H = 360;
  const pad = { l: 44, r: 20, t: 12, b: 22 };
  const topPad = { l: 26, r: 26, t: 22, b: 30 };
  const plotW = SIDE_W - pad.l - pad.r;
  const plotH = SIDE_H - pad.t - pad.b;
  const topPlotW = TOP_W - topPad.l - topPad.r;
  const topPlotH = TOP_H - topPad.t - topPad.b;

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
  useEffect(() => {
    setPhase(0);
  }, [profile.playerId]);

  if (!Number.isFinite(carry) || carry <= 0) {
    return (
      <div style={CARD} className="ts-area-ballflight">
        <h4 style={CARD_TITLE}>Average ball flight</h4>
        <p style={CARD_SUBTITLE}>Not enough radar data.</p>
      </div>
    );
  }

  const { xMax, yMax, zAbs, sidePts, topPts } = geom;

  const sidePath = sidePts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const topPath = topPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const eased = 1 - Math.pow(1 - phase, 1.6);
  const idx = Math.min(
    sidePts.length - 1,
    Math.floor(eased * (sidePts.length - 1)),
  );
  const ballSide = sidePts[idx];
  const ballTop = topPts[idx];

  const landPx =
    topPad.l + topPlotW / 2 + (carrySide / zAbs) * (topPlotW / 2 - 6);
  const landPy = topPad.t;
  const teePx = topPad.l + topPlotW / 2;
  const teePy = topPad.t + topPlotH;
  const apexPx = pad.l + (apexRange / 3 / xMax) * plotW;
  const apexPy = pad.t + (1 - apexHeight / yMax) * plotH;

  return (
    <div
      style={{
        ...CARD,
        gap: 6,
        // Fill vertical span so the card matches the stacked
        // stats+similar column height.
        height: "100%",
      }}
      className="ts-area-ballflight"
    >
      <h4 style={CARD_TITLE}>Average ball flight</h4>
      <p style={CARD_SUBTITLE}>
        Side view: height vs downrange. Top view: driver&apos;s-eye — ball
        flies up, drift shows left/right.
      </p>

      <div
        style={{
          fontSize: 11,
          letterSpacing: 0.6,
          fontWeight: 700,
          color: "oklch(0.42 0.02 150)",
          marginTop: 4,
          textTransform: "uppercase",
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
        <text
          x={apexPx}
          y={apexPy - 6}
          fontSize={12}
          fill="oklch(0.3 0.02 150)"
          textAnchor="middle"
        >
          apex {fmt(apexHeight, 0)} ft
        </text>
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
          x={pad.l}
          y={SIDE_H - 6}
          fontSize={12}
          fill="oklch(0.5 0.02 150)"
        >
          0
        </text>
        <text
          x={pad.l + plotW}
          y={SIDE_H - 6}
          fontSize={12}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          {fmt(carry, 0)} yd
        </text>
        <text x={4} y={pad.t + 8} fontSize={12} fill="oklch(0.5 0.02 150)">
          {fmt(yMax, 0)} ft
        </text>
        <text
          x={pad.l - 4}
          y={pad.t + plotH}
          fontSize={12}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          0
        </text>
      </svg>

      <div
        style={{
          fontSize: 11,
          letterSpacing: 0.6,
          fontWeight: 700,
          color: "oklch(0.42 0.02 150)",
          marginTop: 12,
          textTransform: "uppercase",
        }}
      >
        TOP
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          // Constrain TOP width so the tall portrait SVG doesn't
          // dominate on very wide cards. The centering keeps it
          // visually anchored while the card border stays flush.
          alignSelf: "center",
          width: "min(100%, 320px)",
          flex: 1,
        }}
      >
        <svg
          viewBox={`0 0 ${TOP_W} ${TOP_H}`}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
          }}
        >
          <line
            x1={topPad.l + topPlotW / 2}
            y1={topPad.t}
            x2={topPad.l + topPlotW / 2}
            y2={topPad.t + topPlotH}
            stroke="oklch(0.85 0.013 95)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
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
            fontSize={12}
            fill="oklch(0.3 0.02 150)"
            textAnchor="middle"
          >
            {carrySide >= 0 ? "+" : "−"}
            {fmt(Math.abs(carrySide), 1)} yd
          </text>
          <text
            x={topPad.l + topPlotW / 2}
            y={topPad.t + topPlotH + 14}
            fontSize={12}
            fill="oklch(0.5 0.02 150)"
            textAnchor="middle"
          >
            tee
          </text>
          <text
            x={topPad.l + topPlotW / 2}
            y={topPad.t - 8}
            fontSize={12}
            fill="oklch(0.5 0.02 150)"
            textAnchor="middle"
          >
            {fmt(carry, 0)} yd carry
          </text>
          <text
            x={topPad.l - 4}
            y={topPad.t + topPlotH / 2 + 3}
            fontSize={12}
            fill="oklch(0.5 0.02 150)"
            textAnchor="end"
          >
            −{fmt(zAbs, 0)}
          </text>
          <text
            x={topPad.l + topPlotW + 4}
            y={topPad.t + topPlotH / 2 + 3}
            fontSize={12}
            fill="oklch(0.5 0.02 150)"
          >
            +{fmt(zAbs, 0)}
          </text>
        </svg>
      </div>
    </div>
  );
}

// ── Scatter card — full-width shot cloud ─────────────────────────────

function ShotCloudCard({ profile }: { profile: PlayerDrivingProfile }) {
  const cloud = profile.cloud;
  if (cloud.length === 0) return null;

  // Rotated so side offset lives on the horizontal axis — dots
  // literally sit LEFT or RIGHT of the vertical aim line, matching
  // the top-view convention. Y is carry distance, growing upward.
  const W = 1200;
  const H = 340;
  const pad = { l: 56, r: 60, t: 22, b: 42 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const carries = cloud.map((c) => c.carry);
  const sides = cloud.map((c) => c.carrySide);
  const yMin = Math.min(...carries) - 5;
  const yMax = Math.max(...carries) + 5;
  const xAbs = Math.max(...sides.map((s) => Math.abs(s)), 10);

  // px(side) — 0 sits at the horizontal centre of the plot.
  const px = (side: number) =>
    pad.l + plotW / 2 + (side / xAbs) * (plotW / 2 - 8);
  // py(carry) — larger carry = higher on the plot (smaller SVG y).
  const py = (carry: number) =>
    pad.t + plotH - ((carry - yMin) / (yMax - yMin || 1)) * plotH;

  const meanSide = profile.shape.carrySide;
  const meanCarry = profile.shape.carry;

  return (
    <div style={CARD} className="ts-area-scatter">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <h4 style={CARD_TITLE}>Every drive — landing pattern</h4>
        <span style={{ ...MONO, fontSize: 12, color: "oklch(0.55 0.02 150)" }}>
          {cloud.length} shots
        </span>
      </div>
      <p style={CARD_SUBTITLE}>
        Top-down view. Vertical dashed line = aim. Dots left of it
        landed left of aim, dots right of it landed right. Height on
        the plot = carry distance.
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Aim reference — vertical dashed centre line at side = 0. */}
        <line
          x1={pad.l + plotW / 2}
          y1={pad.t}
          x2={pad.l + plotW / 2}
          y2={pad.t + plotH}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
          strokeDasharray="4 5"
        />
        {/* Left y-axis (carry scale). */}
        <line
          x1={pad.l}
          y1={pad.t}
          x2={pad.l}
          y2={pad.t + plotH}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
        />
        {/* Bottom axis (side scale). */}
        <line
          x1={pad.l}
          y1={pad.t + plotH}
          x2={pad.l + plotW}
          y2={pad.t + plotH}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
        />
        {/* Mean marker — vertical coloured line at the mean side
             offset, so the "-10.3 yd" is instantly visible against
             the scatter. */}
        <line
          x1={px(meanSide)}
          y1={pad.t}
          x2={px(meanSide)}
          y2={pad.t + plotH}
          stroke="oklch(0.55 0.14 145)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        {/* Mean dot at (meanSide, meanCarry). */}
        <circle
          cx={px(meanSide)}
          cy={py(meanCarry)}
          r={5.5}
          fill="oklch(0.5 0.14 145)"
          stroke="white"
          strokeWidth={2}
        />
        {cloud.map((c, i) => (
          <circle
            key={i}
            cx={px(c.carrySide)}
            cy={py(c.carry)}
            r={3.6}
            fill="oklch(0.55 0.12 145 / 0.55)"
          />
        ))}
        {/* X-axis (side) labels. */}
        <text
          x={pad.l}
          y={H - 8}
          fontSize={13}
          fill="oklch(0.5 0.02 150)"
        >
          ← left {fmt(xAbs, 0)} yd
        </text>
        <text
          x={pad.l + plotW / 2}
          y={H - 8}
          fontSize={12}
          fill="oklch(0.35 0.02 150)"
          textAnchor="middle"
          fontWeight={700}
        >
          aim
        </text>
        <text
          x={pad.l + plotW}
          y={H - 8}
          fontSize={13}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          right {fmt(xAbs, 0)} yd →
        </text>
        {/* Y-axis (carry) labels. */}
        <text
          x={pad.l - 6}
          y={pad.t + 10}
          fontSize={13}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          {fmt(yMax, 0)} yd
        </text>
        <text
          x={pad.l - 6}
          y={pad.t + plotH - 2}
          fontSize={13}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          {fmt(yMin, 0)}
        </text>
        {/* Mean readout at top-right. */}
        <text
          x={pad.l + plotW - 4}
          y={pad.t + 14}
          fontSize={13}
          fill="oklch(0.35 0.14 145)"
          textAnchor="end"
          fontWeight={700}
        >
          mean {meanSide >= 0 ? "+" : "−"}
          {fmt(Math.abs(meanSide), 1)} yd ·{" "}
          {fmt(meanCarry, 0)} yd carry
        </text>
      </svg>
    </div>
  );
}

// ── The dashboard ───────────────────────────────────────────────────

export default function ProfileVisuals({ profile }: Props) {
  return (
    <div>
      <PlayerHeader profile={profile} />
      <div className="ts-dashboard">
        <StatsCard profile={profile} />
        <BallFlightCard profile={profile} />
        <div className="ts-area-similar" style={{ minWidth: 0 }}>
          <SimilarList playerId={profile.playerId} />
        </div>
        <ShotCloudCard profile={profile} />
      </div>
    </div>
  );
}
