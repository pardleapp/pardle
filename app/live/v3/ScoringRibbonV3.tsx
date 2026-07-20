"use client";

/**
 * Compact scoring ribbon for v3. Shows Front / Back / Total scoring
 * numbers inline in one row, plus a "hard/easy" pill if the field is
 * meaningfully off par.
 *
 * The full 18-hole bar chart is kept — but tucked into a collapsible
 * drawer that opens on click. Default state is collapsed so the
 * ribbon eats one line, not a quarter of the viewport.
 *
 * Uses the same data as HoleScoringAverage (its aggregates map and
 * course trend), so the numbers here always match the drawer below.
 */

import { useMemo, useState } from "react";
import type { FeedRow } from "@/lib/feed/types";
import type { HoleAggregates } from "@/lib/feed/hole-aggregates";
import type { CourseTrend } from "@/lib/feed/course-trend";
import HoleScoringAverage from "../HoleScoringAverage";

interface Props {
  rows: FeedRow[];
  aggregates?: HoleAggregates;
  trend?: CourseTrend;
}

/** Roll the per-round-per-hole aggregates up into a front / back /
 *  total mean of (strokes - par). All holes are treated equally, so
 *  a hole with more counts contributes more to the mean — that's
 *  fine, the aggregates already skip unknown-par holes upstream. */
function summarize(aggregates: HoleAggregates | undefined): {
  front: number | null;
  back: number | null;
  total: number | null;
} {
  if (!aggregates) return { front: null, back: null, total: null };
  let frontSum = 0, frontN = 0;
  let backSum = 0, backN = 0;
  for (const roundMap of Object.values(aggregates)) {
    for (const [holeStr, agg] of Object.entries(roundMap)) {
      const hole = Number(holeStr);
      const diff = agg.sumStrokes - agg.par * agg.count;
      if (hole >= 1 && hole <= 9) {
        frontSum += diff;
        frontN += agg.count;
      } else if (hole >= 10 && hole <= 18) {
        backSum += diff;
        backN += agg.count;
      }
    }
  }
  const front = frontN > 0 ? frontSum / frontN : null;
  const back = backN > 0 ? backSum / backN : null;
  const totalN = frontN + backN;
  const total = totalN > 0 ? (frontSum + backSum) / totalN : null;
  return { front, back, total };
}

function formatSigned(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) < 0.005) return "0.00";
  return v > 0 ? `+${v.toFixed(2)}` : `−${Math.abs(v).toFixed(2)}`;
}

function classForVal(v: number | null): string {
  if (v == null) return "";
  if (v > 0.05) return "feed-v3-ribbon-num-hard";
  if (v < -0.05) return "feed-v3-ribbon-num-easy";
  return "";
}

export default function ScoringRibbonV3({ rows, aggregates, trend }: Props) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarize(aggregates), [aggregates]);
  if (summary.total == null) return null;

  const trendDelta = trend?.hasSignal ? trend.delta : null;
  const shownDelta = trendDelta ?? summary.total;
  const isHard = shownDelta != null && shownDelta > 0.05;
  const isEasy = shownDelta != null && shownDelta < -0.05;
  const flagLabel =
    trendDelta != null
      ? trendDelta > 0
        ? `Course harder ${formatSigned(trendDelta)}`
        : `Course easier ${formatSigned(trendDelta)}`
      : isHard
        ? `Playing hard ${formatSigned(summary.total)}`
        : isEasy
          ? `Playing easy ${formatSigned(summary.total)}`
          : null;

  return (
    <>
      <div className="feed-v3-ribbon">
        <span className="feed-v3-ribbon-stat">
          Front
          <span
            className={`feed-v3-ribbon-num ${classForVal(summary.front)}`}
          >
            {formatSigned(summary.front)}
          </span>
        </span>
        <span className="feed-v3-ribbon-stat">
          Back
          <span
            className={`feed-v3-ribbon-num ${classForVal(summary.back)}`}
          >
            {formatSigned(summary.back)}
          </span>
        </span>
        <span className="feed-v3-ribbon-stat">
          Total
          <span
            className={`feed-v3-ribbon-num ${classForVal(summary.total)}`}
          >
            {formatSigned(summary.total)}
          </span>
        </span>
        {flagLabel && (
          <span
            className={`feed-v3-ribbon-flag ${
              isHard
                ? "feed-v3-ribbon-flag-hard"
                : "feed-v3-ribbon-flag-easy"
            }`}
          >
            {isHard ? "▲" : "▼"} {flagLabel}
          </span>
        )}
        <button
          type="button"
          className="feed-v3-ribbon-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="feed-v3-ribbon-drawer"
        >
          {open ? "Hide holes ▲" : "Show holes ▼"}
        </button>
      </div>
      {open && (
        <div
          id="feed-v3-ribbon-drawer"
          className="feed-v3-ribbon-drawer"
        >
          <HoleScoringAverage
            rows={rows}
            aggregates={aggregates}
            trend={trend}
          />
        </div>
      )}
    </>
  );
}
