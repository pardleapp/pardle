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

export default function Heatmap({ cells, bucketMinutes, weatherByRound }: Props) {
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

  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  // 1-hour buckets → ~10-12 columns per round. Sized to fit the
  // desktop shell's middle grid column (~580px cap) without touching
  // the right rail: 44px label + 11 * 40 + 24 padding ≈ 508px. Mobile
  // still gets the always-visible scrollbar on narrow viewports.
  const CELL_W = 40;
  const CELL_H = 26;

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
              <th style={{ width: 44 }} />
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
                      fontSize: 10,
                      color: "oklch(0.5 0.02 150)",
                      fontWeight: 500,
                      fontFamily: "var(--font-mono, monospace)",
                      paddingBottom: 4,
                      verticalAlign: "bottom",
                      textAlign: "left",
                    }}
                  >
                    {showLabel ? formatClock(t) : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {holes.map((h) => (
              <tr key={h}>
                <td
                  style={{
                    width: 44,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "oklch(0.3 0.02 150)",
                    fontFamily: "var(--font-mono, monospace)",
                    paddingRight: 8,
                    textAlign: "right",
                    verticalAlign: "middle",
                  }}
                >
                  H{h}
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
                        fontSize: 9,
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
              </tr>
            ))}
          </tbody>
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
      </p>
    </div>
  );
}
