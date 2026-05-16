"use client";

import { useMemo, useState } from "react";
import type { PnlSample, TrackedBet } from "../../bet-shared";

interface Props {
  bet: TrackedBet;
  history: PnlSample[];
}

const PAD = { top: 28, right: 18, bottom: 36, left: 52 };
const W = 900;
const H = 380;

export default function BetChartFull({ bet, history }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const isRound = bet.kind === "round-score";

  const data = useMemo(() => {
    if (history.length === 0) return null;
    const stake = bet.stake;

    const xs: number[] = isRound
      ? history.map((s, i) => s.holesPlayed ?? i)
      : history.map((s) => s.t);
    const ys = history.map((s) => ((s.v - stake) / stake) * 100);

    const xMin = xs[0];
    const xMaxRaw = xs[xs.length - 1];
    const xMax = isRound
      ? Math.max(18, Math.ceil(xMaxRaw))
      : Math.max(xMaxRaw, xMin + 1);

    const yMaxStake = Math.max(0, ...ys);
    const yMinStake = Math.min(0, ...ys);
    const range = Math.max(yMaxStake - yMinStake, 4);
    const headroom = range * 0.15;
    const yMax = yMaxStake + headroom;
    const yMin = yMinStake - headroom;

    const xScale = (x: number) =>
      PAD.left + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.left - PAD.right);
    const yScale = (y: number) =>
      PAD.top + ((yMax - y) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);

    const points = history.map((_, i) => ({
      x: xScale(xs[i]),
      y: yScale(ys[i]),
      raw: history[i],
      xVal: xs[i],
      yVal: ys[i],
    }));

    const zeroY = yScale(0);
    const linePath = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");

    return {
      points,
      linePath,
      zeroY,
      xMin,
      xMax,
      yMin,
      yMax,
      xScale,
      yScale,
      latestY: ys[ys.length - 1],
    };
  }, [history, isRound, bet.stake]);

  if (!data || history.length < 2) {
    return (
      <div className="bd-chart-empty">
        Chart will fill in as {isRound ? "holes complete" : "odds shift"} after
        the bet was placed.
      </div>
    );
  }

  const { points, linePath, zeroY, xMin, xMax, yMin, yMax, xScale } = data;

  const yTicks = buildYTicks(yMin, yMax);
  const xTicks = isRound
    ? buildHoleTicks(xMin, xMax)
    : buildTimeTicks(xMin, xMax);

  const profitNow = points[points.length - 1].yVal;
  const lineColor = profitNow >= 0 ? "#2c7a28" : "#b13838";
  const fillColor =
    profitNow >= 0 ? "rgba(44,122,40,0.16)" : "rgba(177,56,56,0.16)";

  const areaPath = `M${points[0].x.toFixed(2)},${zeroY.toFixed(2)} ${points
    .map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ")} L${points[points.length - 1].x.toFixed(2)},${zeroY.toFixed(2)} Z`;

  const hover = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="bd-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="bd-chart-svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="PnL chart since bet placed"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const svgX = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < points.length; i++) {
            const d = Math.abs(points[i].x - svgX);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          setHoverIdx(best);
        }}
      >
        {yTicks.map((t) => {
          const y = data.yScale(t);
          return (
            <g key={`y${t}`} className="bd-grid">
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke={t === 0 ? "var(--border)" : "var(--border)"}
                strokeWidth={t === 0 ? 1.5 : 0.5}
                strokeDasharray={t === 0 ? "" : "3 4"}
                opacity={t === 0 ? 0.9 : 0.55}
              />
              <text
                x={PAD.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--muted)"
              >
                {t > 0 ? `+${t.toFixed(0)}%` : `${t.toFixed(0)}%`}
              </text>
            </g>
          );
        })}

        {xTicks.map((tk) => (
          <g key={`x${tk.x}-${tk.label}`}>
            <line
              x1={xScale(tk.x)}
              x2={xScale(tk.x)}
              y1={H - PAD.bottom}
              y2={H - PAD.bottom + 5}
              stroke="var(--muted)"
              strokeWidth={0.6}
            />
            <text
              x={xScale(tk.x)}
              y={H - PAD.bottom + 20}
              textAnchor="middle"
              fontSize="11"
              fill="var(--muted)"
            >
              {tk.label}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={fillColor} />
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoverIdx === i ? 4.5 : 2.2}
            fill={lineColor}
            opacity={hoverIdx === i ? 1 : 0.85}
          />
        ))}

        {hover && (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--muted)"
              strokeDasharray="2 3"
              strokeWidth={0.8}
            />
          </g>
        )}

        <text
          x={W - PAD.right}
          y={PAD.top - 10}
          textAnchor="end"
          fontSize="11"
          fill="var(--muted)"
          fontWeight={700}
        >
          {isRound ? "Holes played" : "Time"} → PnL %
        </text>
      </svg>

      <div className="bd-chart-foot">
        {hover ? (
          <span className="bd-chart-hover">
            <strong>
              {isRound
                ? `Hole ${hover.raw.holesPlayed ?? hover.xVal}`
                : new Date(hover.raw.t).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
            </strong>{" "}
            ·{" "}
            <span
              className={
                hover.yVal > 0
                  ? "bets-profit-up"
                  : hover.yVal < 0
                  ? "bets-profit-down"
                  : ""
              }
            >
              {hover.yVal > 0 ? "+" : ""}
              {hover.yVal.toFixed(1)}%
            </span>
          </span>
        ) : (
          <span className="bd-chart-foot-hint">
            {isRound
              ? "Each step = a completed hole since the bet was placed."
              : "PnL since bet placement, valued from live market odds."}
          </span>
        )}
      </div>
    </div>
  );
}

function buildYTicks(yMin: number, yMax: number): number[] {
  const ticks = new Set<number>();
  ticks.add(0);
  const span = yMax - yMin;
  const step = niceStep(span / 4);
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    ticks.add(Number(v.toFixed(2)));
  }
  return Array.from(ticks).sort((a, b) => a - b);
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * pow;
}

function buildHoleTicks(
  xMin: number,
  xMax: number,
): { x: number; label: string }[] {
  const out: { x: number; label: string }[] = [];
  const stops = [0, 3, 6, 9, 12, 15, 18];
  for (const s of stops) {
    if (s >= xMin && s <= xMax) {
      out.push({ x: s, label: s === 0 ? "Placed" : `${s}` });
    }
  }
  return out;
}

function buildTimeTicks(
  xMin: number,
  xMax: number,
): { x: number; label: string }[] {
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  const mid = xMin + (xMax - xMin) / 2;
  return [
    { x: xMin, label: fmt(xMin) },
    { x: mid, label: fmt(mid) },
    { x: xMax, label: fmt(xMax) },
  ];
}
