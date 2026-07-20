"use client";

import { Fragment } from "react";

/**
 * Compact 4-row weather panel for the analysis pages. Reads
 * `weatherByRound` from either API response (historical: baked in,
 * live: fresh Open-Meteo call). Renders as one line per round with
 * emoji + headline text; falls back to a muted "—" if a round has
 * no weather.
 *
 * Kept intentionally small so it doesn't compete with the chart
 * beside it — this is context, not the story.
 */

export interface DailyWeatherView {
  headline: string;
  emoji?: string | null;
  condition?: string | null;
  date?: string | null;
}

interface Props {
  weatherByRound: Record<string, DailyWeatherView | null> | null | undefined;
  /** Optional — highlights the row for the currently-selected round.
   *  Pass the same round number the chart is showing. */
  activeRound?: number | null;
}

const ROUNDS = [1, 2, 3, 4];

export default function WeatherStrip({ weatherByRound, activeRound }: Props) {
  if (!weatherByRound) return null;
  const anyPresent = ROUNDS.some((r) => weatherByRound[String(r)]);
  if (!anyPresent) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 10,
        rowGap: 4,
        padding: "10px 12px",
        marginTop: 10,
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 8,
        background: "white",
        fontSize: 12,
        fontFamily:
          "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
        color: "oklch(0.3 0.02 150)",
        maxWidth: 560,
      }}
    >
      {ROUNDS.map((r) => {
        const w = weatherByRound[String(r)];
        const active = activeRound === r;
        const labelStyle: React.CSSProperties = {
          fontWeight: 700,
          color: active ? "oklch(0.25 0.02 150)" : "oklch(0.5 0.02 150)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          letterSpacing: 0.4,
          alignSelf: "center",
        };
        const rowStyle: React.CSSProperties = {
          color: active ? "oklch(0.2 0.02 150)" : "oklch(0.4 0.02 150)",
          alignSelf: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        };
        return (
          <Fragment key={r}>
            <span style={labelStyle}>R{r}</span>
            <span style={rowStyle}>
              {w?.headline || <span style={{ opacity: 0.5 }}>—</span>}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
