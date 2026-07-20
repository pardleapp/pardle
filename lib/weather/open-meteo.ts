/**
 * Small Open-Meteo client for round-level headline weather.
 *
 * Two endpoints, one shape:
 *   - archive-api.open-meteo.com  → historical, ≥ ~5 days old
 *   - api.open-meteo.com/v1/forecast → recent past + forecast
 *
 * We return a compact DailyWeather per requested date so the analysis
 * pages can render a one-liner ("☀️ 78°F · Wind 12mph SW · Dry")
 * under each round tab. No API key needed.
 *
 * Server-only; fetch results are lightly cached in-process (10 min)
 * so we don't hammer Open-Meteo on every request.
 */

import "server-only";

export interface DailyWeather {
  date: string; // YYYY-MM-DD (in course-local tz)
  tempMaxF: number | null;
  tempMinF: number | null;
  windAvgMph: number | null;
  windGustMph: number | null;
  windDirDeg: number | null;
  windDirCompass: string | null;
  precipInches: number | null;
  weatherCode: number | null;
  condition: string;
  emoji: string;
  /** One-line ready-to-render summary. */
  headline: string;
  /** 24 hourly points for the same date, sorted ascending. Populated
   *  when the caller uses getDailyAndHourlyWeather (or getDailyWeather
   *  → hourly is []). */
  hourly?: HourlyPoint[];
}

export interface HourlyPoint {
  time: string; // ISO-ish "YYYY-MM-DDTHH:00" in the requested tz
  hour: number; // 0-23 local
  windMph: number | null;
  windGustMph: number | null;
  windDirDeg: number | null;
  windDirCompass: string | null;
  tempF: number | null;
  precipInches: number | null;
}

interface OpenMeteoDailyResp {
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
    wind_gusts_10m_max?: (number | null)[];
    wind_direction_10m_dominant?: (number | null)[];
    weather_code?: (number | null)[];
  };
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    precipitation?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    wind_direction_10m?: (number | null)[];
  };
}

const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant",
  "weather_code",
].join(",");

const HOURLY_VARS = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
].join(",");

const COMMON_QS =
  "temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch";

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

function degToCompass(deg: number | null | undefined): string | null {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return COMPASS[idx];
}

/** WMO weather codes → short human label + emoji. */
function classifyCode(code: number | null | undefined): {
  condition: string;
  emoji: string;
} {
  if (typeof code !== "number") return { condition: "—", emoji: "" };
  if (code === 0) return { condition: "Clear", emoji: "☀️" };
  if (code === 1) return { condition: "Mostly clear", emoji: "🌤" };
  if (code === 2) return { condition: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { condition: "Overcast", emoji: "☁️" };
  if (code >= 45 && code <= 48) return { condition: "Fog", emoji: "🌫" };
  if (code >= 51 && code <= 57) return { condition: "Drizzle", emoji: "🌦" };
  if (code >= 61 && code <= 67) return { condition: "Rain", emoji: "🌧" };
  if (code >= 71 && code <= 77) return { condition: "Snow", emoji: "🌨" };
  if (code >= 80 && code <= 82) return { condition: "Showers", emoji: "🌧" };
  if (code >= 85 && code <= 86) return { condition: "Snow showers", emoji: "🌨" };
  if (code >= 95 && code <= 99) return { condition: "Thunderstorm", emoji: "⛈" };
  return { condition: "—", emoji: "" };
}

function buildHeadline(w: Omit<DailyWeather, "headline">): string {
  const parts: string[] = [];
  if (w.emoji) parts.push(w.emoji);
  if (typeof w.tempMaxF === "number") parts.push(`${Math.round(w.tempMaxF)}°F`);
  const windBits: string[] = [];
  if (typeof w.windAvgMph === "number") {
    windBits.push(`${Math.round(w.windAvgMph)}mph`);
    if (w.windDirCompass) windBits.push(w.windDirCompass);
  }
  if (typeof w.windGustMph === "number" && (w.windAvgMph ?? 0) > 0) {
    windBits.push(`(gusts ${Math.round(w.windGustMph)})`);
  }
  if (windBits.length > 0) parts.push(`Wind ${windBits.join(" ")}`);
  if (typeof w.precipInches === "number") {
    if (w.precipInches < 0.05) parts.push("Dry");
    else parts.push(`${w.precipInches.toFixed(2)}" rain`);
  }
  return parts.join(" · ");
}

interface CacheEntry {
  ts: number;
  data: DailyWeather[];
}
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function isArchiveable(latestDate: string): boolean {
  // Open-Meteo archive is reliable for dates ≥ ~5 days old. Forecast
  // API handles the recent past (past_days) plus future. Route on the
  // most recent date in the request window.
  const now = Date.now();
  const cutoff = 6 * 24 * 60 * 60 * 1000; // 6 days ago
  const latestMs = Date.parse(latestDate + "T12:00:00Z");
  if (!Number.isFinite(latestMs)) return true;
  return now - latestMs > cutoff;
}

async function fetchOpenMeteo(url: string): Promise<OpenMeteoDailyResp | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[open-meteo] ${res.status}: ${url}`);
      return null;
    }
    return (await res.json()) as OpenMeteoDailyResp;
  } catch (err) {
    console.warn(`[open-meteo] fetch failed`, err);
    return null;
  }
}

function shapeHourlyByDate(
  payload: OpenMeteoDailyResp | null,
): Map<string, HourlyPoint[]> {
  const h = payload?.hourly;
  const out = new Map<string, HourlyPoint[]>();
  if (!h?.time) return out;
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    const day = t.slice(0, 10);
    const hourNum = Number(t.slice(11, 13));
    const dir = h.wind_direction_10m?.[i] ?? null;
    const arr = out.get(day) ?? [];
    arr.push({
      time: t,
      hour: Number.isFinite(hourNum) ? hourNum : 0,
      windMph: h.wind_speed_10m?.[i] ?? null,
      windGustMph: h.wind_gusts_10m?.[i] ?? null,
      windDirDeg: dir,
      windDirCompass: degToCompass(dir),
      tempF: h.temperature_2m?.[i] ?? null,
      precipInches: h.precipitation?.[i] ?? null,
    });
    out.set(day, arr);
  }
  return out;
}

function shapeDaily(payload: OpenMeteoDailyResp | null): DailyWeather[] {
  const d = payload?.daily;
  if (!d?.time) return [];
  const hourlyByDate = shapeHourlyByDate(payload);
  const out: DailyWeather[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const dir = d.wind_direction_10m_dominant?.[i] ?? null;
    const code = d.weather_code?.[i] ?? null;
    const { condition, emoji } = classifyCode(code);
    const base: Omit<DailyWeather, "headline" | "hourly"> = {
      date: d.time[i],
      tempMaxF: d.temperature_2m_max?.[i] ?? null,
      tempMinF: d.temperature_2m_min?.[i] ?? null,
      windAvgMph: d.wind_speed_10m_max?.[i] ?? null,
      windGustMph: d.wind_gusts_10m_max?.[i] ?? null,
      windDirDeg: dir,
      windDirCompass: degToCompass(dir),
      precipInches: d.precipitation_sum?.[i] ?? null,
      weatherCode: code,
      condition,
      emoji,
    };
    out.push({
      ...base,
      headline: buildHeadline(base),
      hourly: hourlyByDate.get(d.time[i]) ?? [],
    });
  }
  return out;
}

/** Fetch daily weather for a set of dates at a given lat/lon. Returns
 *  entries in the same order as the request (missing days omitted). */
export async function getDailyWeather(
  lat: number,
  lon: number,
  dates: string[],
  timezone: string = "auto",
): Promise<DailyWeather[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const startDate = sorted[0];
  const endDate = sorted[sorted.length - 1];
  const cacheKey = `${lat},${lon},${startDate}..${endDate},${timezone}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;

  const encodedTz = encodeURIComponent(timezone);
  const useArchive = isArchiveable(endDate);
  let url: string;
  if (useArchive) {
    url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat}&longitude=${lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&daily=${DAILY_VARS}&hourly=${HOURLY_VARS}` +
      `&${COMMON_QS}&timezone=${encodedTz}`;
  } else {
    url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&daily=${DAILY_VARS}&hourly=${HOURLY_VARS}` +
      `&${COMMON_QS}&timezone=${encodedTz}` +
      `&past_days=7&forecast_days=10`;
  }
  const payload = await fetchOpenMeteo(url);
  const shaped = shapeDaily(payload);
  // Filter to just requested dates (payload may include neighbours).
  const want = new Set(dates);
  const filtered = shaped.filter((w) => want.has(w.date));
  cache.set(cacheKey, { ts: now, data: filtered });
  return filtered;
}
