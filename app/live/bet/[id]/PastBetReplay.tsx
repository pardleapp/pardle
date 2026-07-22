"use client";

import { useEffect, useState } from "react";
import type { TrackedBet } from "../../bet-shared";

interface ReplayResponse {
  tournament: {
    id: string;
    name: string;
    startDate: number;
  };
  bet: {
    id: string;
    kind: string;
    settledWon: boolean;
    stake: number;
    oddsTaken: number;
    line: number | null;
    side: string | null;
    cutoff: number | null;
    round: number | null;
  };
  series: Array<{
    playerId: string;
    playerName: string;
    points: Array<{ holeIndex: number; round: number; toPar: number }>;
    finalToPar: number;
    finalPosition: string | null;
  }>;
}

import { formatBetCurrency } from "@/lib/format/bet-currency";

export default function PastBetReplay({ bet }: { bet: TrackedBet }) {
  const [data, setData] = useState<ReplayResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bets/${encodeURIComponent(bet.id)}/replay`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setErr(j.error ?? `replay-${r.status}`);
          return;
        }
        const j = (await r.json()) as ReplayResponse;
        if (!cancelled) setData(j);
      })
      .catch(() => {
        if (!cancelled) setErr("network");
      });
    return () => {
      cancelled = true;
    };
  }, [bet.id]);

  if (err) {
    return (
      <div className="bd-chart-settled">
        <PastSettledHeadline bet={bet} />
        <p className="bd-chart-settled-note">
          Couldn&apos;t load the past-tournament replay ({err}). The result
          is final.
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bd-chart-settled">
        <PastSettledHeadline bet={bet} />
        <p className="bd-chart-settled-note">Loading the replay…</p>
      </div>
    );
  }

  const series = data.series[0];
  if (!series || series.points.length === 0) {
    return (
      <div className="bd-chart-settled">
        <PastSettledHeadline bet={bet} />
        <p className="bd-chart-settled-note">
          {data.tournament.name} · no hole-by-hole data available
        </p>
      </div>
    );
  }

  return (
    <div className="bd-chart">
      <div className="bd-past-header">
        <div className="bd-past-tournament">{data.tournament.name}</div>
        <PastSettledHeadlineInline bet={bet} />
      </div>
      <ReplayChart
        points={series.points}
        playerName={series.playerName}
        won={data.bet.settledWon}
        line={data.bet.line}
        side={data.bet.side}
        cutoff={data.bet.cutoff}
        kind={data.bet.kind}
        round={data.bet.round}
      />
      <div className="bd-past-meta">
        <span>
          <strong>{series.playerName}</strong> finished{" "}
          {series.finalToPar >= 0 ? "+" : ""}
          {series.finalToPar}
          {series.finalPosition ? ` · ${series.finalPosition}` : ""}
        </span>
      </div>
    </div>
  );
}

function PastSettledHeadline({ bet }: { bet: TrackedBet }) {
  const won = bet.settledWon === true;
  const profit = won ? bet.stake * bet.oddsTaken - bet.stake : -bet.stake;
  return (
    <>
      <div
        className={`bd-chart-settled-headline ${
          won ? "bets-profit-up" : "bets-profit-down"
        }`}
      >
        {won ? "Won" : "Lost"}
      </div>
      <div className="bd-chart-settled-pnl">
        {profit >= 0 ? "+" : ""}
        {formatBetCurrency(profit, bet.currency)}
      </div>
    </>
  );
}

function PastSettledHeadlineInline({ bet }: { bet: TrackedBet }) {
  const won = bet.settledWon === true;
  const profit = won ? bet.stake * bet.oddsTaken - bet.stake : -bet.stake;
  return (
    <div className="bd-past-result">
      <span
        className={`bd-past-result-pill ${
          won ? "history-row-pill-won" : "history-row-pill-lost"
        }`}
      >
        {won ? "Won" : "Lost"}
      </span>
      <span
        className={`bd-past-result-pnl ${
          won ? "bets-profit-up" : "bets-profit-down"
        }`}
      >
        {profit >= 0 ? "+" : ""}
        {formatBetCurrency(profit, bet.currency)}
      </span>
    </div>
  );
}

// Chart geometry — chart is the hero of the settled-bet page, so we
// use a taller viewBox (900x560, ratio ~1.6:1) and generous padding
// so axis labels + round markers + threshold annotations all sit in
// clear whitespace rather than crashing into the plot area.
const W = 900;
const H = 560;
const PAD = { top: 40, right: 28, bottom: 48, left: 64 };

function ReplayChart({
  points,
  playerName,
  won,
  line,
  side,
  cutoff,
  kind,
  round,
}: {
  points: Array<{ holeIndex: number; round: number; toPar: number }>;
  playerName: string;
  won: boolean;
  line: number | null;
  side: string | null;
  cutoff: number | null;
  kind: string;
  round: number | null;
}) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  // For round-score bets we want to focus on the relevant round only.
  const focusedPoints =
    kind === "round-score" && round !== null
      ? points.filter((p) => p.round === round)
      : points;
  if (focusedPoints.length === 0) return null;

  const xs = focusedPoints.map((p) => p.holeIndex);
  const ys = focusedPoints.map((p) => p.toPar);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const yMinRaw = Math.min(0, ...ys);
  const yMaxRaw = Math.max(0, ...ys);
  const yPad = Math.max(1, (yMaxRaw - yMinRaw) * 0.15);
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const xToPx = (x: number) =>
    PAD.left + ((x - xMin) / Math.max(1, xMax - xMin)) * innerW;
  const yToPx = (y: number) =>
    PAD.top + ((yMax - y) / Math.max(1, yMax - yMin)) * innerH;
  const lineColor = won ? "var(--up, #4d8826)" : "var(--down, #c4322d)";
  const fill = won
    ? "rgba(123, 174, 63, 0.18)"
    : "rgba(248, 113, 113, 0.16)";

  const linePath = focusedPoints
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xToPx(p.holeIndex).toFixed(1)},${yToPx(p.toPar).toFixed(1)}`,
    )
    .join(" ");
  const zeroY = yToPx(0);
  const lastP = focusedPoints[focusedPoints.length - 1];
  const firstX = xToPx(focusedPoints[0].holeIndex);
  const lastX = xToPx(lastP.holeIndex);
  const areaPath = `M${firstX.toFixed(1)},${zeroY.toFixed(1)} ${focusedPoints
    .map(
      (p) =>
        `L${xToPx(p.holeIndex).toFixed(1)},${yToPx(p.toPar).toFixed(1)}`,
    )
    .join(" ")} L${lastX.toFixed(1)},${zeroY.toFixed(1)} Z`;

  // Round boundary lines at hole 18, 36, 54 (for full-tournament views).
  const roundBoundaries =
    kind === "round-score"
      ? []
      : [18, 36, 54].filter((h) => h > xMin && h < xMax);

  // Settlement threshold marker. For winning-score, the line is in
  // strokes vs par 280; convert to to-par. We don't know par here so
  // we expect `line` to already be sensible. Skip for now if absent.
  let threshold: { y: number; label: string } | null = null;
  if (line != null && kind === "winning-score") {
    // line is total strokes; assume PGA event par 280 for now.
    const toParLine = line - 280;
    if (toParLine >= yMin && toParLine <= yMax) {
      threshold = { y: toParLine, label: `${side ?? "—"} ${line}` };
    }
  }

  return (
    <svg
      className="bd-past-svg"
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${playerName} hole-by-hole replay`}
    >
      {/* Area fill */}
      <path d={areaPath} fill={fill} />
      {/* Round boundary dashed lines */}
      {roundBoundaries.map((h) => (
        <line
          key={h}
          x1={xToPx(h - 0.5)}
          x2={xToPx(h - 0.5)}
          y1={PAD.top}
          y2={H - PAD.bottom}
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="4,4"
        />
      ))}
      {/* Round labels */}
      {kind !== "round-score" &&
        [1, 2, 3, 4].map((r) => {
          const start = (r - 1) * 18;
          const end = r * 18 - 1;
          if (start > xMax || end < xMin) return null;
          const mid = (start + end) / 2;
          return (
            <text
              key={r}
              x={xToPx(mid)}
              y={PAD.top - 8}
              fontSize={15}
              fontWeight={800}
              fill="var(--muted)"
              textAnchor="middle"
            >
              R{r}
            </text>
          );
        })}
      {/* Zero baseline */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="3,3"
      />
      <text
        x={PAD.left - 8}
        y={zeroY + 4}
        fontSize={14}
        fontWeight={700}
        fill="var(--muted)"
        textAnchor="end"
      >
        E
      </text>
      <text
        x={PAD.left - 8}
        y={yToPx(yMax) + 4}
        fontSize={14}
        fontWeight={700}
        fill="var(--muted)"
        textAnchor="end"
      >
        {yMax >= 0 ? "+" : ""}
        {Math.round(yMax)}
      </text>
      {yMin < 0 && (
        <text
          x={PAD.left - 8}
          y={yToPx(yMin) + 4}
          fontSize={11}
          fontWeight={700}
          fill="var(--muted)"
          textAnchor="end"
        >
          {Math.round(yMin)}
        </text>
      )}
      {/* Settlement threshold (winning-score line) */}
      {threshold && (
        <>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yToPx(threshold.y)}
            y2={yToPx(threshold.y)}
            stroke="var(--text)"
            strokeWidth={1}
            strokeDasharray="6,4"
            opacity={0.5}
          />
          <text
            x={W - PAD.right}
            y={yToPx(threshold.y) - 6}
            fontSize={15}
            fontWeight={800}
            fill="var(--muted)"
            textAnchor="end"
          >
            {threshold.label}
          </text>
        </>
      )}
      {/* Line */}
      <path
        d={linePath}
        stroke={lineColor}
        strokeWidth={3.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Endpoint marker */}
      <circle
        cx={lastX}
        cy={yToPx(lastP.toPar)}
        r={7}
        fill={lineColor}
      />
      {/* X-axis label */}
      <text
        x={W / 2}
        y={H - 14}
        fontSize={14}
        fontWeight={600}
        fill="var(--muted)"
        textAnchor="middle"
      >
        {kind === "round-score"
          ? `R${round ?? "?"} · hole-by-hole running to-par`
          : "Tournament · running to-par"}
      </text>
      {/* Cutoff annotation for top-finish */}
      {kind === "top-finish" && cutoff && (
        <text
          x={W - PAD.right}
          y={PAD.top + 18}
          fontSize={14}
          fontWeight={800}
          fill="var(--muted)"
          textAnchor="end"
        >
          Bet: Top {cutoff}
        </text>
      )}
    </svg>
  );
}
