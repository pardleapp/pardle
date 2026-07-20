"use client";

/**
 * Horizontal weather strip for ONE round. Renders below the chart
 * when a single round tab is active. Cells are 2-hour windows from
 * 6am to 8pm; each shows the condition, wind average, and peak gust
 * inside that window — the trend within the day, not just the daily
 * headline.
 *
 * Silently renders nothing when no hourly data is present or when
 * the caller is showing "All rounds" (no single round to pin to).
 */

export interface HourlyPointView {
  hour: number;
  windMph: number | null;
  windGustMph: number | null;
  windDirCompass?: string | null;
  precipInches: number | null;
  /** Some payloads carry an hourly weather_code; if absent we fall
   *  back to the day-level condition/emoji from DailyWeatherView. */
  weatherCode?: number | null;
}

export interface DailyWeatherView {
  headline?: string;
  emoji?: string | null;
  condition?: string | null;
  date?: string | null;
  hourly?: HourlyPointView[];
}

interface Props {
  /** The single round's weather to render. Null → renders nothing. */
  day: DailyWeatherView | null | undefined;
  /** Displayed as the row label, e.g. "R1 weather". */
  roundLabel?: string;
}

// 06:00 → 20:00 in 2-hour steps = 7 buckets.
const BUCKET_STARTS = [6, 8, 10, 12, 14, 16, 18];
const BUCKET_HOURS = 2;

function formatHour(h: number): string {
  const hr = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "am" : "pm";
  return `${hr}${ampm}`;
}

function formatRange(start: number): string {
  return `${formatHour(start)}–${formatHour(start + BUCKET_HOURS)}`;
}

/** Wind mph → oklch background. Piecewise ramp:
 *   0–5   pale       (calm)
 *   5–10  green      (breeze)
 *   10–15 amber      (moderate)
 *   15–20 orange     (strong)
 *   20+   red        (howling — scoring hurt) */
function windColour(mph: number | null): string {
  if (mph == null || !Number.isFinite(mph)) return "oklch(0.96 0.006 95)";
  if (mph < 5) return "oklch(0.94 0.02 150)";
  if (mph < 10) return "oklch(0.86 0.09 150)";
  if (mph < 15) return "oklch(0.85 0.11 85)";
  if (mph < 20) return "oklch(0.78 0.15 50)";
  return "oklch(0.65 0.18 25)";
}

function windTextColour(mph: number | null): string {
  if (mph == null) return "oklch(0.5 0.02 150)";
  if (mph >= 15) return "white";
  return "oklch(0.2 0.02 150)";
}

/** WMO weather code → short label + emoji. Duplicated from
 *  lib/weather/open-meteo.ts because that module is server-only. */
function classifyCode(code: number | null | undefined): {
  condition: string;
  emoji: string;
} {
  if (typeof code !== "number") return { condition: "—", emoji: "" };
  if (code === 0) return { condition: "Sunny", emoji: "☀️" };
  if (code === 1) return { condition: "Mostly clear", emoji: "🌤" };
  if (code === 2) return { condition: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { condition: "Overcast", emoji: "☁️" };
  if (code >= 45 && code <= 48) return { condition: "Fog", emoji: "🌫" };
  if (code >= 51 && code <= 57) return { condition: "Drizzle", emoji: "🌦" };
  if (code >= 61 && code <= 67) return { condition: "Rain", emoji: "🌧" };
  if (code >= 71 && code <= 77) return { condition: "Snow", emoji: "🌨" };
  if (code >= 80 && code <= 82) return { condition: "Showers", emoji: "🌧" };
  if (code >= 85 && code <= 86) return { condition: "Snow", emoji: "🌨" };
  if (code >= 95 && code <= 99) return { condition: "Storm", emoji: "⛈" };
  return { condition: "—", emoji: "" };
}

interface Bucket {
  startHour: number;
  windAvg: number | null;
  gustPeak: number | null;
  precipSum: number;
  hasRain: boolean;
  emoji: string;
  condition: string;
}

function bucketize(
  hourly: HourlyPointView[],
  dayEmoji: string,
  dayCondition: string,
): Bucket[] {
  return BUCKET_STARTS.map((start) => {
    const pts = hourly.filter(
      (p) => p.hour >= start && p.hour < start + BUCKET_HOURS,
    );
    if (pts.length === 0) {
      return {
        startHour: start,
        windAvg: null,
        gustPeak: null,
        precipSum: 0,
        hasRain: false,
        emoji: dayEmoji,
        condition: dayCondition,
      };
    }
    const windVals = pts.map((p) => p.windMph).filter((v): v is number => typeof v === "number");
    const gustVals = pts.map((p) => p.windGustMph).filter((v): v is number => typeof v === "number");
    const precipSum = pts.reduce((acc, p) => acc + (p.precipInches ?? 0), 0);
    // Condition preference: if any bucket-hour saw rain, override the
    // day-level "cloudy" with a wet icon so the reader sees WHEN it
    // rained. Otherwise inherit the day's condition.
    let emoji = dayEmoji;
    let condition = dayCondition;
    if (precipSum >= 0.02) {
      emoji = "🌧";
      condition = "Rain";
    } else {
      // Look for the modal hourly weather_code among the bucket's
      // hours (if the payload carries it). Falls back to day-level.
      const codes = pts.map((p) => p.weatherCode).filter((c): c is number => typeof c === "number");
      if (codes.length > 0) {
        const c = classifyCode(codes[Math.floor(codes.length / 2)]);
        if (c.emoji) {
          emoji = c.emoji;
          condition = c.condition;
        }
      }
    }
    return {
      startHour: start,
      windAvg: windVals.length ? windVals.reduce((a, b) => a + b, 0) / windVals.length : null,
      gustPeak: gustVals.length ? Math.max(...gustVals) : null,
      precipSum,
      hasRain: precipSum >= 0.02,
      emoji,
      condition,
    };
  });
}

export default function WeatherStrip({ day, roundLabel }: Props) {
  if (!day) return null;
  const hourly = day.hourly ?? [];
  if (hourly.length === 0) return null;
  const buckets = bucketize(
    hourly,
    day.emoji ?? "",
    day.condition ?? "",
  );

  return (
    <div
      style={{
        marginTop: 12,
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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "oklch(0.25 0.02 150)",
            fontFamily: "var(--font-mono, monospace)",
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          {roundLabel ?? "Weather"}
        </span>
        {day.headline && (
          <span
            style={{
              fontSize: 11,
              color: "oklch(0.5 0.02 150)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {day.headline}
          </span>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${BUCKET_STARTS.length}, minmax(78px, 1fr))`,
          columnGap: 4,
          minWidth: 560,
        }}
      >
        {buckets.map((b) => {
          const bg = windColour(b.windAvg);
          const fg = windTextColour(b.windAvg);
          const tooltip =
            b.windAvg == null
              ? `${formatRange(b.startHour)}: no data`
              : `${formatRange(b.startHour)} · ${b.condition} · ${b.windAvg.toFixed(1)}mph avg wind, gusts to ${b.gustPeak?.toFixed(0) ?? "—"}mph${b.hasRain ? `, ${b.precipSum.toFixed(2)}" rain` : ""}`;
          return (
            <div
              key={b.startHour}
              title={tooltip}
              style={{
                background: bg,
                color: fg,
                borderRadius: 6,
                padding: "6px 6px 5px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                lineHeight: 1.15,
                fontFamily: "var(--font-mono, monospace)",
                minHeight: 72,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  opacity: 0.85,
                  letterSpacing: 0.3,
                }}
              >
                {formatRange(b.startHour)}
              </span>
              <span
                style={{
                  fontSize: 15,
                  marginTop: 3,
                  lineHeight: 1,
                }}
                aria-label={b.condition}
              >
                {b.emoji || "—"}
              </span>
              {b.windAvg == null ? (
                <span style={{ fontSize: 10, marginTop: 6, opacity: 0.6 }}>—</span>
              ) : (
                <>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      marginTop: 4,
                    }}
                  >
                    {Math.round(b.windAvg)}mph
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      opacity: 0.85,
                      marginTop: 1,
                    }}
                  >
                    gusts {Math.round(b.gustPeak ?? 0)}
                  </span>
                </>
              )}
              {b.hasRain && (
                <span
                  style={{
                    fontSize: 9,
                    marginTop: 3,
                    opacity: 0.9,
                  }}
                >
                  💧 {b.precipSum.toFixed(2)}&quot;
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
