/**
 * Server-side loader for per-hole scoring averages. Reads Pardle's
 * live snapshot (current + previous rounds) plus the historical JSON
 * dump for the previous year's edition, then hands everything to the
 * pure computeHoleAverages helper.
 *
 * Isolated in its own module so it can be reused by:
 *   - /api/analysis/tee-time-scoring (server-side projection)
 *   - The feed engine's snap bake (client-side round-score bet projection)
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PollSnapshot } from "./feed/store";
import {
  computeHoleAverages,
  type HoleAverages,
  type HoleAverageDiag,
  type HoleScoreSamples,
} from "./hole-averages";
import { getScoringModel } from "./scoring-model/loader";
import { projectHoleAvgToPar } from "./scoring-model/project";
import { getHoleBearings } from "./scoring-model/hole-bearings";
import type { TodayConditions } from "./scoring-model/types";

/** Extract per-hole raw strokes samples from a Pardle snapshot for a
 *  specific round. Returns an empty object when the snapshot has no
 *  data for that round yet. */
export function samplesFromSnapshot(
  snapshot: PollSnapshot | null,
  round: number,
): HoleScoreSamples {
  const out: HoleScoreSamples = {};
  if (!snapshot?.holes) return out;
  for (const [, byRound] of Object.entries(snapshot.holes)) {
    const holes = byRound?.[round];
    if (!holes) continue;
    for (const [holeStr, scoreStr] of Object.entries(holes)) {
      const s = Number(scoreStr);
      if (!Number.isFinite(s) || s <= 0) continue;
      const h = Number(holeStr);
      if (!Number.isFinite(h) || h < 1 || h > 18) continue;
      (out[h] ??= []).push(s);
    }
  }
  return out;
}

/** Shape of the historical JSON files under /data/historical/. */
interface HistoricalPlayer {
  rounds?: Record<
    string,
    {
      holes?: Record<string, { strokes?: number; par?: number }>;
    }
  >;
}
interface HistoricalDump {
  year: number;
  dgEventId?: number | string;
  pgaTournamentId?: string;
  players?: HistoricalPlayer[];
}

let historicalManifest:
  | { events: Map<string, string[]> } // event-id → sorted file paths
  | null = null;

/** Build (or return cached) manifest of {eventId → [file paths]} from
 *  /data/historical. Files are sorted newest-first so we can pull the
 *  most-recent prior year without scanning. */
async function buildManifest(): Promise<Map<string, string[]>> {
  if (historicalManifest) return historicalManifest.events;
  const dir = path.join(process.cwd(), "data", "historical");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    historicalManifest = { events: new Map() };
    return historicalManifest.events;
  }
  const byEvent = new Map<string, string[]>();
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    // File name pattern: `<slug>-<year>.json`. We don't infer the
    // event id from the filename — we open the JSON and read dgEventId.
    const full = path.join(dir, name);
    try {
      const buf = await fs.readFile(full, "utf-8");
      const j = JSON.parse(buf) as HistoricalDump;
      const key = j.dgEventId != null ? String(j.dgEventId) : null;
      if (!key) continue;
      const list = byEvent.get(key) ?? [];
      list.push(full);
      byEvent.set(key, list);
    } catch {
      /* skip malformed file */
    }
  }
  // Sort each list by embedded year, newest-first.
  for (const [key, list] of byEvent) {
    list.sort((a, b) => {
      const ya = Number(a.match(/(\d{4})\.json$/)?.[1] ?? 0);
      const yb = Number(b.match(/(\d{4})\.json$/)?.[1] ?? 0);
      return yb - ya;
    });
    byEvent.set(key, list);
  }
  historicalManifest = { events: byEvent };
  return byEvent;
}

/** Extract the DG event-id from a Pardle/orchestrator tournament id.
 *  R2026525 → "525", R2024541 → "541". The event id is stable across
 *  years so historical lookups can use it as the join key. */
export function dgEventIdFromTournamentId(
  tournamentId: string,
): string | null {
  const m = tournamentId.match(/^R\d{4}(\d+)$/);
  return m ? m[1] : null;
}

/** Merge per-hole samples across ALL rounds of a historical dump.
 *  Fallback #3 is course-difficulty over the previous year, not a
 *  specific round — the more samples the merge has, the more stable
 *  its per-hole average. */
function samplesFromHistorical(dump: HistoricalDump): HoleScoreSamples {
  const out: HoleScoreSamples = {};
  const players = dump.players ?? [];
  for (const p of players) {
    const rounds = p.rounds ?? {};
    for (const rObj of Object.values(rounds)) {
      const holes = rObj.holes ?? {};
      for (const [holeStr, entry] of Object.entries(holes)) {
        const s = Number(entry?.strokes);
        if (!Number.isFinite(s) || s <= 0) continue;
        const h = Number(holeStr);
        if (!Number.isFinite(h) || h < 1 || h > 18) continue;
        (out[h] ??= []).push(s);
      }
    }
  }
  return out;
}

/** Today's per-hole setup used by the scoring-model layer. */
export interface TodaySetupPerHole {
  /** Yardage today per hole (from the pin sheet). */
  yardsByHole: Record<number, number>;
  /** Pin coord today per hole, if known. Missing pins → no cluster
   *  adjustment for that hole. */
  pinByHole?: Record<number, { x: number; y: number }>;
  /** Today's headline wind (single average — used for holes when the
   *  per-player HRRR path isn't in play). */
  wind: { windMph: number; windDirDeg: number };
}

/**
 * Load per-hole averages for `round` of `tournamentId`, applying the
 * live-first fallback chain (current round → previous round → previous
 * year → par). All I/O + fallback logic lives here so callers just
 * take the resulting HoleAverages / diag map.
 *
 * When `todaySetup` + `originUrl` are provided AND we can fit the
 * scoring model, the loader upgrades to:
 *   - Pure MODEL prediction when the live current-round sample is thin
 *   - Blend of MODEL + live sample as the sample grows
 *   - Falls back to the old chain when the model can't fit (missing
 *     coefficients, missing bearings, or fetch errors)
 */
export async function loadHoleAveragesForRound(input: {
  tournamentId: string;
  round: number;
  snapshot: PollSnapshot | null;
  holePars: Record<number, number>;
  /** Optional — enables the scoring-model path. When absent the loader
   *  falls back to the pre-model chain. */
  todaySetup?: TodaySetupPerHole;
  /** Absolute base URL for internal fetches (e.g. to the birdies API).
   *  Required when `todaySetup` is provided. */
  originUrl?: string;
}): Promise<{
  averages: HoleAverages;
  diag: Record<number, HoleAverageDiag>;
}> {
  const { tournamentId, round, snapshot, holePars, todaySetup, originUrl } =
    input;
  const currentRound = samplesFromSnapshot(snapshot, round);
  const prevRound =
    round > 1 ? samplesFromSnapshot(snapshot, round - 1) : null;

  let prevYear: HoleScoreSamples | null = null;
  const eventId = dgEventIdFromTournamentId(tournamentId);
  if (eventId) {
    try {
      const manifest = await buildManifest();
      const files = manifest.get(eventId) ?? [];
      // Skip the current year's file if it happens to be in there
      // (the historical dump is written after the event completes).
      const currentYear = Number(tournamentId.slice(1, 5));
      for (const f of files) {
        const y = Number(f.match(/(\d{4})\.json$/)?.[1] ?? 0);
        if (y === currentYear) continue;
        try {
          const buf = await fs.readFile(f, "utf-8");
          const j = JSON.parse(buf) as HistoricalDump;
          prevYear = samplesFromHistorical(j);
          if (Object.keys(prevYear).length > 0) break;
        } catch {
          /* skip */
        }
      }
    } catch {
      /* swallow — falls through to par */
    }
  }

  const legacy = computeHoleAverages({
    currentRound,
    prevRound,
    prevYear,
    holePars,
  });

  // If the model path is available, layer it on top. The model gets
  // wind + pin + yardage right for today; the legacy chain is left in
  // place as the fallback for any hole the model can't fit.
  if (!todaySetup || !originUrl) return legacy;

  const bearings = getHoleBearings(tournamentId);
  if (!bearings) return legacy;

  let coeffs;
  try {
    coeffs = await getScoringModel(tournamentId, originUrl);
  } catch {
    coeffs = null;
  }
  if (!coeffs) return legacy;

  const averages: HoleAverages = { ...legacy.averages };
  const diag: Record<number, HoleAverageDiag> = { ...legacy.diag };
  for (let h = 1; h <= 18; h++) {
    const fit = coeffs.holes[h];
    const bearing = bearings[h];
    const yards = todaySetup.yardsByHole[h];
    if (!fit || typeof bearing !== "number" || typeof yards !== "number") {
      // Keep the legacy result for this hole.
      continue;
    }
    const pin = todaySetup.pinByHole?.[h];
    // Build per-hole live sample from the current-round samples.
    const par = holePars[h];
    const samples = currentRound[h] ?? [];
    const validSamples = samples.filter((s) => Number.isFinite(s) && s > 0);
    const liveSample =
      validSamples.length > 0 && typeof par === "number"
        ? {
            avgVsPar:
              validSamples.reduce((a, b) => a + b, 0) / validSamples.length -
              par,
            count: validSamples.length,
          }
        : null;
    const conditions: TodayConditions = {
      yards,
      windSpeed: todaySetup.wind.windMph,
      windDir: todaySetup.wind.windDirDeg,
      pinX: pin?.x,
      pinY: pin?.y,
    };
    const proj = projectHoleAvgToPar({
      fit,
      bearing,
      conditions,
      liveSample,
    });
    averages[h] = proj.avgVsPar;
    diag[h] = {
      toPar: proj.avgVsPar,
      source: proj.liveWeight > 0 ? "model-blend" : "model",
      sampleCount: liveSample?.count ?? 0,
    };
  }
  return { averages, diag };
}
