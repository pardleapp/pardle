/**
 * HRRR (High-Resolution Rapid Refresh) hourly wind loader, built on
 * Open-Meteo's `models=gfs_hrrr` param. Higher resolution than the
 * default GFS blend for short-range wind — the wind term in the
 * scoring model wants time-of-play accuracy, not day-averages.
 *
 * Returns an hourly map for the requested date at the requested
 * lat/lon. Callers pass a target hour and pick the wind at that
 * hour for each remaining hole.
 *
 * Server-only — extends the existing open-meteo.ts pattern with a
 * separate cache so HRRR-specific queries don't collide with the
 * daily-forecast cache used by weather headlines.
 */

import "server-only";

export interface HourlyWind {
  /** Local hour (0-23) in the venue timezone. */
  hour: number;
  /** Wind speed in mph. */
  windMph: number;
  /** Wind FROM direction, degrees (0-360). */
  windDirDeg: number;
}

interface CacheEntry {
  ts: number;
  data: HourlyWind[];
}
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — HRRR refreshes hourly
const cache = new Map<string, CacheEntry>();

interface OpenMeteoHrrrResp {
  hourly?: {
    time?: string[];
    wind_speed_10m?: (number | null)[];
    wind_direction_10m?: (number | null)[];
  };
}

/** Fetch HRRR-model hourly wind for a single date at the given
 *  coords. Returns [] on error so callers can fall back gracefully. */
export async function getHrrrHourlyWind(
  lat: number,
  lon: number,
  date: string,
  timezone: string = "auto",
): Promise<HourlyWind[]> {
  const cacheKey = `${lat},${lon},${date},${timezone}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;

  // Open-Meteo rejects requests that combine start_date/end_date with
  // past_days ("mutually exclusive"). The start_date/end_date already
  // pins the exact window we want; past_days isn't needed and 400s
  // the request silently, causing every wind lookup to fall back to 0.
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=mph` +
    `&start_date=${date}&end_date=${date}` +
    `&timezone=${encodeURIComponent(timezone)}` +
    `&models=gfs_hrrr`;

  let payload: OpenMeteoHrrrResp | null = null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[hrrr] ${res.status}: ${url}`);
      cache.set(cacheKey, { ts: now, data: [] });
      return [];
    }
    payload = (await res.json()) as OpenMeteoHrrrResp;
  } catch (err) {
    console.warn(`[hrrr] fetch failed`, err);
    cache.set(cacheKey, { ts: now, data: [] });
    return [];
  }

  const h = payload?.hourly;
  if (!h?.time) {
    cache.set(cacheKey, { ts: now, data: [] });
    return [];
  }
  const out: HourlyWind[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    if (!t.startsWith(date)) continue;
    const hour = parseInt(t.slice(11, 13), 10);
    const spd = h.wind_speed_10m?.[i];
    const dir = h.wind_direction_10m?.[i];
    if (
      !Number.isFinite(hour) ||
      typeof spd !== "number" ||
      typeof dir !== "number"
    ) {
      continue;
    }
    out.push({ hour, windMph: spd, windDirDeg: dir });
  }
  out.sort((a, b) => a.hour - b.hour);
  cache.set(cacheKey, { ts: now, data: out });
  return out;
}

/** Aggregate an hourly wind series into a single vector-averaged
 *  daily wind reading — the same shape a daily forecast would ship
 *  (windAvgMph + windDirDeg). Averaging only over the play window
 *  (default 7 AM - 7 PM local) keeps overnight calm periods from
 *  diluting the round's effective wind. */
export function summariseHrrrDay(
  hourly: HourlyWind[],
  playWindow: { fromHour: number; toHour: number } = {
    fromHour: 7,
    toHour: 19,
  },
): { windMph: number; windDirDeg: number } | null {
  const inWindow = hourly.filter(
    (h) => h.hour >= playWindow.fromHour && h.hour <= playWindow.toHour,
  );
  if (inWindow.length === 0) return null;
  let uSum = 0;
  let vSum = 0;
  for (const h of inWindow) {
    const rad = (h.windDirDeg * Math.PI) / 180;
    uSum += h.windMph * Math.cos(rad);
    vSum += h.windMph * Math.sin(rad);
  }
  const u = uSum / inWindow.length;
  const v = vSum / inWindow.length;
  return {
    windMph: Math.hypot(u, v),
    windDirDeg: ((Math.atan2(v, u) * 180) / Math.PI + 360) % 360,
  };
}

/** Given an hourly wind series and a target hour (may be fractional,
 *  e.g. 13.5 for 1:30 PM), return the interpolated wind at that hour.
 *  Clamps to the series' available bounds — a target before the first
 *  hour returns the first hour's reading; after the last, the last.
 *  Returns null if the series is empty. */
export function windAtHour(
  hourly: HourlyWind[],
  targetHour: number,
): { windMph: number; windDirDeg: number } | null {
  if (hourly.length === 0) return null;
  const first = hourly[0];
  const last = hourly[hourly.length - 1];
  if (targetHour <= first.hour) {
    return { windMph: first.windMph, windDirDeg: first.windDirDeg };
  }
  if (targetHour >= last.hour) {
    return { windMph: last.windMph, windDirDeg: last.windDirDeg };
  }
  // Find bracketing entries within the series.
  let lower = hourly[0];
  let upper = hourly[hourly.length - 1];
  for (let i = 0; i < hourly.length - 1; i++) {
    if (hourly[i].hour <= targetHour && hourly[i + 1].hour > targetHour) {
      lower = hourly[i];
      upper = hourly[i + 1];
      break;
    }
  }
  const span = upper.hour - lower.hour;
  const frac = span === 0 ? 0 : (targetHour - lower.hour) / span;
  // Interpolate speed linearly; direction via vector components.
  const ax = lower.windMph * Math.cos((lower.windDirDeg * Math.PI) / 180);
  const ay = lower.windMph * Math.sin((lower.windDirDeg * Math.PI) / 180);
  const bx = upper.windMph * Math.cos((upper.windDirDeg * Math.PI) / 180);
  const by = upper.windMph * Math.sin((upper.windDirDeg * Math.PI) / 180);
  const u = ax + (bx - ax) * frac;
  const v = ay + (by - ay) * frac;
  const windMph = Math.hypot(u, v);
  const windDirDeg = ((Math.atan2(v, u) * 180) / Math.PI + 360) % 360;
  return { windMph, windDirDeg };
}
