"use client";

/**
 * Per-hole setup table — the primary view of the hole-scoring tool.
 *
 * The question this answers is "why did this hole play the way it did
 * today", so the three things a committee actually changes each
 * morning lead: how long they made it and which way the wind was
 * blowing across it. Scoring is the OUTCOME
 * column and sits last, because reading it first is what makes people
 * invent explanations for noise.
 *
 * Every column shares one colour language: RED MEANS PLAYS HARDER,
 * green means easier, and each is measured against the same hole on
 * the OTHER rounds of the same week rather than against some absolute.
 * That is what lets a row be read in one pass — "longer, tucked, into
 * the wind, played +0.43" lines up, and a row where the setup eased
 * but scoring rose is visibly odd rather than silently buried.
 *
 * Everything here derives from data the heatmap already received; no
 * new fetches.
 */

import type { CoursePinHole } from "@/lib/golf-api/pgatour";
import type { DailyWeatherView } from "../_components/WeatherStrip";

export interface Cell {
  round: number;
  hole: number;
  timeBucket: number;
  avgVsPar: number;
  count: number;
}

interface Props {
  cells: Cell[];
  round: number;
  pinsByHole?: Map<number, CoursePinHole>;
  holeBearings?: Record<number, number> | null;
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
  onHoleClick?: (hole: number) => void;
}

const INK = "oklch(0.24 0.02 150)";
const MUTED = "oklch(0.5 0.02 150)";
const LINE = "oklch(0.9 0.008 95)";
const SOFT = "oklch(0.97 0.005 95)";

/** Shared scale: +1 = hardest, -1 = easiest. Kept deliberately blunt —
 *  three buckets each way, because the reader needs "harder / same /
 *  easier" far more than a continuous gradient. */
function tone(norm: number | null): {
  background: string;
  color: string;
} {
  if (norm == null || !Number.isFinite(norm)) {
    return { background: "transparent", color: "oklch(0.72 0.008 95)" };
  }
  const a = Math.abs(norm);
  if (a < 0.25) return { background: SOFT, color: MUTED };
  if (norm > 0) {
    return a < 0.6
      ? { background: "oklch(0.94 0.05 25)", color: "oklch(0.42 0.14 25)" }
      : { background: "oklch(0.88 0.10 25)", color: "oklch(0.32 0.16 25)" };
  }
  return a < 0.6
    ? { background: "oklch(0.94 0.06 150)", color: "oklch(0.36 0.12 150)" }
    : { background: "oklch(0.88 0.11 150)", color: "oklch(0.28 0.13 150)" };
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}


export interface HoleRow {
  hole: number;
  par: number | null;
  yards: number | null;
  dYards: number | null;
  head: number | null;
  cross: number | null;
  windKind: "into" | "down" | "cross" | null;
  score: number | null;
  dScore: number | null;
}

/** Vector-mean wind over daylight hours. Degrees can't be averaged
 *  arithmetically across the 0/360 wrap. */
export function roundWind(
  day: DailyWeatherView | null | undefined,
): { mph: number; fromDeg: number } | null {
  const pts = (day?.hourly ?? []).filter(
    (p) => p.hour >= 7 && p.hour <= 19 && typeof p.windMph === "number",
  );
  if (pts.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  let speed = 0;
  for (const p of pts) {
    speed += p.windMph as number;
    const deg = (p as { windDirDeg?: number | null }).windDirDeg;
    if (typeof deg === "number") {
      sx += Math.sin((deg * Math.PI) / 180);
      sy += Math.cos((deg * Math.PI) / 180);
      n += 1;
    }
  }
  if (n === 0) return null;
  return {
    mph: speed / pts.length,
    fromDeg: ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360,
  };
}

export function buildRows({
  cells,
  round,
  pinsByHole,
  holeBearings,
  weatherByRound,
}: Omit<Props, "onHoleClick">): HoleRow[] {
  const rounds = [...new Set(cells.map((c) => c.round))].sort();
  const others = rounds.filter((r) => r !== round);

  // Count-weighted scoring per (hole, round) — cells are per hour, so
  // a straight mean would weight a two-group hour like a ten-group one.
  const score = new Map<string, { sum: number; n: number }>();
  for (const c of cells) {
    const k = `${c.round}:${c.hole}`;
    const e = score.get(k) ?? { sum: 0, n: 0 };
    e.sum += c.avgVsPar * c.count;
    e.n += c.count;
    score.set(k, e);
  }
  const scoreFor = (h: number, r: number) => {
    const e = score.get(`${r}:${h}`);
    return e && e.n > 0 ? e.sum / e.n : null;
  };

  const wind = roundWind(weatherByRound?.[String(round)]);
  const holes = [...new Set(cells.map((c) => c.hole))].sort((a, b) => a - b);

  return holes.map((h) => {
    const pin = pinsByHole?.get(h);
    const yards = pin?.yardsByRound?.[round] ?? null;
    const yOther = mean(
      others
        .map((r) => pin?.yardsByRound?.[r])
        .filter((v): v is number => typeof v === "number"),
    );
    const s = scoreFor(h, round);
    const sOther = mean(
      others.map((r) => scoreFor(h, r)).filter((v): v is number => v != null),
    );

    let head: number | null = null;
    let cross: number | null = null;
    let windKind: HoleRow["windKind"] = null;
    const bearing = holeBearings?.[h];
    if (wind && typeof bearing === "number") {
      const t = ((wind.fromDeg - bearing) * Math.PI) / 180;
      head = wind.mph * Math.cos(t);
      cross = Math.abs(wind.mph * Math.sin(t));
      windKind = cross > Math.abs(head) ? "cross" : head > 0 ? "into" : "down";
    }

    return {
      hole: h,
      par: pin?.par ?? null,
      yards,
      dYards: yards != null && yOther != null ? yards - yOther : null,
      head,
      cross,
      windKind,
      score: s,
      dScore: s != null && sOther != null ? s - sOther : null,
    };
  });
}

const th: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: MUTED,
  padding: "6px 8px",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const cellBox: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontWeight: 800,
  fontSize: 13,
  fontVariantNumeric: "tabular-nums",
  borderRadius: 6,
  padding: "4px 8px",
  display: "inline-block",
  minWidth: 62,
  textAlign: "center",
};

export default function HoleSetup({
  cells,
  round,
  pinsByHole,
  holeBearings,
  weatherByRound,
  onHoleClick,
}: Props) {
  const rows = buildRows({ cells, round, pinsByHole, holeBearings, weatherByRound });
  if (rows.length === 0) return null;

  // Normalisers so each column's colour is relative to that column's
  // own spread this round. A 20-yard move and a 4 mph wind swing are
  // not comparable in raw units; both should read as "a bit harder".
  const maxY = Math.max(...rows.map((r) => Math.abs(r.dYards ?? 0)), 1);
  const maxW = Math.max(...rows.map((r) => Math.abs(r.head ?? 0)), 1);
  const maxS = Math.max(...rows.map((r) => Math.abs(r.dScore ?? 0)), 0.1);

  // Totals are summed from the rendered rows rather than recomputed,
  // so the bottom line can never disagree with the column above it.
  // Only holes carrying a value contribute, and the count is surfaced
  // when it is short of the full eighteen — a course total quietly
  // missing three holes is worse than no total.
  const sum = (get: (r: HoleRow) => number | null) => {
    const vals = rows.map(get).filter((v): v is number => v != null);
    return vals.length
      ? { value: vals.reduce((a, b) => a + b, 0), n: vals.length }
      : null;
  };
  const totalPar = sum((r) => r.par);
  const totalYards = sum((r) => r.yards);
  const totalDYards = sum((r) => r.dYards);
  const totalScore = sum((r) => r.score);
  const totalDScore = sum((r) => r.dScore);
  // A sum of head/tail components is meaningless — they cancel. What
  // does mean something is how much of the course pointed which way.
  const windSplit = rows.reduce(
    (acc, r) => {
      if (r.windKind) acc[r.windKind] += 1;
      return acc;
    },
    { into: 0, down: 0, cross: 0 },
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: "0 3px",
          width: "100%",
          maxWidth: 760,
          minWidth: 620,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Hole</th>
            <th style={th}>Par</th>
            <th style={th}>Length</th>
            <th style={th}>Wind</th>
            <th style={{ ...th, color: INK }}>Played</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const yTone = tone(r.dYards != null ? r.dYards / maxY : null);
            const wTone = tone(
              r.head != null && r.windKind !== "cross" ? r.head / maxW : 0,
            );
            const sTone = tone(r.dScore != null ? r.dScore / maxS : null);
            return (
              <tr key={r.hole}>
                <td style={{ padding: "3px 8px" }}>
                  <button
                    type="button"
                    onClick={
                      onHoleClick ? () => onHoleClick(r.hole) : undefined
                    }
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: 800,
                      fontSize: 14,
                      color: INK,
                      cursor: onHoleClick ? "pointer" : "default",
                      textDecoration: onHoleClick ? "underline dotted" : "none",
                      textUnderlineOffset: 3,
                    }}
                  >
                    H{r.hole}
                  </button>
                </td>
                <td
                  style={{
                    ...th,
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 12,
                    fontWeight: 700,
                    color: MUTED,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  {r.par ?? "—"}
                </td>

                <td style={{ padding: "3px 8px", textAlign: "right" }}>
                  <span
                    style={{ ...cellBox, ...yTone, minWidth: 96 }}
                    title={
                      r.dYards != null
                        ? `H${r.hole} played ${r.yards} yd — ${r.dYards >= 0 ? "+" : ""}${Math.round(r.dYards)} yd vs its other rounds this week`
                        : "no per-round yardage"
                    }
                  >
                    {r.yards != null ? r.yards : "—"}
                    {r.dYards != null && Math.abs(r.dYards) >= 1 && (
                      <span style={{ fontSize: 11, opacity: 0.8 }}>
                        {" "}
                        {r.dYards > 0 ? "+" : ""}
                        {Math.round(r.dYards)}
                      </span>
                    )}
                  </span>
                </td>


                <td style={{ padding: "3px 8px", textAlign: "right" }}>
                  <span
                    style={{ ...cellBox, ...wTone, minWidth: 84 }}
                    title={
                      r.head != null
                        ? `${Math.abs(r.head).toFixed(1)} mph ${r.head >= 0 ? "into" : "downwind"}, ${r.cross?.toFixed(1)} mph across`
                        : "no bearing for this hole"
                    }
                  >
                    {r.windKind == null
                      ? "—"
                      : r.windKind === "cross"
                        ? `cross ${Math.round(r.cross ?? 0)}`
                        : `${r.windKind} ${Math.round(Math.abs(r.head ?? 0))}`}
                  </span>
                </td>

                <td style={{ padding: "3px 8px", textAlign: "right" }}>
                  <span
                    style={{ ...cellBox, ...sTone, minWidth: 96 }}
                    title={
                      r.score != null
                        ? `Field averaged ${r.score >= 0 ? "+" : ""}${r.score.toFixed(2)} vs par${r.dScore != null ? `, ${r.dScore >= 0 ? "+" : ""}${r.dScore.toFixed(2)} vs its other rounds` : ""}`
                        : "no scoring yet"
                    }
                  >
                    {r.score == null
                      ? "—"
                      : `${r.score >= 0 ? "+" : ""}${r.score.toFixed(2)}`}
                    {r.dScore != null && Math.abs(r.dScore) >= 0.01 && (
                      <span style={{ fontSize: 11, opacity: 0.8 }}>
                        {" "}
                        {r.dScore > 0 ? "+" : ""}
                        {r.dScore.toFixed(2)}
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={5}
              style={{ borderTop: `2px solid ${LINE}`, height: 6 }}
            />
          </tr>
          <tr>
            <td
              style={{
                padding: "3px 8px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 800,
                fontSize: 12,
                color: INK,
                whiteSpace: "nowrap",
              }}
            >
              {rows.length === 18 ? "Course" : `${rows.length} holes`}
            </td>
            <td
              style={{
                ...th,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                fontWeight: 800,
                color: INK,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {totalPar ? totalPar.value : "—"}
            </td>

            <td style={{ padding: "3px 8px", textAlign: "right" }}>
              <span
                style={{
                  ...cellBox,
                  ...tone(
                    totalDYards ? totalDYards.value / 40 : null,
                  ),
                  minWidth: 96,
                }}
                title={
                  totalYards
                    ? `${totalYards.value.toLocaleString()} yards over ${totalYards.n} holes${totalDYards ? `, ${totalDYards.value >= 0 ? "+" : ""}${Math.round(totalDYards.value)} vs this course's other rounds` : ""}`
                    : "no per-round yardage"
                }
              >
                {totalYards ? totalYards.value.toLocaleString() : "—"}
                {totalDYards && Math.abs(totalDYards.value) >= 1 && (
                  <span style={{ fontSize: 11, opacity: 0.8 }}>
                    {" "}
                    {totalDYards.value > 0 ? "+" : ""}
                    {Math.round(totalDYards.value)}
                  </span>
                )}
              </span>
            </td>

            <td style={{ padding: "3px 8px", textAlign: "right" }}>
              <span
                style={{
                  ...cellBox,
                  background: "transparent",
                  color: MUTED,
                  fontSize: 11.5,
                  minWidth: 84,
                }}
                title="Holes by wind direction. Head and tail components cancel when summed, so a course total would read as zero however hard it blew."
              >
                {windSplit.into + windSplit.down + windSplit.cross === 0
                  ? "—"
                  : `${windSplit.into}↑ ${windSplit.down}↓ ${windSplit.cross}→`}
              </span>
            </td>

            <td style={{ padding: "3px 8px", textAlign: "right" }}>
              <span
                style={{
                  ...cellBox,
                  ...tone(
                    totalDScore ? totalDScore.value / 1.5 : null,
                  ),
                  minWidth: 96,
                }}
                title={
                  totalScore
                    ? `Field averaged ${totalScore.value >= 0 ? "+" : ""}${totalScore.value.toFixed(2)} vs par over ${totalScore.n} holes${totalDScore ? `, ${totalDScore.value >= 0 ? "+" : ""}${totalDScore.value.toFixed(2)} vs this course's other rounds` : ""}`
                    : "no scoring yet"
                }
              >
                {totalScore
                  ? `${totalScore.value >= 0 ? "+" : ""}${totalScore.value.toFixed(1)}`
                  : "—"}
                {totalDScore && Math.abs(totalDScore.value) >= 0.05 && (
                  <span style={{ fontSize: 11, opacity: 0.8 }}>
                    {" "}
                    {totalDScore.value > 0 ? "+" : ""}
                    {totalDScore.value.toFixed(1)}
                  </span>
                )}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
      <p
        style={{
          fontSize: 11.5,
          color: MUTED,
          margin: "10px 2px 0",
          lineHeight: 1.5,
          maxWidth: 640,
        }}
      >
        Red means the hole played harder, green easier — in every column.
        Length and wind are both measured against{" "}
        <strong style={{ color: INK }}>the same hole on the other rounds
        this week</strong>, so a row where the setup eased but the scoring
        rose is worth a second look rather than a story.
      </p>
      <p
        style={{
          fontSize: 11,
          color: "oklch(0.62 0.018 150)",
          margin: "6px 2px 0",
          lineHeight: 1.5,
          maxWidth: 640,
          borderTop: `1px solid ${LINE}`,
          paddingTop: 6,
        }}
      >
        Wind is the round&rsquo;s daylight average resolved onto each
        hole&rsquo;s tee-to-green line; it does not follow a group round the
        course.
      </p>
    </div>
  );
}
