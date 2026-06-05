"use client";

import { useEffect, useMemo, useState } from "react";
import type { PnlSample, TrackedBet } from "../../bet-shared";
import PastBetReplay from "./PastBetReplay";
import { formatBetCurrency, type BetCurrency } from "@/lib/format/bet-currency";

interface Props {
  bet: TrackedBet;
  history: PnlSample[];
  /** Optional element rendered to the right of the chart's mode
   *  toggle (PnL £ / Win %). Used by the round-score view to put
   *  the "R1 LIVE · Thru X · −Y" pill on the same row as the
   *  toggle, saving a full stacked row of vertical space on
   *  phones. */
  headerRight?: React.ReactNode;
  /** Fires when the user touches/clicks a chart point. The bet
   *  detail page uses it to scroll the matching hole-by-hole row
   *  into view and briefly highlight it, connecting the chart to
   *  the table below. */
  onPointSelect?: (sample: PnlSample, index: number) => void;
}

type Mode = "pnl" | "prob";

const PAD = { top: 32, right: 18, bottom: 38, left: 60 };
const W = 900;
const H = 460;

export default function BetChartFull(props: Props) {
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
      <ChartInner
        {...props}
        expanded={false}
        onExpand={() => setExpanded(true)}
      />
      {expanded && (
        <div
          className="bd-chart-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded bet chart"
          onClick={() => setExpanded(false)}
        >
          <div
            className="bd-chart-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="bd-chart-modal-close"
              onClick={() => setExpanded(false)}
              aria-label="Close expanded chart"
            >
              Close
            </button>
            <ChartInner
              {...props}
              expanded={true}
              onExpand={null}
            />
          </div>
        </div>
      )}
    </>
  );
}

interface InnerProps extends Props {
  expanded: boolean;
  onExpand: (() => void) | null;
}

function ChartInner({
  bet,
  history,
  headerRight,
  onPointSelect,
  expanded,
  onExpand,
}: InnerProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("prob");

  const isRound = bet.kind === "round-score";
  const winningValue = bet.stake * bet.oddsTaken;
  const impliedEntry = 1 / bet.oddsTaken; // 0–1, what the user "bought in" at

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
    const entryY =
      mode === "prob" ? clamp01(impliedEntry) * 100 : null;

    const xMin = xs[0];
    const xMaxRaw = xs[xs.length - 1];
    const xMax = isRound
      ? Math.max(18, Math.ceil(xMaxRaw))
      : Math.max(xMaxRaw, xMin + 1);

    const allYs = entryY != null ? [...ys, entryY] : ys;
    const yMaxRaw = Math.max(baseline, ...allYs);
    const yMinRaw = Math.min(baseline, ...allYs);
    const minRange = mode === "pnl" ? Math.max(stake * 0.2, 2) : 6;
    const range = Math.max(yMaxRaw - yMinRaw, minRange);
    const headroom = range * 0.18;
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
    const entryYpx = entryY != null ? yScale(entryY) : null;
    const linePath = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");

    return {
      points,
      linePath,
      baseY,
      baseline,
      entryY,
      entryYpx,
      xMin,
      xMax,
      yMin,
      yMax,
      xScale,
      yScale,
      latestY: ys[ys.length - 1],
      ys,
    };
  }, [history, isRound, bet.stake, mode, winningValue, impliedEntry]);

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
      <div className={`bd-chart${expanded ? " bd-chart-expanded" : ""}`}>
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

  const {
    points,
    linePath,
    baseY,
    baseline,
    entryY,
    entryYpx,
    xMin,
    xMax,
    yMin,
    yMax,
    xScale,
    latestY,
    ys,
  } = data;

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

  // Default the marker to the most recent sample so the chart loads
  // with the "now" callout visible — invites the user to drag back to
  // explore. On release the marker stays on the last touched point
  // (sticky), giving the user a stable handle to discuss/share.
  const activeIdx = hoverIdx ?? points.length - 1;
  const active = points[activeIdx];

  // Highlights for the expanded deep-dive view: peak / low / biggest
  // hole-to-hole swing. Each carries an index so we can pin a label
  // to the matching point on the SVG.
  const peakIdx = ys.reduce(
    (best, v, i) => (v > ys[best] ? i : best),
    0,
  );
  const lowIdx = ys.reduce(
    (best, v, i) => (v < ys[best] ? i : best),
    0,
  );
  let swingFromIdx = 0;
  let swingToIdx = 0;
  let swingMag = 0;
  for (let i = 1; i < ys.length; i++) {
    const m = Math.abs(ys[i] - ys[i - 1]);
    if (m > swingMag) {
      swingMag = m;
      swingFromIdx = i - 1;
      swingToIdx = i;
    }
  }
  const swingDelta = ys[swingToIdx] - ys[swingFromIdx];
  const peakPoint = points[peakIdx];
  const lowPoint = points[lowIdx];

  function holeOrTimeLabel(i: number): string {
    if (isRound) {
      const h = history[i]?.holesPlayed;
      return h != null ? `H${h}` : `#${i + 1}`;
    }
    return new Date(history[i].t).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const prevSample = activeIdx > 0 ? history[activeIdx - 1] : null;
  const prevValue = prevSample?.v;
  const prevProb =
    prevSample &&
    (typeof prevSample.prob === "number"
      ? prevSample.prob
      : prevSample.v / winningValue);
  const activeProb =
    typeof active.raw.prob === "number"
      ? active.raw.prob
      : active.raw.v / winningValue;
  const activePnl = active.raw.v - bet.stake;

  const dPnl = prevValue != null ? active.raw.v - prevValue : null;
  const dProb =
    prevProb != null && Number.isFinite(prevProb) ? activeProb - prevProb : null;

  function findClosestIdx(svgX: number, svgY: number | null): number {
    // Distance is dominated by X (touching along the line), but a
    // small Y tiebreaker lets the user lift their finger near a
    // crossing point and land on the visually-nearest sample rather
    // than a horizontally-adjacent but vertically-far one.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = Math.abs(points[i].x - svgX);
      const dy = svgY != null ? Math.abs(points[i].y - svgY) * 0.25 : 0;
      const d = dx + dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function pickFromEvent(
    e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>,
    src: { clientX: number; clientY: number },
  ): number {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const svgX = ((src.clientX - rect.left) / rect.width) * W;
    const svgY = ((src.clientY - rect.top) / rect.height) * H;
    return findClosestIdx(svgX, svgY);
  }

  return (
    <div className={`bd-chart${expanded ? " bd-chart-expanded" : ""}`}>
      <div className="bd-chart-header">
        <ChartToggle mode={mode} setMode={setMode} />
        <div className="bd-chart-header-right">
          {headerRight}
          {onExpand && (
            <button
              type="button"
              className="bd-chart-expand"
              onClick={onExpand}
              aria-label="Expand chart"
              title="Expand"
            >
              <ExpandIcon />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="bd-chart-hero">
          <HeroStat
            label="Now"
            value={formatHeroValue(ys[ys.length - 1], mode, bet.currency)}
            sub={holeOrTimeLabel(ys.length - 1)}
            up={ys[ys.length - 1] >= baseline}
          />
          <HeroStat
            label="Peak"
            value={formatHeroValue(ys[peakIdx], mode, bet.currency)}
            sub={holeOrTimeLabel(peakIdx)}
            up={true}
          />
          <HeroStat
            label="Low"
            value={formatHeroValue(ys[lowIdx], mode, bet.currency)}
            sub={holeOrTimeLabel(lowIdx)}
            up={false}
          />
          <HeroStat
            label="Biggest swing"
            value={
              swingMag === 0
                ? "—"
                : `${swingDelta > 0 ? "+" : "−"}${formatSwingValue(Math.abs(swingDelta), mode, bet.currency)}`
            }
            sub={
              swingMag === 0
                ? ""
                : `${holeOrTimeLabel(swingFromIdx)} → ${holeOrTimeLabel(swingToIdx)}`
            }
            up={swingDelta >= 0}
          />
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="bd-chart-svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={mode === "pnl" ? "Profit/loss chart" : "Win probability chart"}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          setHoverIdx(pickFromEvent(e, { clientX: e.clientX, clientY: e.clientY }));
        }}
        onClick={(e) => {
          const idx = pickFromEvent(e, {
            clientX: e.clientX,
            clientY: e.clientY,
          });
          setHoverIdx(idx);
          if (onPointSelect) onPointSelect(history[idx], idx);
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          setHoverIdx(
            pickFromEvent(e, { clientX: t.clientX, clientY: t.clientY }),
          );
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (!t) return;
          // Prevent the page from scrolling vertically while scrubbing
          // — the chart's touch surface should "win" once the user has
          // committed to dragging on it.
          if (e.cancelable) e.preventDefault();
          setHoverIdx(
            pickFromEvent(e, { clientX: t.clientX, clientY: t.clientY }),
          );
        }}
        onTouchEnd={() => {
          // Sticky: keep the marker on the last touched point so the
          // tooltip stays visible. Fire onPointSelect so the parent
          // can scroll the matching hole-by-hole row into view.
          if (hoverIdx != null && onPointSelect) {
            onPointSelect(history[hoverIdx], hoverIdx);
          }
        }}
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

        {/* Entry baseline — the implied probability the user "bought
            in" at (1 / oddsTaken). Distinct from the gridline baseline
            so a user can see at a glance whether their current win %
            is above or below what they paid for. Prob mode only. */}
        {mode === "prob" && entryYpx != null && entryY != null && (
          <g className="bd-chart-entry">
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={entryYpx}
              y2={entryYpx}
              stroke="#6b6c70"
              strokeDasharray="4 5"
              strokeWidth={1}
              opacity={0.7}
            />
            <rect
              x={W - PAD.right - 86}
              y={entryYpx - 12}
              width={84}
              height={16}
              rx={3}
              fill="rgba(20,20,22,0.85)"
            />
            <text
              x={W - PAD.right - 4}
              y={entryYpx}
              textAnchor="end"
              fontSize="10.5"
              fontWeight={800}
              fill="#fafafa"
              style={{ letterSpacing: "0.04em" }}
            >
              ENTRY {formatProbCompact(entryY / 100)}
            </text>
          </g>
        )}

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
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={activeIdx === i ? 4.5 : 2.2}
            fill={lineColor}
            opacity={activeIdx === i ? 1 : 0.85}
          />
        ))}

        {/* Peak + Low pin annotations — only shown in the expanded
            deep-dive view. They mark the most viral moments of the
            bet's life so the user's eye lands on the narrative
            without scrubbing for it. */}
        {expanded && peakIdx !== lowIdx && (
          <>
            <ChartPin
              x={peakPoint.x}
              y={peakPoint.y}
              label={`PEAK ${formatPinValue(ys[peakIdx], mode, bet.currency)}`}
              sub={holeOrTimeLabel(peakIdx)}
              color="#2c7a28"
              chartW={W}
              chartH={H}
              direction="above"
            />
            <ChartPin
              x={lowPoint.x}
              y={lowPoint.y}
              label={`LOW ${formatPinValue(ys[lowIdx], mode, bet.currency)}`}
              sub={holeOrTimeLabel(lowIdx)}
              color="#b13838"
              chartW={W}
              chartH={H}
              direction="below"
            />
          </>
        )}

        {/* Active marker — finger-tracking dot + vertical guide line.
            Larger halo on the dot improves visibility under a
            fingertip; the dashed guide makes the X position legible
            against the gridlines. */}
        <g className="bd-chart-marker">
          <line
            x1={active.x}
            x2={active.x}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke={lineColor}
            strokeDasharray="2 3"
            strokeWidth={1.1}
            opacity={0.55}
          />
          <circle
            cx={active.x}
            cy={active.y}
            r={11}
            fill={lineColor}
            opacity={0.18}
          />
          <circle
            cx={active.x}
            cy={active.y}
            r={5.5}
            fill="#fff"
            stroke={lineColor}
            strokeWidth={2.4}
          />
        </g>

        <ChartCallout
          x={active.x}
          y={active.y}
          chartW={W}
          chartH={H}
          pad={PAD}
          isRound={isRound}
          activeRaw={active.raw}
          activeXVal={active.xVal}
          activeProb={activeProb}
          activePnl={activePnl}
          dPnl={dPnl}
          dProb={dProb}
          mode={mode}
          currency={bet.currency}
          lineColor={lineColor}
        />

        <text
          x={W - PAD.right}
          y={PAD.top - 14}
          textAnchor="end"
          fontSize="11"
          fill="var(--muted)"
          fontWeight={700}
        >
          {isRound ? "Holes played" : "Time"} ·{" "}
          {mode === "pnl" ? "Profit / loss" : "Implied win chance"}
        </text>
      </svg>

      <div className="bd-chart-foot">
        <span className="bd-chart-foot-hint">
          {hoverIdx != null
            ? "Drag along the chart · tap to jump to that hole"
            : "Drag along the chart to explore · tap a point to jump"}
        </span>
      </div>
    </div>
  );
}

/** SVG tooltip callout — rendered next to the active marker. The
 *  position auto-flips horizontally and vertically to stay inside
 *  the plot, so the user's fingertip never hides it. */
function ChartCallout({
  x,
  y,
  chartW,
  chartH,
  pad,
  isRound,
  activeRaw,
  activeXVal,
  activeProb,
  activePnl,
  dPnl,
  dProb,
  mode,
  currency,
  lineColor,
}: {
  x: number;
  y: number;
  chartW: number;
  chartH: number;
  pad: { top: number; right: number; bottom: number; left: number };
  isRound: boolean;
  activeRaw: PnlSample;
  activeXVal: number;
  activeProb: number;
  activePnl: number;
  dPnl: number | null;
  dProb: number | null;
  mode: Mode;
  currency: BetCurrency | undefined;
  lineColor: string;
}) {
  const titleText = isRound
    ? `Hole ${activeRaw.holesPlayed ?? activeXVal}`
    : new Date(activeRaw.t).toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

  const bigText =
    mode === "prob"
      ? `${formatProbCompact(activeProb)} win`
      : `${activePnl >= 0 ? "+" : "−"}${formatBetCurrency(
          Math.abs(activePnl),
          currency,
        )}`;

  const secondaryText =
    mode === "prob"
      ? `${activePnl >= 0 ? "+" : "−"}${formatBetCurrency(
          Math.abs(activePnl),
          currency,
        )}`
      : `${formatProbCompact(activeProb)} win`;

  const deltaParts: { text: string; up: boolean }[] = [];
  if (mode === "prob" && dProb != null && Math.abs(dProb) >= 0.001) {
    deltaParts.push({
      text: `${dProb >= 0 ? "+" : "−"}${formatProbDeltaCompact(Math.abs(dProb))}`,
      up: dProb >= 0,
    });
  } else if (mode === "pnl" && dPnl != null && Math.abs(dPnl) >= 0.005) {
    deltaParts.push({
      text: `${dPnl >= 0 ? "+" : "−"}${formatBetCurrency(
        Math.abs(dPnl),
        currency,
      )}`,
      up: dPnl >= 0,
    });
  }
  const eventText = deriveEventText(dPnl, dProb);
  if (eventText) deltaParts.push({ text: eventText, up: (dPnl ?? 0) >= 0 });

  // Box geometry — picked so the long-form callout (two stacked
  // lines + delta strip) sits comfortably without crowding the
  // marker. Width is text-driven and rounded up to a stable size so
  // the tooltip doesn't jitter as the active sample changes.
  const boxW = 184;
  const boxH = deltaParts.length > 0 ? 78 : 60;
  const marginToMarker = 14;

  // Horizontal flip: keep the box inside the plot.
  let boxX = x + marginToMarker;
  if (boxX + boxW > chartW - pad.right) boxX = x - marginToMarker - boxW;
  if (boxX < pad.left) boxX = pad.left;

  // Vertical flip: prefer above the marker, fall back to below.
  let boxY = y - boxH - 12;
  if (boxY < pad.top) boxY = y + 14;
  if (boxY + boxH > chartH - pad.bottom) boxY = chartH - pad.bottom - boxH;

  return (
    <g className="bd-chart-callout" pointerEvents="none">
      <rect
        x={boxX}
        y={boxY}
        width={boxW}
        height={boxH}
        rx={8}
        fill="rgba(20,20,22,0.96)"
        stroke={lineColor}
        strokeWidth={1.2}
      />
      <text
        x={boxX + 12}
        y={boxY + 18}
        fontSize="10.5"
        fontWeight={800}
        fill="#e6e6ea"
        style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {titleText}
      </text>
      <text
        x={boxX + 12}
        y={boxY + 40}
        fontSize="20"
        fontWeight={900}
        fill="#fff"
        style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}
      >
        {bigText}
      </text>
      <text
        x={boxX + 12}
        y={boxY + 56}
        fontSize="11.5"
        fontWeight={700}
        fill="#b9bac0"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {secondaryText}
      </text>
      {deltaParts.length > 0 && (
        <text
          x={boxX + 12}
          y={boxY + 72}
          fontSize="11"
          fontWeight={800}
          fill={deltaParts[0].up ? "#7ed273" : "#ff8b8b"}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {deltaParts.map((p) => p.text).join(" · ")}
        </text>
      )}
    </g>
  );
}

/** Single stat tile in the expanded modal's hero band — big bold
 *  number + label + tiny sublabel (the hole / timestamp where the
 *  number occurred). */
function HeroStat({
  label,
  value,
  sub,
  up,
}: {
  label: string;
  value: string;
  sub: string;
  up: boolean;
}) {
  return (
    <div className="bd-chart-hero-stat">
      <span className="bd-chart-hero-lbl">{label}</span>
      <span className={`bd-chart-hero-val ${up ? "up" : "down"}`}>{value}</span>
      {sub && <span className="bd-chart-hero-sub">{sub}</span>}
    </div>
  );
}

/** Small label pin drawn at a key point on the chart (PEAK / LOW).
 *  Auto-flips above/below the marker so the label never overlaps the
 *  line. */
function ChartPin({
  x,
  y,
  label,
  sub,
  color,
  chartW,
  chartH,
  direction,
}: {
  x: number;
  y: number;
  label: string;
  sub: string;
  color: string;
  chartW: number;
  chartH: number;
  direction: "above" | "below";
}) {
  const boxW = 92;
  const boxH = 30;
  let boxX = x - boxW / 2;
  if (boxX < 8) boxX = 8;
  if (boxX + boxW > chartW - 8) boxX = chartW - 8 - boxW;
  const boxY =
    direction === "above" ? Math.max(8, y - boxH - 10) : Math.min(chartH - boxH - 8, y + 12);

  return (
    <g pointerEvents="none" className="bd-chart-pin">
      <circle cx={x} cy={y} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
      <rect
        x={boxX}
        y={boxY}
        width={boxW}
        height={boxH}
        rx={6}
        fill={color}
        opacity={0.95}
      />
      <text
        x={boxX + boxW / 2}
        y={boxY + 12}
        textAnchor="middle"
        fontSize="9.5"
        fontWeight={900}
        fill="#fff"
        style={{ letterSpacing: "0.06em" }}
      >
        {label}
      </text>
      <text
        x={boxX + boxW / 2}
        y={boxY + 24}
        textAnchor="middle"
        fontSize="10"
        fontWeight={700}
        fill="#fff"
        style={{ opacity: 0.9, fontVariantNumeric: "tabular-nums" }}
      >
        {sub}
      </text>
    </g>
  );
}

/** Format the big hero-band stat. Prob mode shows percentage, PnL
 *  mode shows signed currency. */
function formatHeroValue(
  v: number,
  mode: Mode,
  currency: BetCurrency | undefined,
): string {
  if (!Number.isFinite(v)) return "—";
  if (mode === "prob") {
    if (v <= 0) return "0%";
    if (v >= 100) return "100%";
    if (v < 5) return `${v.toFixed(1)}%`;
    return `${Math.round(v)}%`;
  }
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${formatBetCurrency(Math.abs(v), currency, { maximumFractionDigits: 0 })}`;
}

/** Format the magnitude of a swing (used in "Biggest swing" tile).
 *  Sign is rendered separately by the caller. */
function formatSwingValue(
  absV: number,
  mode: Mode,
  currency: BetCurrency | undefined,
): string {
  if (mode === "prob") {
    if (absV < 1) return `${absV.toFixed(1)}%`;
    return `${Math.round(absV)}%`;
  }
  return formatBetCurrency(absV, currency, { maximumFractionDigits: 0 });
}

/** Compact value rendered inside a chart pin (PEAK 75% / LOW 8%). */
function formatPinValue(
  v: number,
  mode: Mode,
  currency: BetCurrency | undefined,
): string {
  if (mode === "prob") {
    if (v < 5) return `${v.toFixed(1)}%`;
    return `${Math.round(v)}%`;
  }
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${formatBetCurrency(Math.abs(v), currency, { maximumFractionDigits: 0 })}`;
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
      <path
        d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

/** Heuristic event label from the swing — we don't have hole-level
 *  scoring data on every sample, so describe the move in plain
 *  English ("big swing up", "small drop") rather than guessing
 *  birdie/par/bogey we can't verify. */
function deriveEventText(
  dPnl: number | null,
  dProb: number | null,
): string | null {
  if (dProb != null && Math.abs(dProb) >= 0.001) {
    const abs = Math.abs(dProb);
    if (abs >= 0.10) return dProb > 0 ? "big swing" : "big drop";
    if (abs >= 0.03) return dProb > 0 ? "up" : "down";
    return null;
  }
  if (dPnl != null && Math.abs(dPnl) >= 0.005) {
    return dPnl > 0 ? "up" : "down";
  }
  return null;
}

function formatProbCompact(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "0%";
  if (p >= 1) return "100%";
  const pct = p * 100;
  if (pct < 5) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function formatProbDeltaCompact(absP: number): string {
  const pct = absP * 100;
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
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
