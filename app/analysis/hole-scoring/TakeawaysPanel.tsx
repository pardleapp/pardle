"use client";

/**
 * Auto-generated takeaway strip above the hole-scoring table.
 *
 * Reads the same HoleRow[] the table builds and calls out the 3-4
 * holes where the setup + wind story doesn't line up with the
 * scoring story — the kind of "shorter, downwind, but played worse"
 * calls that would otherwise get lost in an 18-row grid.
 *
 * If nothing rises above the noise floor for this round (calm
 * weather + neutral setup + everything scored as expected), the
 * strip renders nothing rather than an empty box.
 */

import { buildRows } from "./HoleSetup";
import { deriveTakeaways, type TakeawayKind } from "./takeaways";
import type { CoursePinHole } from "@/lib/golf-api/pgatour";
import type { HoleBirdieData } from "@/lib/analysis/course-birdies";
import type { DailyWeatherView } from "../_components/WeatherStrip";
import type { Cell } from "./HoleSetup";

interface Props {
  cells: Cell[];
  round: number;
  pinsByHole?: Map<number, CoursePinHole>;
  holeBearings?: Record<number, number> | null;
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
  /** Historical pin/scoring aggregate from the Pin analysis tool.
   *  When present, takeaway cards can attribute a scoring surprise to
   *  the specific pin cluster today's flag sits in, and offer a
   *  deep-link into that hole's pin-history modal. */
  birdieHistoryByHole?: Record<string, HoleBirdieData> | null;
  onHoleClick?: (hole: number) => void;
  limit?: number;
}

// Colour + emoji-free icon per takeaway kind. Icons stay as inline
// SVGs so the strip doesn't depend on an icon font. Colour is a soft
// tint that matches the scoring-easier / scoring-harder palette used
// in HoleSetup — same reader-visual language across both surfaces.
const KIND_STYLE: Record<
  TakeawayKind,
  { bg: string; border: string; ink: string; label: string }
> = {
  "surprise-hard": {
    bg: "oklch(0.96 0.05 25)",
    border: "oklch(0.86 0.10 25)",
    ink: "oklch(0.36 0.14 25)",
    label: "Played tougher than setup suggests",
  },
  "surprise-easy": {
    bg: "oklch(0.96 0.06 150)",
    border: "oklch(0.84 0.11 150)",
    ink: "oklch(0.32 0.13 150)",
    label: "Played softer than setup suggests",
  },
  "quiet-setup-loud-scoring": {
    bg: "oklch(0.97 0.04 60)",
    border: "oklch(0.88 0.08 60)",
    ink: "oklch(0.38 0.12 60)",
    label: "Pin doing the work",
  },
  "loud-setup-quiet-scoring": {
    bg: "oklch(0.97 0.03 260)",
    border: "oklch(0.88 0.06 260)",
    ink: "oklch(0.34 0.10 260)",
    label: "Setup moved, scoring didn't",
  },
  "yardage-jump": {
    bg: "oklch(0.97 0.02 95)",
    border: "oklch(0.88 0.04 95)",
    ink: "oklch(0.32 0.02 150)",
    label: "Setup change",
  },
  "wind-driven": {
    bg: "oklch(0.97 0.03 210)",
    border: "oklch(0.88 0.06 210)",
    ink: "oklch(0.34 0.09 210)",
    label: "Wind is the story",
  },
};

export default function Takeaways({
  cells,
  round,
  pinsByHole,
  holeBearings,
  weatherByRound,
  birdieHistoryByHole,
  onHoleClick,
  limit = 4,
}: Props) {
  const rows = buildRows({
    cells,
    round,
    pinsByHole,
    holeBearings,
    weatherByRound,
  });
  const pinsRecord = pinsByHole
    ? Object.fromEntries(pinsByHole.entries())
    : undefined;
  const takeaways = deriveTakeaways(rows, {
    limit,
    round,
    pinsByHole: pinsRecord,
    birdieHistoryByHole,
  });
  if (takeaways.length === 0) return null;

  return (
    <section
      aria-label={`R${round} takeaways`}
      style={{
        marginTop: 12,
        marginBottom: 4,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11.5,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          fontWeight: 800,
          color: "oklch(0.42 0.03 150)",
          fontFamily: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
        }}
      >
        What stands out
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))",
        }}
      >
        {takeaways.map((t) => {
          const style = KIND_STYLE[t.kind];
          const clickable = typeof onHoleClick === "function";
          const insight = t.pinInsight;
          return (
            <li key={t.hole} style={{ margin: 0 }}>
              <article
                style={{
                  background: style.bg,
                  border: `1px solid ${style.border}`,
                  borderLeft: `3px solid ${style.ink}`,
                  color: style.ink,
                  borderRadius: 10,
                  overflow: "hidden",
                  fontFamily:
                    "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <button
                  type="button"
                  onClick={clickable ? () => onHoleClick(t.hole) : undefined}
                  aria-label={`${t.headline}. ${t.detail}`}
                  style={{
                    all: "unset",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "10px 12px",
                    cursor: clickable ? "pointer" : "default",
                    color: style.ink,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9.5,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      fontWeight: 800,
                      opacity: 0.7,
                    }}
                  >
                    {style.label}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      letterSpacing: -0.005,
                      lineHeight: 1.25,
                    }}
                  >
                    {t.headline}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: "oklch(0.35 0.02 150)",
                      lineHeight: 1.4,
                    }}
                  >
                    {t.detail}
                  </div>
                </button>
                {insight && (
                  <a
                    href={`/analysis/course-heatmap?hole=${t.hole}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 12px",
                      borderTop: `1px dashed ${style.border}`,
                      background: "rgba(255,255,255,0.35)",
                      textDecoration: "none",
                      color: style.ink,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        color: "oklch(0.32 0.02 150)",
                      }}
                    >
                      {insight.headline}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        letterSpacing: 0.4,
                        textTransform: "uppercase",
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Pin history →
                    </span>
                  </a>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
