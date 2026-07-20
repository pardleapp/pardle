"use client";

import { Fragment } from "react";

/**
 * 4 rows (one per round), each row a horizontal strip of 2-hour
 * buckets covering the daytime playing window. Each cell shows:
 *
 *   • wind average (large)
 *   • wind gust (small)
 *   • condition icon (sunny / cloudy / rain)
 *
 * Background colour is a green→red ramp on wind average (calm to
 * damaging). Rain buckets get a droplet + inches label overlaid.
 *
 * Reads the `hourly` array baked into each round's DailyWeather
 * (historical) or fetched at request time (live). Silently renders
 * nothing when no hourly data is present.
 */

export interface HourlyPointView {
  hour: number;
  windMph: number | null;
  windGustMph: number | null;
  windDirCompass?: string | null;
  precipInches: number | null;
}

export interface DailyWeatherView {
  headline?: string;
  emoji?: string | null;
  condition?: string | null;
  date?: string | null;
  hourly?: HourlyPointView[];
}

interface Props {
  weatherByRound: Record<string, DailyWeatherView | null> | null | undefined;
}

const ROUNDS = [1, 2, 3, 4];

// 06:00 → 20:00 in 2-hour steps = 7 buckets. Covers every realistic
// tee time and finish for a PGA Tour round.
const BUCKET_STARTS = [6, 8, 10, 12, 14, 16, 18];
const BUCKET_HOURS = 2;

function formatHour(h: number): string {
  const hr = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "am" : "pm";
  return `${hr}${ampm}`;
}

/** Wind mph → oklch background. Piecewise linear ramp:
 *   0–5   pale grey-green   (calm)
 *   5–10  green              (breeze)
 *   10–15 amber              (moderate)
 *   15–20 orange             (strong)
 *   20+   red                (howling — scoring hurt) */
function windColour(mph: number | null): string {
  if (mph == null || !Number.isFinite(mph)) return "oklch(0.96 0.006 95)";
  if (mph < 5) return "oklch(0.94 0.02 150)";
  if (mph < 10) return "oklch(0.86 0.09 150)";
  if (mph < 15) return "oklch(0.85 0.11 85)";
  if (mph < 20) return "oklch(0.75 0.15 50)";
  return "oklch(0.62 0.18 25)";
}

function windTextColour(mph: number | null): string {
  if (mph == null) return "oklch(0.5 0.02 150)";
  if (mph >= 15) return "white";
  return "oklch(0.2 0.02 150)";
}

interface Bucketed {
  startHour: number;
  windAvg: number | null;
  gustAvg: number | null;
  precipSum: number | null;
  hasRain: boolean;
}

function bucketize(hourly: HourlyPointView[]): Bucketed[] {
  return BUCKET_STARTS.map((start) => {
    const pts = hourly.filter(
      (p) => p.hour >= start && p.hour < start + BUCKET_HOURS,
    );
    if (pts.length === 0) {
      return {
        startHour: start,
        windAvg: null,
        gustAvg: null,
        precipSum: null,
        hasRain: false,
      };
    }
    const windVals = pts.map((p) => p.windMph).filter((v): v is number => typeof v === "number");
    const gustVals = pts.map((p) => p.windGustMph).filter((v): v is number => typeof v === "number");
    const precipVals = pts.map((p) => p.precipInches ?? 0);
    const precipSum = precipVals.reduce((a, b) => a + b, 0);
    return {
      startHour: start,
      windAvg: windVals.length ? windVals.reduce((a, b) => a + b, 0) / windVals.length : null,
      gustAvg: gustVals.length ? Math.max(...gustVals) : null, // peak gust in window, not avg
      precipSum,
      hasRain: precipSum >= 0.02,
    };
  });
}

function labelForRound(day: DailyWeatherView | null): string {
  if (!day) return "—";
  if (day.emoji && day.condition) return `${day.emoji} ${day.condition}`;
  return day.emoji ?? day.condition ?? "—";
}

export default function WeatherStrip({ weatherByRound }: Props) {
  if (!weatherByRound) return null;
  const anyHourly = ROUNDS.some(
    (r) => (weatherByRound[String(r)]?.hourly?.length ?? 0) > 0,
  );
  if (!anyHourly) return null;

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 8,
        background: "white",
        fontFamily:
          "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
        color: "oklch(0.3 0.02 150)",
        overflowX: "auto",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `48px 90px repeat(${BUCKET_STARTS.length}, minmax(56px, 1fr))`,
          columnGap: 4,
          rowGap: 4,
          alignItems: "center",
          minWidth: 620,
        }}
      >
        {/* Header row — R label col empty, condition col empty, then hour labels */}
        <div />
        <div />
        {BUCKET_STARTS.map((h) => (
          <div
            key={`h-${h}`}
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono, monospace)",
              color: "oklch(0.5 0.02 150)",
              textAlign: "center",
              paddingBottom: 2,
            }}
          >
            {formatHour(h)}
          </div>
        ))}

        {/* One row per round */}
        {ROUNDS.map((r) => {
          const day = weatherByRound[String(r)] ?? null;
          const hourly = day?.hourly ?? [];
          const buckets = hourly.length > 0 ? bucketize(hourly) : [];
          return (
            <Fragment key={r}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "oklch(0.25 0.02 150)",
                  fontFamily: "var(--font-mono, monospace)",
                  letterSpacing: 0.4,
                }}
              >
                R{r}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "oklch(0.5 0.02 150)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={day?.headline ?? undefined}
              >
                {labelForRound(day)}
              </div>
              {buckets.length === 0
                ? BUCKET_STARTS.map((h) => (
                    <div
                      key={`empty-${r}-${h}`}
                      style={{
                        height: 44,
                        background: "oklch(0.96 0.006 95)",
                        borderRadius: 4,
                      }}
                    />
                  ))
                : buckets.map((b) => {
                    const bg = windColour(b.windAvg);
                    const fg = windTextColour(b.windAvg);
                    const title =
                      b.windAvg == null
                        ? `${formatHour(b.startHour)}–${formatHour(b.startHour + BUCKET_HOURS)}: no data`
                        : `${formatHour(b.startHour)}–${formatHour(b.startHour + BUCKET_HOURS)}: ${b.windAvg.toFixed(0)}mph avg, gusts to ${b.gustAvg?.toFixed(0) ?? "—"}mph${b.hasRain ? `, ${(b.precipSum ?? 0).toFixed(2)}" rain` : ""}`;
                    return (
                      <div
                        key={`c-${r}-${b.startHour}`}
                        title={title}
                        style={{
                          height: 44,
                          background: bg,
                          color: fg,
                          borderRadius: 4,
                          padding: "3px 4px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          lineHeight: 1.1,
                          fontFamily: "var(--font-mono, monospace)",
                          position: "relative",
                        }}
                      >
                        {b.windAvg == null ? (
                          <span style={{ fontSize: 10, opacity: 0.6 }}>—</span>
                        ) : (
                          <>
                            <span style={{ fontSize: 14, fontWeight: 800 }}>
                              {Math.round(b.windAvg)}
                            </span>
                            <span
                              style={{
                                fontSize: 9,
                                opacity: 0.8,
                                marginTop: 1,
                              }}
                            >
                              g{Math.round(b.gustAvg ?? 0)}
                            </span>
                          </>
                        )}
                        {b.hasRain && (
                          <span
                            style={{
                              position: "absolute",
                              top: 2,
                              right: 3,
                              fontSize: 10,
                            }}
                            title={`${(b.precipSum ?? 0).toFixed(2)}" rain`}
                          >
                            💧
                          </span>
                        )}
                      </div>
                    );
                  })}
            </Fragment>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: "oklch(0.55 0.02 150)",
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span>Wind mph (avg / gust). Colour: calm → damaging.</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {[3, 7, 12, 17, 22].map((mph) => (
            <span
              key={mph}
              style={{
                width: 18,
                height: 10,
                background: windColour(mph),
                borderRadius: 2,
                display: "inline-block",
                border: "1px solid oklch(0.92 0.008 95)",
              }}
            />
          ))}
          <span style={{ marginLeft: 4 }}>&lt;5 · 10 · 15 · 20 · 20+</span>
        </span>
      </div>
    </div>
  );
}
