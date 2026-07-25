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
  /** Authoritative live per-hole scoring-vs-par from the orchestrator's
   *  courseStats (or Pardle's pin-sheet scoringByRound). When present
   *  this OVERRIDES the snapshot-derived live sample — the snapshot
   *  only carries currently-active players' data, so once R3
   *  finishers have completed the back-9 their scores drop out of the
   *  snapshot but courseStats still knows the true field average.
   *  Value is vs-par (negative = under par). */
  liveVsParByHole?: Record<number, number>;
}

/** Per-round setup for a prior round used by the level-shift calc.
 *  Same shape as TodaySetupPerHole. */
export type PriorRoundSetup = TodaySetupPerHole;

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
  /** Optional — prior-round setups for the current tournament, keyed
   *  by round number. Used to compute the "this week is playing
   *  softer/harder than the model expects" level shift from finished
   *  R1/R2 data. Ignored when absent. */
  priorRoundsSetup?: Partial<Record<1 | 2 | 3 | 4, PriorRoundSetup>>;
  /** Per-round hole pars — needed to convert prior-round strokes into
   *  vs-par residuals. Falls back to `holePars` for every round when
   *  absent. */
  priorHolePars?: Partial<Record<1 | 2 | 3 | 4, Record<number, number>>>;
  /** Absolute base URL for internal fetches (e.g. to the birdies API).
   *  Required when `todaySetup` is provided. */
  originUrl?: string;
}): Promise<{
  averages: HoleAverages;
  diag: Record<number, HoleAverageDiag>;
  /** Per-hole level shift applied to model predictions (0 when the
   *  level-shift path wasn't taken). Exposed for diagnostics. */
  levelShift?: number;
}> {
  const {
    tournamentId,
    round,
    snapshot,
    holePars,
    todaySetup,
    priorRoundsSetup,
    priorHolePars,
    originUrl,
  } = input;
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

  // Compute the "this week is playing softer/harder than the model
  // expects" level shift from any finished prior rounds of this
  // tournament. For each finished round r < currentRound, compare
  // the field's actual per-hole avg-vs-par to what the model
  // (round-specific baseline + today-style pin/yards/wind) would
  // have predicted. Average per-hole residual across finished rounds
  // becomes the level shift applied to each hole's projection.
  let levelShift = 0;
  if (priorRoundsSetup) {
    const residualsPerRound: number[] = [];
    for (let r = 1; r < round; r++) {
      const rk = r as 1 | 2 | 3 | 4;
      const setup = priorRoundsSetup[rk];
      if (!setup) continue;
      const pars = priorHolePars?.[rk] ?? holePars;
      const samples = samplesFromSnapshot(snapshot, r);
      // Confirm the round has meaningful data — skip an in-progress
      // round so we don't level-shift off a half-played round.
      let sampleTotal = 0;
      for (const arr of Object.values(samples)) sampleTotal += arr.length;
      if (sampleTotal < 500) continue;
      let sumResidualsPerHole = 0;
      let holesCounted = 0;
      for (let h = 1; h <= 18; h++) {
        const fit = coeffs.holes[h];
        const bearing = bearings[h];
        const yards = setup.yardsByHole[h];
        const par = pars[h];
        if (
          !fit ||
          typeof bearing !== "number" ||
          typeof yards !== "number" ||
          typeof par !== "number"
        )
          continue;
        const holeSamples = samples[h] ?? [];
        const validSamples = holeSamples.filter(
          (s) => Number.isFinite(s) && s > 0,
        );
        if (validSamples.length < 10) continue;
        const actualAvg =
          validSamples.reduce((a, b) => a + b, 0) / validSamples.length - par;
        const pin = setup.pinByHole?.[h];
        const proj = projectHoleAvgToPar({
          fit,
          bearing,
          conditions: {
            yards,
            windSpeed: setup.wind.windMph,
            windDir: setup.wind.windDirDeg,
            pinX: pin?.x,
            pinY: pin?.y,
          },
          roundNum: rk,
        });
        sumResidualsPerHole += actualAvg - proj.modelAvgVsPar;
        holesCounted += 1;
      }
      if (holesCounted >= 15) {
        residualsPerRound.push(sumResidualsPerHole / holesCounted);
      }
    }
    if (residualsPerRound.length > 0) {
      levelShift =
        residualsPerRound.reduce((a, b) => a + b, 0) / residualsPerRound.length;
    }
  }

  const averages: HoleAverages = { ...legacy.averages };
  const diag: Record<number, HoleAverageDiag> = { ...legacy.diag };
  const roundNum =
    round === 1 || round === 2 || round === 3 || round === 4
      ? (round as 1 | 2 | 3 | 4)
      : undefined;
  for (let h = 1; h <= 18; h++) {
    const fit = coeffs.holes[h];
    const bearing = bearings[h];
    const yards = todaySetup.yardsByHole[h];
    if (!fit || typeof bearing !== "number" || typeof yards !== "number") {
      // Keep the legacy result for this hole.
      continue;
    }
    const pin = todaySetup.pinByHole?.[h];
    // Live sample source priority:
    //   1. todaySetup.liveVsParByHole (authoritative field avg from
    //      the pin sheet's scoringByRound) — treated as a fully-
    //      populated sample (weight → 1) since it aggregates over the
    //      entire field including finished players.
    //   2. currentRound samples from the snapshot — decays because
    //      finished players get dropped from the active poll set.
    const par = holePars[h];
    let liveSample: { avgVsPar: number; count: number } | null = null;
    const authoritativeLive = todaySetup.liveVsParByHole?.[h];
    if (typeof authoritativeLive === "number") {
      liveSample = { avgVsPar: authoritativeLive, count: 30 };
    } else {
      const samples = currentRound[h] ?? [];
      const validSamples = samples.filter((s) => Number.isFinite(s) && s > 0);
      if (validSamples.length > 0 && typeof par === "number") {
        liveSample = {
          avgVsPar:
            validSamples.reduce((a, b) => a + b, 0) / validSamples.length -
            par,
          count: validSamples.length,
        };
      }
    }
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
      roundNum,
      levelShift,
    });
    averages[h] = proj.avgVsPar;
    diag[h] = {
      toPar: proj.avgVsPar,
      source: proj.liveWeight > 0 ? "model-blend" : "model",
      sampleCount: liveSample?.count ?? 0,
    };
  }
  return { averages, diag, levelShift };
}
