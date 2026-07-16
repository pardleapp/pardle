"use client";

import { useMemo, useState } from "react";

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

/** Gaussian-weighted rolling mean — smoother than a boxcar median
 *  because points further from the target x contribute proportionally
 *  less. Bandwidth (σ) in minutes controls how tight the smooth
 *  hugs the raw scatter. Bigger σ = smoother line.
 *
 *  Then a second pass at half-σ to knock the last kinks out; this
 *  turns a rough median-ish trace into a broadcast-style trend line. */
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
  const first = gaussPass(sorted, bandwidthMins);
  const second = gaussPass(first, bandwidthMins * 0.5);
  return second;
}

export default function Chart({ rows }: ChartProps) {
  const [hover, setHover] = useState<Row | null>(null);

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

  const xMin = Math.min(...points.map((p) => p.x));
  const xMax = Math.max(...points.map((p) => p.x));
  const yPad = 0.5;
  const yMinRaw = Math.min(...points.map((p) => p.y)) - yPad;
  const yMaxRaw = Math.max(...points.map((p) => p.y)) + yPad;
  // Symmetrise around 0 so the "outperformed vs underperformed" axis
  // reads at a glance.
  const yBound = Math.max(Math.abs(yMinRaw), Math.abs(yMaxRaw));
  const yMin = -yBound;
  const yMax = yBound;

  const xFor = (v: number) =>
    padL + ((v - xMin) / Math.max(1, xMax - xMin)) * iw;
  const yFor = (v: number) =>
    padT + ((yMax - v) / (yMax - yMin)) * ih;

  const smooth = useMemo(
    () =>
      rollingSmooth(
        points.map((p) => ({ x: p.x, y: p.y })),
        60,
      ),
    [points],
  );
  const smoothPath = smooth
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.x)} ${yFor(p.y)}`)
    .join(" ");

  // Tee-time x-axis ticks at each half-hour that has data.
  const tickStep = 60; // 1-hour ticks
  const tickStart = Math.floor(xMin / tickStep) * tickStep;
  const xTicks: number[] = [];
  for (let t = tickStart; t <= xMax; t += tickStep) xTicks.push(t);

  // Y-axis ticks — 1-stroke intervals.
  const yTicks: number[] = [];
  const yTop = Math.ceil(yMax);
  const yBot = Math.floor(yMin);
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

  return (
    <div style={{ marginTop: 12 }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          background: "white",
          border: "1px solid oklch(0.9 0.008 95)",
          borderRadius: 8,
          maxWidth: "100%",
          height: "auto",
        }}
        onMouseLeave={() => setHover(null)}
      >
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

        {/* x-axis ticks */}
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

        {/* Y-axis label */}
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
        {/* X-axis label */}
        <text
          x={padL + iw / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize={11}
          fill="#64748b"
        >
          Tee time
        </text>

        {/* rolling median line */}
        <path
          d={smoothPath}
          fill="none"
          stroke="#0284c7"
          strokeWidth={2.5}
          opacity={0.7}
        />

        {/* points */}
        {points.map((p) => {
          const y = p.y;
          const color =
            y < -0.3
              ? "#059669"
              : y > 0.3
                ? "#dc2626"
                : "#334155";
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
              onMouseEnter={() => setHover(p.row)}
            />
          );
        })}
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
            style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}
          >
            SG total {formatSigned(hover.sgTotal)}
          </span>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>R1 to par</span>
          <span
            style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}
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
