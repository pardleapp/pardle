/**
 * Server-only loader that fits scoring-model coefficients from:
 *   - Historical event files on disk (data/historical/*.json) —
 *     weather + per-round yardages + per-player scores.
 *   - Current-tournament birdies aggregate (per-pin scoring) fetched
 *     from the internal /api/course-pin-birdies endpoint.
 *
 * Fits per-hole WLS coefficients once per (tournament, day) and
 * caches. The cache is memory-only per Node process — Next.js
 * fetches will re-fit on cold start, but the fit runs in milliseconds
 * once the birdies payload is in hand.
 */

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assembleHoleFit } from "./coefficients";
import { getHoleBearings } from "./hole-bearings";
import type {
  FitRow,
  HoleFit,
  ScoringModelCoefficients,
} from "./types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — historical data is static day-to-day
const cache = new Map<string, { ts: number; data: ScoringModelCoefficients }>();

interface HistoricalHole {
  yards?: number;
  score?: number;
}
interface HistoricalRound {
  score?: number;
  coursePar?: number;
  holes?: Record<string, HistoricalHole>;
}
interface HistoricalPlayer {
  rounds?: Record<string, HistoricalRound>;
}
interface HistoricalWeather {
  windAvgMph?: number | null;
  windDirDeg?: number | null;
}
interface HistoricalEvent {
  year?: number;
  tournamentId?: string;
  players?: HistoricalPlayer[];
  weatherByRound?: Record<string, HistoricalWeather>;
}

/** Load one historical event file. Returns null if missing. */
async function loadHistorical(
  eventCode: string,
  year: number,
): Promise<HistoricalEvent | null> {
  const p = path.join(
    process.cwd(),
    "data",
    "historical",
    `${eventCode}-${year}.json`,
  );
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as HistoricalEvent;
  } catch {
    return null;
  }
}

/** Per (year, round) key → { wind, wind_dir, yards_by_hole } context. */
interface RoundContext {
  wind: number;
  windDirDeg: number;
  yardsByHole: Record<number, number>;
}

function buildHistoricalContext(
  events: HistoricalEvent[],
): {
  ctx: Record<string, RoundContext>;
  yardsMeanByHole: Record<number, number>;
  headMeanByHole: Record<number, number>;
} {
  const ctx: Record<string, RoundContext> = {};
  const yardsAccum: Record<number, number[]> = {};
  const headAccum: Record<number, number[]> = {};
  const bearings = getHoleBearings("R2026525") ?? {};

  for (const ev of events) {
    const y = ev.year;
    const weather = ev.weatherByRound ?? {};
    if (typeof y !== "number") continue;
    // Aggregate per-round yardage per hole (mean across players).
    const yardsByRound: Record<number, Record<number, number[]>> = {};
    for (const pl of ev.players ?? []) {
      for (const [rStr, rd] of Object.entries(pl.rounds ?? {})) {
        const r = Number(rStr);
        for (const [hStr, hole] of Object.entries(rd.holes ?? {})) {
          if (typeof hole?.yards !== "number") continue;
          (yardsByRound[r] ??= {});
          (yardsByRound[r][Number(hStr)] ??= []).push(hole.yards);
        }
      }
    }
    for (const r of [1, 2, 3, 4]) {
      const wr = weather[String(r)];
      if (!wr || wr.windAvgMph == null || wr.windDirDeg == null) continue;
      const yh = yardsByRound[r] ?? {};
      const perHole: Record<number, number> = {};
      for (const [h, arr] of Object.entries(yh)) {
        const sum = arr.reduce((a, b) => a + b, 0);
        perHole[Number(h)] = sum / arr.length;
      }
      ctx[`${y}:${r}`] = {
        wind: wr.windAvgMph,
        windDirDeg: wr.windDirDeg,
        yardsByHole: perHole,
      };
      // Contribute to per-hole running means
      for (const [h, yv] of Object.entries(perHole)) {
        const hole = Number(h);
        const bearing = bearings[hole];
        if (typeof bearing !== "number") continue;
        const head =
          wr.windAvgMph *
          Math.cos(((wr.windDirDeg - bearing) * Math.PI) / 180);
        (yardsAccum[hole] ??= []).push(yv);
        (headAccum[hole] ??= []).push(head);
      }
    }
  }
  const yardsMean: Record<number, number> = {};
  const headMean: Record<number, number> = {};
  for (const [h, arr] of Object.entries(yardsAccum)) {
    yardsMean[Number(h)] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  for (const [h, arr] of Object.entries(headAccum)) {
    headMean[Number(h)] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  return { ctx, yardsMeanByHole: yardsMean, headMeanByHole: headMean };
}

/** Shape of the birdies API response we need. Only fields we read
 *  are typed — the response has many more. */
interface BirdiesPin {
  year: number;
  round: number;
  x: number;
  y: number;
  avgVsPar: number;
  total: number;
}
interface BirdiesCluster {
  memberIndices: number[];
}
interface BirdiesHole {
  holeNumber: number;
  pins: BirdiesPin[];
  clusters: BirdiesCluster[];
}
interface BirdiesResponse {
  ok?: boolean;
  holes?: BirdiesHole[];
}

/** Fetch birdies aggregate from the internal API. `originUrl` should
 *  be an absolute URL callable from the server-side runtime (Vercel:
 *  process.env.VERCEL_URL; local: infer from request or fallback). */
async function fetchBirdies(
  tournamentId: string,
  originUrl: string,
): Promise<BirdiesResponse | null> {
  const url = `${originUrl.replace(/\/$/, "")}/api/course-pin-birdies?tournamentId=${encodeURIComponent(tournamentId)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[scoring-model loader] birdies fetch ${res.status}`);
      return null;
    }
    return (await res.json()) as BirdiesResponse;
  } catch (err) {
    console.warn(`[scoring-model loader] birdies fetch failed`, err);
    return null;
  }
}

/** Mapping of tournament id → event-code prefix for historical files. */
const EVENT_CODE_BY_TOURNAMENT: Record<string, { code: string; years: number[] }> = {
  R2023525: { code: "3m-open", years: [2019, 2020, 2021, 2022, 2023, 2024, 2025] },
  R2024525: { code: "3m-open", years: [2019, 2020, 2021, 2022, 2023, 2024, 2025] },
  R2025525: { code: "3m-open", years: [2019, 2020, 2021, 2022, 2023, 2024, 2025] },
  R2026525: { code: "3m-open", years: [2019, 2020, 2021, 2022, 2023, 2024, 2025] },
};

/** Load + fit + cache scoring-model coefficients for a tournament.
 *  Returns null when we can't get the birdies data or don't have a
 *  hole-bearing table for the venue. */
export async function getScoringModel(
  tournamentId: string,
  originUrl: string,
): Promise<ScoringModelCoefficients | null> {
  const cached = cache.get(tournamentId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const bearings = getHoleBearings(tournamentId);
  if (!bearings) return null;

  const eventCfg = EVENT_CODE_BY_TOURNAMENT[tournamentId];
  if (!eventCfg) return null;

  // Load historical events in parallel.
  const events = (
    await Promise.all(
      eventCfg.years.map((y) => loadHistorical(eventCfg.code, y)),
    )
  ).filter((e): e is HistoricalEvent => e != null);

  if (events.length === 0) return null;

  const { ctx } = buildHistoricalContext(events);

  // Fetch birdies aggregate — the per-pin, per-cluster data we fit against.
  const birdies = await fetchBirdies(tournamentId, originUrl);
  const holes = birdies?.holes ?? [];
  if (holes.length === 0) return null;

  const perHoleFit: Record<number, HoleFit | null> = {};
  for (let h = 1; h <= 18; h++) {
    const hData = holes.find((x) => x.holeNumber === h);
    if (!hData) {
      perHoleFit[h] = null;
      continue;
    }
    const bearing = bearings[h];
    if (typeof bearing !== "number") {
      perHoleFit[h] = null;
      continue;
    }
    const rows: FitRow[] = [];
    const centroidAccum: Record<string, { x: number; y: number; n: number }> = {};
    for (let ci = 0; ci < (hData.clusters ?? []).length; ci++) {
      const letter = String.fromCharCode(65 + ci);
      const cluster = hData.clusters[ci];
      for (const mi of cluster.memberIndices ?? []) {
        const pin = hData.pins[mi];
        if (!pin) continue;
        // Centroid contribution — always add, even if we can't fit
        // the row (some pins are from the current event without
        // matching historical context).
        if (typeof pin.x === "number" && typeof pin.y === "number") {
          const c = (centroidAccum[letter] ??= { x: 0, y: 0, n: 0 });
          c.x += pin.x;
          c.y += pin.y;
          c.n += 1;
        }
        const context = ctx[`${pin.year}:${pin.round}`];
        if (!context) continue;
        const yards = context.yardsByHole[h];
        if (typeof yards !== "number") continue;
        const head =
          context.wind *
          Math.cos(((context.windDirDeg - bearing) * Math.PI) / 180);
        rows.push({
          clusterIdx: ci,
          yards,
          headwind: head,
          avgVsPar: pin.avgVsPar,
          total: pin.total,
        });
      }
    }
    const clusterCentroids: Record<string, { x: number; y: number }> = {};
    for (const [letter, c] of Object.entries(centroidAccum)) {
      clusterCentroids[letter] = { x: c.x / c.n, y: c.y / c.n };
    }
    perHoleFit[h] = assembleHoleFit(rows, clusterCentroids);
  }

  const coeffs: ScoringModelCoefficients = {
    tournamentId,
    fittedAt: new Date().toISOString(),
    holes: perHoleFit,
  };
  cache.set(tournamentId, { ts: Date.now(), data: coeffs });
  return coeffs;
}

/** Read the per-hole bearings table for a tournament — surfaces the
 *  hole-bearings module through the loader so callers only need one
 *  import. */
export function getBearingsForTournament(
  tournamentId: string,
): Record<number, number> | null {
  return getHoleBearings(tournamentId);
}
