"use client";

import { useMemo, useState } from "react";
import type { PnlSample, TrackedBet } from "../../bet-shared";
import PastBetReplay from "./PastBetReplay";

interface Props {
  bet: TrackedBet;
  history: PnlSample[];
  /** Optional element rendered to the right of the chart's mode
   *  toggle (PnL £ / Win %). Used by the round-score view to put
   *  the "R1 LIVE · Thru X · −Y" pill on the same row as the
   *  toggle, saving a full stacked row of vertical space on
   *  phones. */
  headerRight?: React.ReactNode;
}

type Mode = "pnl" | "prob";

const PAD = { top: 28, right: 18, bottom: 36, left: 60 };
const W = 900;
const H = 380;

// Currency moved to lib/format/bet-currency. Formatters below take
// the BetCurrency carried on each bet so US/EU users see their own
// symbol throughout the chart.
import { formatBetCurrency, type BetCurrency } from "@/lib/format/bet-currency";

export default function BetChartFull({ bet, history, headerRight }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("prob");

  const isRound = bet.kind === "round-score";
  const winningValue = bet.stake * bet.oddsTaken;

  const data = useMemo(() => {
    if (history.length === 0) return null;
    const stake = bet.stake;

    const xs: number[] = isRound
      ? history.map((s, i) => s.holesPlayed ?? i)
      : history.map((s) => s.t);

    const ys =
      mode === "pnl"
        ? history.map((s) => s.v - stake)
        : history.map(
            (s) =>
              clamp01(s.prob != null ? s.prob : s.v / winningValue) * 100,
          );

    const baseline = mode === "pnl" ? 0 : ys[0];

    const xMin = xs[0];
    const xMaxRaw = xs[xs.length - 1];
    const xMax = isRound
      ? Math.max(18, Math.ceil(xMaxRaw))
      : Math.max(xMaxRaw, xMin + 1);

    const yMaxRaw = Math.max(baseline, ...ys);
    const yMinRaw = Math.min(baseline, ...ys);
    const minRange = mode === "pnl" ? Math.max(stake * 0.2, 2) : 6;
    const range = Math.max(yMaxRaw - yMinRaw, minRange);
    const headroom = range * 0.15;
    let yMax = yMaxRaw + headroom;
    let yMin = yMinRaw - headroom;
    if (mode === "prob") {
      yMax = Math.min(100, yMax);
      yMin = Math.max(0, yMin);
    }

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

    const baseY = yScale(baseline);
    const linePath = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");

    return {
      points,
      linePath,
      baseY,
      baseline,
      xMin,
      xMax,
      yMin,
      yMax,
      xScale,
      yScale,
      latestY: ys[ys.length - 1],
    };
  }, [history, isRound, bet.stake, mode, winningValue]);

  if (!data || history.length < 2) {
    // Settled bets with no live chart history (typically past-
    // tournament bets whose odds buffer has aged out of Redis).
    // Fetch a hole-by-hole replay from the orchestrator and render
    // that instead — running to-par across the player's tournament,
    // with round boundaries and the bet's settlement marker.
    if (bet.settledAt != null && bet.settledWon != null) {
      return <PastBetReplay bet={bet} />;
    }
    return (
      <div className="bd-chart">
        <div className="bd-chart-header">
          <ChartToggle mode={mode} setMode={setMode} />
          {headerRight}
        </div>
        <div className="bd-chart-empty">
          {isRound
            ? "Chart will fill in as holes complete."
            : bet.kind === "winning-score"
            ? "Chart will fill in as scores move through the round."
            : bet.kind === "top-finish"
            ? "Chart will fill in as the model updates through the round."
            : "Chart will fill in as odds change."}
        </div>
      </div>
    );
  }

  const { points, linePath, baseY, baseline, xMin, xMax, yMin, yMax, xScale, latestY } =
    data;

  const yTicks = buildYTicks(yMin, yMax, baseline, (v) =>
    formatY(v, mode, bet.currency),
  );
  const xTicks = isRound
    ? buildHoleTicks(xMin, xMax)
    : buildTimeTicks(xMin, xMax);

  const isUp = latestY >= baseline;
  const lineColor = isUp ? "#2c7a28" : "#b13838";
  const fillColor = isUp ? "rgba(44,122,40,0.16)" : "rgba(177,56,56,0.16)";

  const areaPath = `M${points[0].x.toFixed(2)},${baseY.toFixed(2)} ${points
    .map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ")} L${points[points.length - 1].x.toFixed(2)},${baseY.toFixed(2)} Z`;

  const hover = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="bd-chart">
      <div className="bd-chart-header">
        <ChartToggle mode={mode} setMode={setMode} />
        {headerRight}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="bd-chart-svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={mode === "pnl" ? "Profit/loss chart" : "Win probability chart"}
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
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (!t) return;
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const svgX = ((t.clientX - rect.left) / rect.width) * W;
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
        onTouchEnd={() => setHoverIdx(null)}
      >
        {yTicks.map((t) => {
          const y = data.yScale(t);
          const isBaseline = Math.abs(t - baseline) < 1e-6;
          return (
            <g key={`y${t}`} className="bd-grid">
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={isBaseline ? 1.5 : 0.5}
                strokeDasharray={isBaseline ? "" : "3 4"}
                opacity={isBaseline ? 0.9 : 0.55}
              />
              <text
                x={PAD.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--muted)"
              >
                {formatY(t, mode)}
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
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--muted)"
            strokeDasharray="2 3"
            strokeWidth={0.8}
          />
        )}

        <text
          x={W - PAD.right}
          y={PAD.top - 10}
          textAnchor="end"
          fontSize="11"
          fill="var(--muted)"
          fontWeight={700}
        >
          {isRound ? "Holes played" : "Time"} →{" "}
          {mode === "pnl" ? "Profit / loss" : "Implied win chance"}
        </text>
      </svg>

      <div className="bd-chart-foot">
        {hover ? (
          <span className="bd-chart-hover">
            <strong>
              {isRound
                ? `Hole ${hover.raw.holesPlayed ?? hover.xVal}`
                : new Date(hover.raw.t).toLocaleString(undefined, {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
            </strong>{" "}
            ·{" "}
            <span className={tintFor(hover.yVal, baseline)}>
              {formatHoverValue(hover.yVal, mode, bet.currency)}
            </span>
          </span>
        ) : (
          <span className="bd-chart-foot-hint">
            {mode === "pnl"
              ? isRound
                ? "Each step = a completed hole. Baseline = break-even (stake)."
                : "Profit/loss since bet placement, valued from live market odds."
              : `Now ${formatProbForFoot(currentProbFor(history))} · pre-round ${formatProbForFoot(
                  preRoundProbFor(history),
                )} · your @ ${bet.oddsTakenLabel} = ${formatProbForFoot(
                  1 / bet.oddsTaken,
                )} implied`}
          </span>
        )}
      </div>
    </div>
  );
}

function ChartToggle({
  mode,
  setMode,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  return (
    <div className="bd-chart-toggle" role="tablist" aria-label="Chart mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "pnl"}
        className={mode === "pnl" ? "bd-chart-toggle-on" : ""}
        onClick={() => setMode("pnl")}
      >
        PnL £
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "prob"}
        className={mode === "prob" ? "bd-chart-toggle-on" : ""}
        onClick={() => setMode("prob")}
      >
        Win %
      </button>
    </div>
  );
}

function preRoundProbFor(history: PnlSample[]): number {
  return history[0]?.prob ?? 0;
}

/** Latest model probability — last sample in the history series.
 *  Falls back through the chain so we always have something
 *  sensible to render in the footer summary. */
function currentProbFor(history: PnlSample[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i]?.prob;
    if (typeof p === "number" && Number.isFinite(p)) return p;
  }
  return history[0]?.prob ?? 0;
}

/** Compact win-prob format for the chart footer summary: 1
 *  decimal under 5 %, integer otherwise. */
function formatProbForFoot(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1) return "100%";
  const pct = p * 100;
  if (pct < 5) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function tintFor(v: number, baseline: number): string {
  if (v > baseline + 1e-6) return "bets-profit-up";
  if (v < baseline - 1e-6) return "bets-profit-down";
  return "";
}

function formatY(v: number, mode: Mode, currency?: BetCurrency): string {
  if (mode === "prob") {
    // Sub-percent values lose visual fidelity at toFixed(0). Show 1
    // decimal under 5% so a 0.2% baseline doesn't read the same as
    // a hard-clamped 0%.
    if (v > 0 && v < 5) return `${v.toFixed(1)}%`;
    return `${v.toFixed(0)}%`;
  }
  if (Math.abs(v) < 0.005) {
    return formatBetCurrency(0, currency, { maximumFractionDigits: 0 });
  }
  const sign = v > 0 ? "+" : "−";
  return `${sign}${formatBetCurrency(Math.abs(v), currency, { maximumFractionDigits: 0 })}`;
}

function formatHoverValue(
  v: number,
  mode: Mode,
  currency?: BetCurrency,
): string {
  if (mode === "prob") return `${v.toFixed(1)}% chance`;
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${formatBetCurrency(Math.abs(v), currency)}`;
}

function buildYTicks(
  yMin: number,
  yMax: number,
  baseline: number,
  labelFor: (v: number) => string,
): number[] {
  const candidates: number[] = [];
  candidates.push(Number(baseline.toFixed(2)));
  const span = yMax - yMin;
  const step = niceStep(span / 4);
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    candidates.push(Number(v.toFixed(2)));
  }
  // Dedupe by rendered label so values that round to the same string
  // (e.g. baseline 0.2% and yMin 0% both rendering as "0%") don't
  // stack into a visually-confusing pair on the axis.
  const seenLabels = new Set<string>();
  const out: number[] = [];
  for (const v of candidates.sort((a, b) => a - b)) {
    const label = labelFor(v);
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    out.push(v);
  }
  return out;
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
      out.push({ x: s, label: s === 0 ? "Tee off" : `${s}` });
    }
  }
  return out;
}

function buildTimeTicks(
  xMin: number,
  xMax: number,
): { x: number; label: string }[] {
  const span = xMax - xMin;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  // For multi-day ranges (past-tournament replays) show day + short
  // time so the user can see "Thu 09:00 → Sun 17:30" rather than
  // three confusing single-day clock times. For sub-day ranges
  // (live within a single round) keep the compact HH:MM.
  const fmt =
    span >= ONE_DAY
      ? (t: number) =>
          new Date(t).toLocaleString(undefined, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
      : (t: number) =>
          new Date(t).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          });
  // Use 4 ticks for a multi-day chart so each tournament day gets a
  // label; 3 still works for the compact single-day case.
  const nTicks = span >= ONE_DAY ? 4 : 3;
  const ticks: { x: number; label: string }[] = [];
  for (let i = 0; i < nTicks; i++) {
    const x = xMin + ((xMax - xMin) * i) / (nTicks - 1);
    ticks.push({ x, label: fmt(x) });
  }
  return ticks;
}
