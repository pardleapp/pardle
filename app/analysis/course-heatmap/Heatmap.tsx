"use client";

import { useMemo, useState } from "react";
import WeatherStrip, {
  type DailyWeatherView,
} from "../_components/WeatherStrip";

export interface Cell {
  round: number;
  hole: number;
  timeBucket: number; // minutes since midnight (bucket START)
  avgVsPar: number;
  count: number;
}

type RoundFilter = "1" | "2" | "3" | "4";

interface Props {
  cells: Cell[];
  bucketMinutes: number;
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
  /** Optional. When set, hole row labels ("H15") become buttons that
   *  fire this callback with the hole number — the parent opens a
   *  pin-sheet modal for that hole. */
  onHoleClick?: (hole: number) => void;
  /** True when the pin sheet has loaded, so the label styling can hint
   *  clickability. When false, labels are plain text. */
  pinsAvailable?: boolean;
}

/** Diverging colour scale — cool green for easier, neutral gray at
 *  par, warm red for harder. Two hues + gray midpoint per the
 *  dataviz method. Values are clamped to [-1, +1] strokes vs par
 *  because holes rarely play beyond that range in aggregate. */
function colourFor(vsPar: number): string {
  const cap = 1.0;
  const v = Math.max(-cap, Math.min(cap, vsPar));
  // t in [0..1] where 0=green, 0.5=gray, 1=red
  const t = (v + cap) / (2 * cap);
  if (Math.abs(v) < 0.05) {
    return "oklch(0.94 0.008 150)"; // near-par neutral
  }
  if (t < 0.5) {
    // easier — green ramp, deeper as it gets more negative
    const strength = (0.5 - t) * 2; // 0..1
    return `oklch(${0.92 - strength * 0.35} ${0.02 + strength * 0.12} 150)`;
  }
  // harder — red ramp
  const strength = (t - 0.5) * 2;
  return `oklch(${0.92 - strength * 0.35} ${0.02 + strength * 0.14} 28)`;
}

/** Text-contrast pick — darker fills need white text. */
function textOn(vsPar: number): string {
  return Math.abs(vsPar) > 0.5 ? "white" : "oklch(0.3 0.02 150)";
}

function formatClock(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatSigned(v: number): string {
  if (Math.abs(v) < 0.05) return "0";
  return v > 0 ? `+${v.toFixed(2)}` : `−${Math.abs(v).toFixed(2)}`;
}

export default function Heatmap({
  cells,
  bucketMinutes,
  weatherByRound,
  onHoleClick,
  pinsAvailable,
}: Props) {
  const [round, setRound] = useState<RoundFilter>("1");
  const [hover, setHover] = useState<Cell | null>(null);

  const availableRounds = useMemo(() => {
    const s = new Set<number>();
    for (const c of cells) s.add(c.round);
    return [...s].sort((a, b) => a - b);
  }, [cells]);

  // Auto-pick the highest available round if the current one has no data.
  const effectiveRound = useMemo(() => {
    const num = Number(round);
    if (availableRounds.includes(num)) return num;
    return availableRounds[availableRounds.length - 1] ?? 1;
  }, [round, availableRounds]);

  const cellsThisRound = useMemo(
    () => cells.filter((c) => c.round === effectiveRound),
    [cells, effectiveRound],
  );

  // Time-axis extent for this round.
  const { minBucket, maxBucket, buckets } = useMemo(() => {
    if (cellsThisRound.length === 0) {
      return { minBucket: 0, maxBucket: 60, buckets: [] as number[] };
    }
    const min = Math.min(...cellsThisRound.map((c) => c.timeBucket));
    const max = Math.max(...cellsThisRound.map((c) => c.timeBucket));
    const list: number[] = [];
    for (let t = min; t <= max; t += bucketMinutes) list.push(t);
    return { minBucket: min, maxBucket: max, buckets: list };
  }, [cellsThisRound, bucketMinutes]);

  // Cell lookup by (hole, timeBucket).
  const cellIndex = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cellsThisRound) {
      m.set(`${c.hole}:${c.timeBucket}`, c);
    }
    return m;
  }, [cellsThisRound]);

  /** Per-column summary: sum of vs-par across all 18 holes, and the
   *  count of holes that actually have data. Enables the "18 HOLES"
   *  footer row which only shows a total when the column is complete
   *  — a full-course readout of "how the course played this hour". */
  const columnTotals = useMemo(() => {
    const out = new Map<
      number,
      { sumVsPar: number; holesPlayed: number }
    >();
    for (const t of buckets) {
      let sum = 0;
      let n = 0;
      for (let h = 1; h <= 18; h++) {
        const cell = cellIndex.get(`${h}:${t}`);
        if (cell) {
          sum += cell.avgVsPar;
          n++;
        }
      }
      out.set(t, { sumVsPar: sum, holesPlayed: n });
    }
    return out;
  }, [buckets, cellIndex]);

  /** Per-row summary: mean of vs-par across all time buckets for that
   *  hole in the current round. Answers "how did hole 15 play today?"
   *  in a single number, same units as the cell values. */
  const rowMeans = useMemo(() => {
    const out = new Map<number, { avgVsPar: number; count: number }>();
    for (let h = 1; h <= 18; h++) {
      let sum = 0;
      let n = 0;
      for (const t of buckets) {
        const cell = cellIndex.get(`${h}:${t}`);
        if (cell) {
          sum += cell.avgVsPar * cell.count;
          n += cell.count;
        }
      }
      if (n > 0) out.set(h, { avgVsPar: sum / n, count: n });
    }
    return out;
  }, [buckets, cellIndex]);

  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  // Now that the analysis shell is full-width (right rail hidden),
  // the middle track is ~1200-1400 px on desktop. Widen cells so the
  // heatmap spreads to fill it instead of hugging the left edge:
  // 60px label + ~12 * 68 + 90 round col ≈ 966 px, with the container
  // stretching wider yet at bigger viewports. Mobile still gets the
  // always-visible horizontal scrollbar for narrower screens.
  const CELL_W = 68;
  const CELL_H = 36;

  return (
    <div style={{ marginTop: 12 }}>
      {/* Round filter */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {availableRounds.map((r) => {
          const active = effectiveRound === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRound(String(r) as RoundFilter)}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 6,
                border: "1px solid oklch(0.85 0.013 95)",
                background: active ? "oklch(0.25 0.02 150)" : "white",
                color: active ? "white" : "oklch(0.3 0.02 150)",
                cursor: "pointer",
              }}
            >
              R{r}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
          fontSize: 11,
          color: "oklch(0.5 0.02 150)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 100,
              height: 12,
              background:
                "linear-gradient(90deg, oklch(0.57 0.14 150) 0%, oklch(0.94 0.008 150) 50%, oklch(0.57 0.16 28) 100%)",
              borderRadius: 3,
              display: "inline-block",
            }}
          />
        </span>
        <span>
          <span style={{ color: "oklch(0.42 0.14 150)", fontWeight: 700 }}>
            −1.0
          </span>{" "}
          easier — <strong>par</strong> —{" "}
          <span style={{ color: "oklch(0.42 0.16 28)", fontWeight: 700 }}>
            +1.0
          </span>{" "}
          harder (strokes vs par)
        </span>
      </div>

      {/* Force a chunky, always-visible horizontal scrollbar on the
          heatmap. Some browsers (Safari on macOS, iOS) auto-hide
          overlay scrollbars, which was making users think the chart
          was cut off. The `.heatmap-scrollport` selector below wins
          against that default. */}
      <style>{`
        .heatmap-scrollport {
          overflow-x: scroll;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
          scrollbar-color: oklch(0.55 0.02 150) oklch(0.94 0.008 95);
          scrollbar-width: thin;
        }
        .heatmap-scrollport::-webkit-scrollbar {
          height: 14px;
          background: oklch(0.94 0.008 95);
        }
        .heatmap-scrollport::-webkit-scrollbar-thumb {
          background: oklch(0.55 0.02 150);
          border-radius: 7px;
          border: 3px solid oklch(0.94 0.008 95);
        }
        .heatmap-scrollport::-webkit-scrollbar-thumb:hover {
          background: oklch(0.4 0.02 150);
        }
      `}</style>
      <div
        style={{
          position: "relative",
          border: "1px solid oklch(0.9 0.008 95)",
          borderRadius: 8,
          background: "white",
          maxWidth: "100%",
        }}
      >
        <div
          className="heatmap-scrollport"
          style={{
            padding: 12,
            borderRadius: 8,
          }}
        >
          <table
            style={{
              borderCollapse: "collapse",
              tableLayout: "fixed",
              // width:max-content forces the table to its natural width,
              // guaranteeing horizontal overflow → the scrollbar appears
              // whenever the content is wider than the viewport.
              width: "max-content",
            }}
          >
            <thead>
            <tr>
              <th style={{ width: 60 }} />
              {buckets.map((t, i) => {
                // Show the label only every N cells to prevent overlap
                // when cells are narrow.
                const labelEvery = CELL_W < 20 ? 4 : CELL_W < 26 ? 2 : 1;
                const showLabel = i % labelEvery === 0;
                return (
                  <th
                    key={t}
                    style={{
                      width: CELL_W,
                      fontSize: 12,
                      color: "oklch(0.5 0.02 150)",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      paddingBottom: 6,
                      verticalAlign: "bottom",
                      textAlign: "left",
                    }}
                  >
                    {showLabel ? formatClock(t) : ""}
                  </th>
                );
              })}
              {/* Rightmost column: per-hole average for this round. */}
              <th
                style={{
                  width: CELL_W + 20,
                  fontSize: 12,
                  color: "oklch(0.35 0.02 150)",
                  fontWeight: 800,
                  fontFamily: "var(--font-mono, monospace)",
                  paddingBottom: 6,
                  paddingLeft: 14,
                  verticalAlign: "bottom",
                  textAlign: "center",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  borderLeft: "2px solid oklch(0.88 0.012 95)",
                }}
                title="Average strokes vs par across the round for this hole"
              >
                ROUND
              </th>
            </tr>
          </thead>
          <tbody>
            {holes.map((h) => (
              <tr key={h}>
                <td
                  style={{
                    width: 72,
                    fontSize: 13,
                    fontWeight: 700,
                    color: "oklch(0.3 0.02 150)",
                    fontFamily: "var(--font-mono, monospace)",
                    paddingRight: 10,
                    textAlign: "right",
                    verticalAlign: "middle",
                  }}
                >
                  {onHoleClick && pinsAvailable ? (
                    <button
                      type="button"
                      onClick={() => onHoleClick(h)}
                      title={`See pin positions for hole ${h}`}
                      style={{
                        background: "oklch(0.96 0.006 95)",
                        border: "1px solid oklch(0.9 0.008 95)",
                        padding: "3px 6px",
                        color: "oklch(0.2 0.02 150)",
                        font: "inherit",
                        fontWeight: 800,
                        cursor: "pointer",
                        borderRadius: 4,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        lineHeight: 1,
                        letterSpacing: 0.2,
                        transition:
                          "background-color 0.12s ease, border-color 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "oklch(0.94 0.02 150)";
                        e.currentTarget.style.borderColor = "oklch(0.55 0.15 250)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "oklch(0.96 0.006 95)";
                        e.currentTarget.style.borderColor = "oklch(0.9 0.008 95)";
                      }}
                    >
                      <span style={{ fontSize: 10 }}>📍</span>
                      H{h}
                    </button>
                  ) : (
                    <>H{h}</>
                  )}
                </td>
                {buckets.map((t) => {
                  const cell = cellIndex.get(`${h}:${t}`);
                  const isHover =
                    hover &&
                    hover.hole === h &&
                    hover.timeBucket === t &&
                    hover.round === effectiveRound;
                  return (
                    <td
                      key={t}
                      onPointerEnter={() => cell && setHover(cell)}
                      onPointerLeave={() =>
                        isHover ? setHover(null) : undefined
                      }
                      style={{
                        width: CELL_W,
                        height: CELL_H,
                        background: cell ? colourFor(cell.avgVsPar) : "transparent",
                        border: isHover
                          ? "2px solid oklch(0.25 0.02 150)"
                          : cell
                            ? "1px solid oklch(0.94 0.008 95)"
                            : "1px dashed oklch(0.94 0.008 95)",
                        fontSize: 13,
                        color: cell ? textOn(cell.avgVsPar) : "transparent",
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 700,
                        textAlign: "center",
                        cursor: cell ? "pointer" : "default",
                        padding: 0,
                        boxSizing: "border-box",
                      }}
                      title={
                        cell
                          ? `H${h} · ${formatClock(t)} · ${formatSigned(cell.avgVsPar)} vs par (${cell.count} players)`
                          : ""
                      }
                    >
                      {cell && CELL_W >= 22 ? formatSigned(cell.avgVsPar).replace("+", "") : ""}
                    </td>
                  );
                })}
                {/* Rightmost cell: this hole's average across the
                    whole round. Same colour scale as individual cells
                    so it reads as a summary of the row. */}
                {(() => {
                  const mean = rowMeans.get(h);
                  const has = mean != null;
                  return (
                    <td
                      key="row-mean"
                      title={
                        has
                          ? `H${h} · round average ${formatSigned(mean.avgVsPar)} vs par (${mean.count} players)`
                          : `H${h} · not enough data yet`
                      }
                      style={{
                        width: CELL_W + 20,
                        height: CELL_H,
                        paddingLeft: 14,
                        borderLeft: "2px solid oklch(0.88 0.012 95)",
                        boxSizing: "border-box",
                      }}
                    >
                      <div
                        style={{
                          background: has ? colourFor(mean.avgVsPar) : "transparent",
                          color: has ? textOn(mean.avgVsPar) : "oklch(0.65 0.008 95)",
                          fontFamily: "var(--font-mono, monospace)",
                          fontWeight: 800,
                          fontSize: 13,
                          border: has
                            ? "1px solid oklch(0.88 0.012 95)"
                            : "1px dashed oklch(0.92 0.008 95)",
                          borderRadius: 3,
                          padding: "4px 2px",
                          minHeight: CELL_H,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {has ? formatSigned(mean.avgVsPar) : "—"}
                      </div>
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                style={{
                  width: 60,
                  fontSize: 11,
                  fontWeight: 800,
                  color: "oklch(0.35 0.02 150)",
                  fontFamily: "var(--font-mono, monospace)",
                  paddingRight: 10,
                  paddingTop: 10,
                  textAlign: "right",
                  verticalAlign: "middle",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  borderTop: "2px solid oklch(0.88 0.012 95)",
                }}
                title="Sum of vs-par across all 18 holes for that hour. Only shows when every hole has data for that column."
              >
                18
                <br />
                HOLES
              </td>
              {buckets.map((t) => {
                const total = columnTotals.get(t);
                const complete = total?.holesPlayed === 18;
                const sum = total?.sumVsPar ?? 0;
                // Wider colour range than per-hole cells because sum
                // stacks 18 numbers — ±3 total is meaningful.
                const capped = Math.max(-3, Math.min(3, sum));
                let bg = "transparent";
                let fg = "oklch(0.55 0.02 150)";
                if (complete) {
                  const t = (capped + 3) / 6; // 0..1
                  if (Math.abs(sum) < 0.15) {
                    bg = "oklch(0.94 0.008 150)";
                    fg = "oklch(0.3 0.02 150)";
                  } else if (t < 0.5) {
                    const strength = (0.5 - t) * 2;
                    bg = `oklch(${0.9 - strength * 0.35} ${0.03 + strength * 0.14} 150)`;
                    fg = strength > 0.55 ? "white" : "oklch(0.25 0.15 150)";
                  } else {
                    const strength = (t - 0.5) * 2;
                    bg = `oklch(${0.9 - strength * 0.35} ${0.03 + strength * 0.16} 28)`;
                    fg = strength > 0.55 ? "white" : "oklch(0.32 0.16 28)";
                  }
                }
                const label = complete
                  ? sum > 0.05
                    ? `+${sum.toFixed(1)}`
                    : sum < -0.05
                      ? `−${Math.abs(sum).toFixed(1)}`
                      : "0"
                  : "";
                return (
                  <td
                    key={`total-${t}`}
                    title={
                      complete
                        ? `${formatClock(t)} · ${label} strokes vs par across all 18 holes`
                        : `${formatClock(t)} · ${total?.holesPlayed ?? 0} of 18 holes with data — not enough for a full-course total`
                    }
                    style={{
                      width: CELL_W,
                      height: CELL_H + 2,
                      paddingTop: 8,
                      textAlign: "center",
                      verticalAlign: "middle",
                      borderTop: "2px solid oklch(0.88 0.012 95)",
                    }}
                  >
                    <div
                      style={{
                        background: bg,
                        color: fg,
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 800,
                        fontSize: 11,
                        border: complete
                          ? "1px solid oklch(0.88 0.012 95)"
                          : "1px dashed oklch(0.92 0.008 95)",
                        borderRadius: 3,
                        padding: "4px 2px",
                        minHeight: CELL_H,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: complete ? 1 : 0.35,
                      }}
                    >
                      {complete ? label : `${total?.holesPlayed ?? 0}/18`}
                    </div>
                  </td>
                );
              })}
              {/* Bottom-right corner: the round's SCORE-TO-PAR total —
                  per-hole mean × 18. Reads as "the field averaged −2.4
                  today," matching how bettors read scores (not the
                  per-hole −0.13 fraction). Same colour scale still
                  applies; large absolute totals just paint at the
                  extreme end of the ramp. */}
              {(() => {
                let sum = 0;
                let n = 0;
                for (const m of rowMeans.values()) {
                  sum += m.avgVsPar * m.count;
                  n += m.count;
                }
                const perHoleMean = n > 0 ? sum / n : null;
                const roundTotal = perHoleMean != null ? perHoleMean * 18 : null;
                return (
                  <td
                    key="round-mean"
                    title={
                      roundTotal != null
                        ? `Field average round score today: ${formatSigned(roundTotal)} vs par (per-hole ${formatSigned(perHoleMean!)}, ${n} scored holes)`
                        : "Round-wide average — no data yet"
                    }
                    style={{
                      width: CELL_W + 12,
                      paddingLeft: 10,
                      paddingTop: 8,
                      borderTop: "2px solid oklch(0.88 0.012 95)",
                      borderLeft: "2px solid oklch(0.88 0.012 95)",
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      style={{
                        background:
                          perHoleMean != null ? colourFor(perHoleMean) : "transparent",
                        color:
                          perHoleMean != null
                            ? textOn(perHoleMean)
                            : "oklch(0.65 0.008 95)",
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 800,
                        fontSize: 12,
                        border:
                          perHoleMean != null
                            ? "1px solid oklch(0.88 0.012 95)"
                            : "1px dashed oklch(0.92 0.008 95)",
                        borderRadius: 3,
                        padding: "4px 2px",
                        minHeight: CELL_H,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {roundTotal != null
                        ? roundTotal > 0.05
                          ? `+${roundTotal.toFixed(1)}`
                          : roundTotal < -0.05
                            ? `−${Math.abs(roundTotal).toFixed(1)}`
                            : "E"
                        : "—"}
                    </div>
                  </td>
                );
              })()}
            </tr>
          </tfoot>
        </table>
        </div>
        {/* Right-edge fade cue — tells the user "there's more if you
            scroll". Positioned absolute so it doesn't push into the
            cell colours. Non-interactive so mouse events fall through
            to the scrollport underneath. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 24,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, transparent 0%, white 100%)",
            borderTopRightRadius: 8,
            borderBottomRightRadius: 8,
          }}
        />
      </div>

      {/* Hover readout */}
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
          <strong>
            Hole {hover.hole} · {formatClock(hover.timeBucket)}
          </strong>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>
            R{hover.round}
          </span>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>Field average</span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 700,
              color:
                hover.avgVsPar > 0.05
                  ? "oklch(0.42 0.16 28)"
                  : hover.avgVsPar < -0.05
                    ? "oklch(0.42 0.14 150)"
                    : "oklch(0.3 0.02 150)",
            }}
          >
            {formatSigned(hover.avgVsPar)} vs par
          </span>
          <span style={{ color: "oklch(0.5 0.02 150)" }}>Sample</span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 700,
            }}
          >
            {hover.count} players
          </span>
        </div>
      )}

      {weatherByRound && (
        <WeatherStrip
          day={weatherByRound[String(effectiveRound)] ?? null}
          roundLabel={`R${effectiveRound} weather`}
        />
      )}

      <p
        style={{
          fontSize: 11,
          color: "oklch(0.55 0.02 150)",
          marginTop: 10,
        }}
      >
        Cell = 15-min window on that hole. Empty cells mean nobody
        completed that hole in that window. Small samples (1–2 players)
        are noisy — a single blow-up on hole 12 in a quiet minute can
        show up as a red cell; read the trend across neighbouring cells.
        Right-hand <strong>ROUND</strong> column is that hole&apos;s
        mean vs-par across every player who scored it today. Bottom
        <strong> 18 HOLES</strong> row sums vs-par across the whole
        course for that hour — only shows when every hole has data
        (partial hours render dimmed as {"“"}n/18{"”"}). The bottom-
        right cell is the field&apos;s average round score to par
        (per-hole mean × 18), so a &quot;−2.4&quot; there means the
        field averaged 2.4 under today.
        {onHoleClick && pinsAvailable ? (
          <>
            {" "}
            Click a hole label (<code>H15</code>) to see this
            week&apos;s pin positions on the green.
          </>
        ) : null}
      </p>
    </div>
  );
}
