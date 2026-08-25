"use client";

/**
 * Horizontal weather strip for ONE round. Renders below the chart
 * when a single round tab is active. Cells are 2-hour windows from
 * 6am to 8pm; each shows the condition, wind, gust, temperature and
 * any rain inside that window — the trend within the day, not just
 * the daily headline.
 *
 * Layout note. The cell background encodes average wind, which means
 * its lightness swings from pale to deep red across the range. Any
 * number printed straight onto it therefore has unpredictable
 * contrast, and the previous version lost the gust and rain figures
 * that way — both were sub-11px text laid directly on a colour that
 * might be nearly the same tone. Gust, temperature and rain now sit
 * in chips carrying their own background, so each is legible at every
 * wind level and the three read as distinct quantities rather than a
 * column of small grey numbers.
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
  /** Present in every ingested payload; the strip reads it directly
   *  rather than falling back to the day's min/max. */
  tempF?: number | null;
  /** Some payloads carry an hourly weather_code; if absent we fall
   *  back to the day-level condition/emoji from DailyWeatherView. */
  weatherCode?: number | null;
}

export interface DailyWeatherView {
  headline?: string;
  emoji?: string | null;
  condition?: string | null;
  date?: string | null;
  tempMaxF?: number | null;
  tempMinF?: number | null;
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

/** Rain below this in a 2-hour window is spray, not weather. */
const RAIN_THRESHOLD_IN = 0.01;

const INK = "oklch(0.26 0.02 150)";
const MUTED = "oklch(0.5 0.02 150)";
const LINE = "oklch(0.9 0.008 95)";
const RAIN = "oklch(0.52 0.13 250)";
const RAIN_BG = "oklch(0.94 0.04 250)";

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
  if (mph == null) return MUTED;
  if (mph >= 15) return "white";
  return "oklch(0.2 0.02 150)";
}

/** Chip styling. Always a SOLID white pill with dark text, never a
 *  translucent tint of the cell.
 *
 *  The first version used a 10% dark overlay on light cells, which
 *  left the gust and temperature figures barely separated from the
 *  green behind them — legible in theory, invisible in practice. A
 *  solid pill reads identically on pale green and on deep red, which
 *  is the whole point of putting them in pills. */
const CHIP: React.CSSProperties = {
  background: "white",
  color: "oklch(0.24 0.02 150)",
  border: "1px solid oklch(0.86 0.01 150)",
  fontSize: 13,
  fontWeight: 800,
  padding: "2px 8px",
  borderRadius: 999,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  lineHeight: 1.35,
};

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
  tempAvg: number | null;
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
        tempAvg: null,
        precipSum: 0,
        hasRain: false,
        emoji: dayEmoji,
        condition: dayCondition,
      };
    }
    const nums = (vals: (number | null | undefined)[]) =>
      vals.filter((v): v is number => typeof v === "number");
    const windVals = nums(pts.map((p) => p.windMph));
    const gustVals = nums(pts.map((p) => p.windGustMph));
    const tempVals = nums(pts.map((p) => p.tempF));
    const precipSum = pts.reduce((acc, p) => acc + (p.precipInches ?? 0), 0);
    // Condition preference: if any bucket-hour saw rain, override the
    // day-level "cloudy" with a wet icon so the reader sees WHEN it
    // rained. Otherwise inherit the day's condition.
    let emoji = dayEmoji;
    let condition = dayCondition;
    if (precipSum >= RAIN_THRESHOLD_IN) {
      emoji = "🌧";
      condition = "Rain";
    } else {
      const codes = nums(pts.map((p) => p.weatherCode));
      if (codes.length > 0) {
        const c = classifyCode(codes[Math.floor(codes.length / 2)]);
        if (c.emoji) {
          emoji = c.emoji;
          condition = c.condition;
        }
      } else {
        // No hourly code in this payload. Inheriting the DAY's emoji
        // would stamp a rain cloud on every window of a day that saw
        // one evening shower — which is exactly backwards, since the
        // point of the strip is showing WHEN it rained. A dry window
        // with no per-hour code gets no icon; the wind colour and the
        // pills carry the information.
        emoji = "";
        condition = dayCondition || "Dry";
      }
    }
    const avg = (v: number[]) =>
      v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    return {
      startHour: start,
      windAvg: avg(windVals),
      gustPeak: gustVals.length ? Math.max(...gustVals) : null,
      tempAvg: avg(tempVals),
      precipSum,
      hasRain: precipSum >= RAIN_THRESHOLD_IN,
      emoji,
      condition,
    };
  });
}

/** One headline figure for the whole round. Three of these sit above
 *  the hourly cells so the day's shape is readable without parsing
 *  seven columns. */
function DayStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "6px 12px",
        borderRadius: 8,
        background: "oklch(0.97 0.005 95)",
        border: `1px solid ${LINE}`,
        minWidth: 92,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: MUTED,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 19,
          fontWeight: 800,
          fontFamily: "var(--font-mono, monospace)",
          color: accent ?? INK,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function WeatherStrip({ day, roundLabel }: Props) {
  if (!day) return null;
  const hourly = day.hourly ?? [];
  if (hourly.length === 0) return null;
  const buckets = bucketize(hourly, day.emoji ?? "", day.condition ?? "");

  // Day-level rollups. Computed from the PLAYED window (the buckets)
  // rather than the full 24h so an overnight downpour doesn't get
  // reported as the round's weather.
  const played = buckets.filter((b) => b.windAvg != null || b.tempAvg != null);
  const peakGust = played.reduce<number | null>(
    (m, b) => (b.gustPeak != null && (m == null || b.gustPeak > m) ? b.gustPeak : m),
    null,
  );
  const totalRain = played.reduce((s, b) => s + b.precipSum, 0);
  const temps = played
    .map((b) => b.tempAvg)
    .filter((v): v is number => typeof v === "number");
  const tempLo = temps.length ? Math.min(...temps) : day.tempMinF ?? null;
  const tempHi = temps.length ? Math.max(...temps) : day.tempMaxF ?? null;

  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 12px",
        border: `1px solid ${LINE}`,
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
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 12.5,
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
              fontSize: 12,
              color: MUTED,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {day.headline}
          </span>
        )}
      </div>

      {/* Day headline figures — the three the reader actually wants. */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <DayStat
          label="Temp"
          value={
            tempLo != null && tempHi != null
              ? `${Math.round(tempLo)}–${Math.round(tempHi)}°`
              : "—"
          }
        />
        <DayStat
          label="Peak gust"
          value={peakGust != null ? `${Math.round(peakGust)} mph` : "—"}
          accent={
            peakGust != null && peakGust >= 20
              ? "oklch(0.55 0.18 25)"
              : undefined
          }
        />
        <DayStat
          label="Rain 6am-8pm"
          value={totalRain >= RAIN_THRESHOLD_IN ? `${totalRain.toFixed(2)}"` : "None"}
          accent={totalRain >= RAIN_THRESHOLD_IN ? RAIN : undefined}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${BUCKET_STARTS.length}, minmax(112px, 1fr))`,
          columnGap: 6,
          minWidth: 800,
        }}
      >
        {buckets.map((b) => {
          const bg = windColour(b.windAvg);
          const fg = windTextColour(b.windAvg);
          const tooltip =
            b.windAvg == null
              ? `${formatRange(b.startHour)}: no data`
              : `${formatRange(b.startHour)} · ${b.condition} · ${b.windAvg.toFixed(1)}mph avg wind, gusts to ${b.gustPeak?.toFixed(0) ?? "—"}mph` +
                (b.tempAvg != null ? `, ${Math.round(b.tempAvg)}°F` : "") +
                (b.hasRain ? `, ${b.precipSum.toFixed(2)}" rain` : ", dry");
          return (
            <div
              key={b.startHour}
              title={tooltip}
              style={{
                background: bg,
                color: fg,
                borderRadius: 8,
                padding: "8px 6px 9px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: 0.3,
                  opacity: 0.95,
                }}
              >
                {formatRange(b.startHour)}
              </span>

              {b.windAvg == null ? (
                <span style={{ fontSize: 13, opacity: 0.7 }}>no data</span>
              ) : (
                <>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 5,
                      lineHeight: 1,
                    }}
                  >
                    <span style={{ fontSize: 20, lineHeight: 1 }} aria-label={b.condition}>
                      {b.emoji || ""}
                    </span>
                    <span
                      style={{
                        fontSize: 30,
                        fontWeight: 800,
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: -0.5,
                      }}
                    >
                      {Math.round(b.windAvg)}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                      mph
                    </span>
                  </span>

                  {/* Gust, temp and rain as solid pills so they hold up
                      on every cell colour. Wrapped rather than fixed to
                      one row — a wet window needs three pills and a dry
                      one needs two. */}
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={CHIP}>
                      <span style={{ opacity: 0.6, fontWeight: 700 }}>gust </span>
                      {Math.round(b.gustPeak ?? b.windAvg)}
                    </span>
                    {b.tempAvg != null && (
                      <span style={CHIP}>{Math.round(b.tempAvg)}&deg;</span>
                    )}
                    {b.hasRain && (
                      <span
                        style={{
                          ...CHIP,
                          background: RAIN_BG,
                          color: RAIN,
                          borderColor: RAIN,
                        }}
                      >
                        {b.precipSum.toFixed(2)}&quot;
                      </span>
                    )}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
