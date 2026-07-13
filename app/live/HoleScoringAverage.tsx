"use client";

/**
 * Hole-by-hole scoring average bar chart — how each hole is playing
 * relative to par, live-computed from the IMG-sourced score events
 * flowing through the feed.
 *
 * Data source:
 *   - Every `type:"score"` event in the current feed window carries
 *     `hole`, `par`, `strokes`, `round`.
 *   - Sum strokes vs par per (round, hole); render the mean.
 *
 * Updates on every /api/feed poll (~3s) because the parent component
 * re-renders with fresh `rows` and we recompute from scratch. No
 * memoisation heroics needed for 18 buckets.
 *
 * Design mirrors DataGolf's live-stats hole chart:
 *   - Bars centred on a zero baseline
 *   - Green below-par (easier) / red above-par (harder)
 *   - Value + par + yardage under each bar
 *   - Round selector at the top
 */

import { useMemo, useState } from "react";
import type { FeedRow } from "@/lib/feed/types";

interface Props {
  rows: FeedRow[];
  /** Optional total-yards + par-map cache so we can render "par 4 · 424 yds"
   *  under each hole. When absent we skip the extra sub-line. */
  pars?: Record<number, Record<number, number>>; // round → hole → par
  yards?: Record<number, Record<number, number>>; // round → hole → yards
}

interface HoleAgg {
  hole: number;
  par: number;
  sumStrokes: number;
  count: number;
  /** Result-type histogram — birdie / bogey / eagle etc.
   *  Pars aren't emitted as score events by orchestrator, so we
   *  derive their count from `sumStrokes` vs par + the non-par
   *  bucket totals downstream. IMG-sourced score events also fire
   *  on non-par outcomes only. */
  dist: {
    albatross: number;
    eagle: number;
    birdie: number;
    par: number;
    bogey: number;
    double: number;
    triplePlus: number;
    ace: number;
  };
  lowest: number;
  highest: number;
}

function emptyDist() {
  return {
    albatross: 0,
    eagle: 0,
    birdie: 0,
    par: 0,
    bogey: 0,
    double: 0,
    triplePlus: 0,
    ace: 0,
  };
}

function aggregateByHole(
  rows: FeedRow[],
  round: number | "all",
): Map<number, HoleAgg> {
  const map = new Map<number, HoleAgg>();
  for (const r of rows) {
    const ev = r.event;
    if (ev.type !== "score") continue;
    if (typeof ev.hole !== "number") continue;
    if (typeof ev.strokes !== "number") continue;
    if (typeof ev.par !== "number") continue;
    if (round !== "all" && ev.round !== round) continue;
    let cur = map.get(ev.hole);
    if (!cur) {
      cur = {
        hole: ev.hole,
        par: ev.par,
        sumStrokes: 0,
        count: 0,
        dist: emptyDist(),
        lowest: Infinity,
        highest: -Infinity,
      };
      map.set(ev.hole, cur);
    }
    cur.sumStrokes += ev.strokes;
    cur.count += 1;
    if (ev.strokes < cur.lowest) cur.lowest = ev.strokes;
    if (ev.strokes > cur.highest) cur.highest = ev.strokes;
    if (ev.ace) cur.dist.ace += 1;
    switch (ev.result) {
      case "albatross":
        cur.dist.albatross += 1;
        break;
      case "eagle":
        cur.dist.eagle += 1;
        break;
      case "birdie":
        cur.dist.birdie += 1;
        break;
      case "par":
        cur.dist.par += 1;
        break;
      case "bogey":
        cur.dist.bogey += 1;
        break;
      case "double":
        cur.dist.double += 1;
        break;
      case "triple-plus":
        cur.dist.triplePlus += 1;
        break;
      default: {
        // If result is missing (e.g. legacy IMG event without a
        // result stamp), infer from strokes vs par so the histogram
        // stays consistent.
        const diff = ev.strokes - ev.par;
        if (diff <= -3) cur.dist.albatross += 1;
        else if (diff === -2) cur.dist.eagle += 1;
        else if (diff === -1) cur.dist.birdie += 1;
        else if (diff === 0) cur.dist.par += 1;
        else if (diff === 1) cur.dist.bogey += 1;
        else if (diff === 2) cur.dist.double += 1;
        else cur.dist.triplePlus += 1;
      }
    }
  }
  return map;
}

export default function HoleScoringAverage({ rows, pars, yards }: Props) {
  // Rounds present in the current data.
  const roundsPresent = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) {
      if (r.event.type === "score" && typeof r.event.round === "number") {
        s.add(r.event.round);
      }
    }
    return [...s].sort((a, b) => a - b);
  }, [rows]);

  const [round, setRound] = useState<number | "all" | null>(null);
  const [hoveredHole, setHoveredHole] = useState<number | null>(null);
  const effectiveRound: number | "all" =
    round ?? roundsPresent[roundsPresent.length - 1] ?? "all";

  const agg = useMemo(
    () => aggregateByHole(rows, effectiveRound),
    [rows, effectiveRound],
  );

  // 18 slots, always. Missing holes render as zero-height bars.
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  const values = holes.map((h) => {
    const a = agg.get(h);
    if (!a || a.count === 0) {
      return {
        hole: h,
        avgVsPar: 0,
        par: null as number | null,
        count: 0,
        agg: null as HoleAgg | null,
      };
    }
    return {
      hole: h,
      avgVsPar: a.sumStrokes / a.count - a.par,
      par: a.par,
      count: a.count,
      agg: a,
    };
  });

  const maxAbs = Math.max(
    0.3,
    ...values.map((v) => Math.abs(v.avgVsPar)),
  );

  // Front + back nine + total aggregates.
  const totals = useMemo(() => {
    let sumF = 0;
    let cntF = 0;
    let sumB = 0;
    let cntB = 0;
    for (const v of values) {
      if (v.count === 0) continue;
      if (v.hole <= 9) {
        sumF += v.avgVsPar * v.count;
        cntF += v.count;
      } else {
        sumB += v.avgVsPar * v.count;
        cntB += v.count;
      }
    }
    const avgF = cntF > 0 ? sumF / cntF : 0;
    const avgB = cntB > 0 ? sumB / cntB : 0;
    const avgT =
      cntF + cntB > 0 ? (sumF + sumB) / (cntF + cntB) : 0;
    return { avgF, avgB, avgT, hasF: cntF > 0, hasB: cntB > 0 };
  }, [values]);

  const showRoundTabs = roundsPresent.length > 1;

  return (
    <section className="hsa" aria-label="Hole-by-hole scoring average">
      <header className="hsa-head">
        <div className="hsa-title">Hole-by-hole scoring avg</div>
        {showRoundTabs && (
          <div className="hsa-round-tabs" role="tablist">
            {roundsPresent.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={effectiveRound === r}
                className={`hsa-round-tab ${effectiveRound === r ? "hsa-round-tab-on" : ""}`}
                onClick={() => setRound(r)}
              >
                R{r}
              </button>
            ))}
          </div>
        )}
        <div className="hsa-tot-block">
          <span className="hsa-tot-item">
            <span className="hsa-tot-lbl">FRONT</span>
            <span
              className={`hsa-tot-val mono ${totals.avgF >= 0 ? "hsa-hard" : "hsa-easy"}`}
            >
              {totals.hasF ? formatToPar(totals.avgF) : "—"}
            </span>
          </span>
          <span className="hsa-tot-item">
            <span className="hsa-tot-lbl">BACK</span>
            <span
              className={`hsa-tot-val mono ${totals.avgB >= 0 ? "hsa-hard" : "hsa-easy"}`}
            >
              {totals.hasB ? formatToPar(totals.avgB) : "—"}
            </span>
          </span>
          <span className="hsa-tot-item">
            <span className="hsa-tot-lbl">TOTAL</span>
            <span
              className={`hsa-tot-val hsa-tot-total mono ${totals.avgT >= 0 ? "hsa-hard" : "hsa-easy"}`}
            >
              {totals.hasF || totals.hasB ? formatToPar(totals.avgT) : "—"}
            </span>
          </span>
        </div>
      </header>
      <div
        className="hsa-chart"
        role="img"
        aria-label={`Scoring average per hole for round ${effectiveRound}`}
      >
        {holes.map((h, i) => {
          const v = values[i];
          const heightPct =
            v.count === 0 ? 0 : (Math.abs(v.avgVsPar) / maxAbs) * 100;
          const isHard = v.avgVsPar >= 0;
          const par =
            v.par ?? (typeof effectiveRound === "number" ? pars?.[effectiveRound]?.[h] ?? null : null);
          const yds =
            typeof effectiveRound === "number"
              ? yards?.[effectiveRound]?.[h] ?? null
              : null;
          const isHovered = hoveredHole === h;
          return (
            <div
              className={`hsa-col ${isHovered ? "hsa-col-hover" : ""}`}
              key={h}
              onMouseEnter={() => setHoveredHole(h)}
              onMouseLeave={() =>
                setHoveredHole((cur) => (cur === h ? null : cur))
              }
              onFocus={() => setHoveredHole(h)}
              onBlur={() =>
                setHoveredHole((cur) => (cur === h ? null : cur))
              }
              tabIndex={0}
            >
              {/* Bar cell — top half for negative (easier), bottom for positive (harder). */}
              <div className="hsa-bar-cell">
                <div className="hsa-baseline" aria-hidden="true" />
                {v.count > 0 && (
                  <>
                    <div
                      className={`hsa-bar ${isHard ? "hsa-bar-hard" : "hsa-bar-easy"}`}
                      style={{
                        [isHard ? "top" : "bottom"]: "50%",
                        height: `${heightPct / 2}%`,
                      }}
                    />
                    <div
                      className={`hsa-bar-lbl ${isHard ? "hsa-bar-lbl-hard" : "hsa-bar-lbl-easy"}`}
                      style={{
                        [isHard ? "top" : "bottom"]:
                          `calc(50% ${isHard ? "+" : "+"} ${heightPct / 2 + 2}%)`,
                      }}
                    >
                      {formatToPar(v.avgVsPar)}
                    </div>
                  </>
                )}
                {isHovered && v.agg && v.count > 0 && (
                  <HoleTooltip
                    hole={h}
                    par={v.par ?? v.agg.par}
                    yds={yds}
                    avgVsPar={v.avgVsPar}
                    count={v.count}
                    agg={v.agg}
                    isRightHalf={h > 9}
                  />
                )}
              </div>
              <div className="hsa-hole-lbl">
                <span className="hsa-hole-num">{ordinalHole(h)}</span>
                {par != null && (
                  <span className="hsa-hole-meta">par {par}</span>
                )}
                {yds != null && (
                  <span className="hsa-hole-meta">{yds} yds</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface HoleTooltipProps {
  hole: number;
  par: number | null;
  yds: number | null;
  avgVsPar: number;
  count: number;
  agg: HoleAgg;
  isRightHalf: boolean;
}

function HoleTooltip({
  hole,
  par,
  yds,
  avgVsPar,
  count,
  agg,
  isRightHalf,
}: HoleTooltipProps) {
  // Buckets rendered in TV-broadcast order. Aggregate the very-rare
  // events (albatross / ace) into the eagle row so the tooltip stays
  // compact. `triplePlus` catches the doubles+ tail.
  const eaglesPlus = agg.dist.albatross + agg.dist.eagle + agg.dist.ace;
  const rows: Array<{ label: string; count: number; tone: string }> = [
    { label: "Eagle+", count: eaglesPlus, tone: "eagle" },
    { label: "Birdie", count: agg.dist.birdie, tone: "birdie" },
    { label: "Par", count: agg.dist.par, tone: "par" },
    { label: "Bogey", count: agg.dist.bogey, tone: "bogey" },
    { label: "Double+", count: agg.dist.double + agg.dist.triplePlus, tone: "blowup" },
  ];
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className={`hsa-tip ${isRightHalf ? "hsa-tip-left" : "hsa-tip-right"}`} role="tooltip">
      <div className="hsa-tip-head">
        <span className="hsa-tip-hole">{ordinalHole(hole)}</span>
        {par != null && <span className="hsa-tip-meta">par {par}</span>}
        {yds != null && <span className="hsa-tip-meta">{yds} yds</span>}
      </div>
      <div className="hsa-tip-stats">
        <div className="hsa-tip-stat">
          <span className="hsa-tip-lbl">Scoring avg</span>
          <span
            className={`hsa-tip-val mono ${avgVsPar >= 0 ? "hsa-hard" : "hsa-easy"}`}
          >
            {formatToPar(avgVsPar)}
          </span>
        </div>
        <div className="hsa-tip-stat">
          <span className="hsa-tip-lbl">Players</span>
          <span className="hsa-tip-val mono">{count}</span>
        </div>
      </div>
      <div className="hsa-tip-dist">
        {rows.map((r) => (
          <div className="hsa-tip-row" key={r.label}>
            <span className={`hsa-tip-row-lbl hsa-tip-tone-${r.tone}`}>{r.label}</span>
            <div className="hsa-tip-row-bar-wrap">
              <div
                className={`hsa-tip-row-bar hsa-tip-tone-bg-${r.tone}`}
                style={{ width: `${(r.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="hsa-tip-row-count mono">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatToPar(v: number): string {
  if (v === 0) return "0.00";
  const s = Math.abs(v).toFixed(2);
  return v > 0 ? `+${s}` : `−${s}`;
}

function ordinalHole(h: number): string {
  const rem10 = h % 10;
  const rem100 = h % 100;
  if (rem10 === 1 && rem100 !== 11) return `${h}st`;
  if (rem10 === 2 && rem100 !== 12) return `${h}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${h}rd`;
  return `${h}th`;
}
