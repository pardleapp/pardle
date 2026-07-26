/**
 * Public forecast entry point: takes flexible user inputs, produces a
 * field score forecast + optional per-player projections. This is
 * what the /analysis/score-forecast tool calls under the hood — every
 * knob a bettor might want to twiddle is exposed as a typed option.
 *
 * The heavy lifting (coefficient fit, projection, level shift) lives
 * in project.ts / loader.ts / hole-averages-loader.ts. This module
 * assembles the pieces, applies form adjustment, and emits a
 * consumer-friendly response.
 */

import "server-only";
import { projectHoleAvgToPar } from "./project";
import { getScoringModel } from "./loader";
import { getHoleBearings } from "./hole-bearings";
import {
  getHrrrHourlyWind,
  summariseHrrrDay,
} from "./hrrr-hourly";
import { coordsForTournamentId } from "@/lib/weather/course-coords";
import { getDailyWeather } from "@/lib/weather/open-meteo";
import type {
  HoleFit,
  ScoringModelCoefficients,
  TodayConditions,
} from "./types";
import type { LevelShiftMode } from "@/lib/hole-averages-loader";

/** Historical round-mean baselines per tournament. Used when the
 *  target round has enough per-round fit rows to be trustworthy; the
 *  fit itself carries HoleFit.histMeanAvgVsParByRound[round]. These
 *  event-level totals are what UI callers see as "typical R3 avg". */
const HISTORICAL_ROUND_MEANS: Record<
  string,
  Partial<Record<1 | 2 | 3 | 4, number>>
> = {
  R2026525: { 1: 70.51, 2: 71.22, 3: 69.18, 4: 69.5 },
};

/** Per-round hole pars for the fitted courses — needed to convert
 *  the model's avg-vs-par output into an absolute score. */
const COURSE_HOLE_PARS: Record<string, Record<number, number>> = {
  R2026525: {
    1: 4, 2: 4, 3: 4, 4: 3, 5: 4, 6: 5, 7: 4, 8: 3, 9: 4,
    10: 4, 11: 4, 12: 5, 13: 3, 14: 4, 15: 4, 16: 4, 17: 3, 18: 5,
  },
};

const COURSE_PAR: Record<string, number> = { R2026525: 71 };

/** Per-hole override supplied by the user — everything is optional so
 *  callers can override only what they know. */
export interface HoleOverride {
  /** Cluster letter (A, B, C, …). When present, cluster residual is
   *  read directly from the fit's clusterResiduals[letter] instead
   *  of auto-matching from pin coords. */
  cluster?: string;
  /** Hole yardage today. Falls back to fit's histMeanYards or the
   *  round's historical mean when omitted. */
  yards?: number;
}

/** Prior-round observed field scoring — feeds the level-shift term.
 *  When callers supply this, we skip re-fetching it and trust their
 *  values (useful when running "what-if" scenarios). */
export interface PriorRoundObservation {
  /** Field avg vs par per hole for that round. */
  vsParByHole: Record<number, number>;
  /** Setup at play for that round (yards + pin cluster + wind). */
  setup: {
    yardsByHole: Record<number, number>;
    clusterByHole?: Record<number, string>;
    wind: { windMph: number; windDirDeg: number };
  };
}

/** Per-player skill + form knobs. */
export interface PlayerInput {
  /** Display name — echoed back in the response. */
  name: string;
  /** Season-long SG total vs full field (positive = better than field
   *  average per round). */
  sgTotal: number;
  /** Compression factor applied to sgTotal at this course. 1.0 = no
   *  compression, 0.83 = 17% shrink (typical at bunching-friendly
   *  venues). */
  compressionFactor?: number;
  /** Mean-median gap for this player's personal round distribution.
   *  Elite (~0.15-0.2), mid-tier (~0.25), below-avg (~0.3). Default
   *  auto-picks by sgTotal band. */
  skewAdjustment?: number;
  /** This week's per-round scores-vs-par so far. Feeds the Bayesian
   *  form adjustment. */
  weekRounds?: number[];
  /** Weight on the form component (0 = ignore recent, 1 = fully lean
   *  in). Default 0.20 per Connolly-Rendleman-style shrinkage. */
  formWeight?: number;
}

export interface ForecastInputs {
  tournamentId: string;
  /** Round to forecast, 1-4. */
  targetRound: 1 | 2 | 3 | 4;
  /** Absolute origin URL for internal fetches (birdies API). */
  originUrl: string;
  /** Per-hole overrides — cluster letter + yardage. */
  holes?: Record<number, HoleOverride>;
  /** Flat stroke adder for "pins are harder/easier than model
   *  expects". Applied to the field forecast total. */
  pinDifficultyAdder?: number;
  /** Wind override — user-specified value used instead of HRRR. */
  windOverride?: { windMph: number; windDirDeg: number };
  /** Use HRRR for the target-round wind when no windOverride. Default true. */
  useHrrr?: boolean;
  /** How to blend prior-round residuals into the level shift. Default
   *  "most-recent-post-cut" for R3+, else "average". */
  levelShiftMode?: LevelShiftMode;
  /** Attenuation multiplier applied to the derived level shift.
   *  0 = ignore level shift, 1 = full carry, 0.5 = half-carry.
   *  Useful when callers think overnight drying will attenuate
   *  softness. Default 1.0. */
  levelShiftAttenuation?: number;
  /** Prior-round observations (R1/R2/R3 as applicable). When
   *  omitted the API tries to fetch from courseStats — but callers
   *  can supply these for what-if runs. */
  priorRounds?: Partial<Record<1 | 2 | 3 | 4, PriorRoundObservation>>;
  /** Players to project. Empty = field-only forecast. */
  players?: PlayerInput[];
}

export interface HoleForecast {
  hole: number;
  par: number;
  yards: number;
  cluster: string | null;
  windMph: number;
  windDirDeg: number;
  headwind: number;
  avgVsPar: number;
  clusterResidual: number;
  windDelta: number;
  yardsDelta: number;
}

export interface PlayerForecast {
  name: string;
  sgTotal: number;
  sgTotalAdjusted: number; // after compression + form
  formAdjustment: number;  // strokes/round bump from Bayesian shrinkage
  expectedMean: number;
  expectedMedian: number;
  breakdown: {
    fieldMean: number;
    compressedEdge: number;
    formBump: number;
    skewGap: number;
  };
}

export interface ForecastResponse {
  ok: true;
  tournamentId: string;
  targetRound: 1 | 2 | 3 | 4;
  par: number;
  wind: { windMph: number; windDirDeg: number; source: string };
  historicalRoundMean: number | null;
  levelShift: number;
  levelShiftAttenuated: number;
  levelShiftMode: LevelShiftMode;
  levelShiftPerRound: Partial<Record<1 | 2 | 3 | 4, number>>;
  pinDifficultyAdder: number;
  modelDelta: number;
  fieldForecast: number;
  fieldForecastVsPar: number;
  holes: HoleForecast[];
  players: PlayerForecast[];
  warnings: string[];
}

// ── Helpers ────────────────────────────────────────────────────────

function autoSkew(sgTotal: number): number {
  // Empirical range: elite (SG ≥ 1.5) ~0.20; mid (0.0–1.5) ~0.25;
  // below-avg (< 0.0) ~0.30. Bigger gap for worse players due to
  // heavier blow-up right tail.
  if (sgTotal >= 1.5) return 0.2;
  if (sgTotal >= 0) return 0.25;
  return 0.3;
}

/** Bayesian shrinkage of "this week's rounds" toward the season
 *  baseline. weekAvgVsFieldBaseline = mean of the player's rounds
 *  vs the FIELD-adjusted baseline they should have shot. */
function bayesianFormBump(
  weekRounds: number[] | undefined,
  sgTotal: number,
  weight: number,
): number {
  if (!weekRounds || weekRounds.length === 0) return 0;
  // Weekly average vs par
  const meanVsPar = weekRounds.reduce((a, b) => a + b, 0) / weekRounds.length;
  // Expected weekly avg per baseline: 0 - sgTotal (SG positive means
  // shoots below par → expected vs par is negative). We're rough
  // here — course softness this week (level shift) is already
  // applied to the field, so we compare to that.
  const expectedVsPar = -sgTotal;
  const overPerformance = meanVsPar - expectedVsPar; // negative = over-performing
  return weight * overPerformance;
}

// ── Main entry ─────────────────────────────────────────────────────

export async function runForecast(
  input: ForecastInputs,
): Promise<ForecastResponse | { ok: false; error: string }> {
  const {
    tournamentId,
    targetRound,
    originUrl,
    holes = {},
    pinDifficultyAdder = 0,
    windOverride,
    useHrrr = true,
    levelShiftMode: rawMode,
    levelShiftAttenuation = 1,
    priorRounds = {},
    players = [],
  } = input;

  const warnings: string[] = [];
  const par = COURSE_PAR[tournamentId] ?? 72;
  const pars = COURSE_HOLE_PARS[tournamentId] ?? {};
  const bearings = getHoleBearings(tournamentId);
  const coords = coordsForTournamentId(tournamentId);

  const coeffs = await getScoringModel(tournamentId, originUrl);
  if (!coeffs) {
    return { ok: false, error: "Scoring model coefficients unavailable" };
  }
  if (!bearings) {
    return { ok: false, error: "No hole bearings for this course" };
  }
  const histMean =
    HISTORICAL_ROUND_MEANS[tournamentId]?.[targetRound] ?? null;

  // ── Wind resolution ─────────────────────────────────────────────
  let wind: { windMph: number; windDirDeg: number };
  let windSource: string;
  if (windOverride) {
    wind = windOverride;
    windSource = "user-override";
  } else if (useHrrr && coords) {
    // Target-round date = today's UTC by default; leave dispatcher
    // to override via a full round-date lookup in the future.
    const today = new Date().toISOString().slice(0, 10);
    try {
      const hourly = await getHrrrHourlyWind(
        coords.lat,
        coords.lon,
        today,
        coords.tz,
      );
      const summary = summariseHrrrDay(hourly);
      if (summary) {
        wind = { windMph: summary.windMph, windDirDeg: summary.windDirDeg };
        windSource = "hrrr";
      } else {
        wind = { windMph: 0, windDirDeg: 0 };
        windSource = "default-zero";
        warnings.push("HRRR returned no data — wind set to 0");
      }
    } catch {
      wind = { windMph: 0, windDirDeg: 0 };
      windSource = "default-zero";
      warnings.push("HRRR fetch failed — wind set to 0");
    }
  } else if (coords) {
    // GFS blend fallback
    const today = new Date().toISOString().slice(0, 10);
    try {
      const daily = await getDailyWeather(coords.lat, coords.lon, [today], coords.tz);
      const d = daily[0];
      if (
        d &&
        typeof d.windAvgMph === "number" &&
        typeof d.windDirDeg === "number"
      ) {
        wind = { windMph: d.windAvgMph, windDirDeg: d.windDirDeg };
        windSource = "gfs-blend";
      } else {
        wind = { windMph: 0, windDirDeg: 0 };
        windSource = "default-zero";
      }
    } catch {
      wind = { windMph: 0, windDirDeg: 0 };
      windSource = "default-zero";
    }
  } else {
    wind = { windMph: 0, windDirDeg: 0 };
    windSource = "default-zero";
  }

  // ── Per-hole projections + baseline sum ─────────────────────────
  const holeForecasts: HoleForecast[] = [];
  let modelDeltaSum = 0;
  let fieldTotal = 0;

  for (let h = 1; h <= 18; h++) {
    const fit: HoleFit | null = coeffs.holes[h] ?? null;
    const bearing = bearings[h];
    if (!fit || typeof bearing !== "number") continue;

    const holePar = pars[h] ?? 4;
    const override = holes[h] ?? {};
    const yards = override.yards ?? fit.histMeanYards;

    const conditions: TodayConditions = {
      yards,
      windSpeed: wind.windMph,
      windDir: wind.windDirDeg,
    };
    let clusterOverride: string | null = null;
    if (override.cluster && fit.clusterResiduals[override.cluster] != null) {
      clusterOverride = override.cluster;
    }
    const proj = projectHoleAvgToPar({
      fit,
      bearing,
      conditions,
      roundNum: targetRound,
    });
    // If user supplied a cluster letter, swap the cluster residual.
    let avgVsPar = proj.modelAvgVsPar;
    let clusterResidual = 0;
    if (clusterOverride) {
      // Recompute: remove the auto-matched cluster (which was 0
      // because we didn't pass pinX/pinY) and add the user's letter.
      clusterResidual = fit.clusterResiduals[clusterOverride] ?? 0;
      avgVsPar += clusterResidual;
    }

    // Break down wind / yardage / cluster deltas for the response.
    const baseAvg =
      fit.histMeanAvgVsParByRound[targetRound] ?? fit.histMeanAvgVsPar;
    const baseYards =
      fit.histMeanYardsByRound[targetRound] ?? fit.histMeanYards;
    const baseHead =
      fit.histMeanHeadByRound[targetRound] ?? fit.histMeanHead;
    const head =
      wind.windMph *
      Math.cos(((wind.windDirDeg - bearing) * Math.PI) / 180);
    const windDelta = fit.bHead * (head - baseHead);
    const yardsDelta = fit.bYards * (yards - baseYards);
    const modelDelta = avgVsPar - baseAvg;

    modelDeltaSum += modelDelta;
    fieldTotal += avgVsPar;

    holeForecasts.push({
      hole: h,
      par: holePar,
      yards,
      cluster: clusterOverride,
      windMph: wind.windMph,
      windDirDeg: wind.windDirDeg,
      headwind: head,
      avgVsPar,
      clusterResidual,
      windDelta,
      yardsDelta,
    });
  }

  // ── Level shift from prior-round observations ───────────────────
  const mode: LevelShiftMode =
    rawMode ??
    (targetRound >= 3 ? "most-recent-post-cut" : "average");

  const levelShiftPerRound: Partial<Record<1 | 2 | 3 | 4, number>> = {};
  for (const [rStr, obs] of Object.entries(priorRounds)) {
    const r = Number(rStr) as 1 | 2 | 3 | 4;
    if (!obs || r >= targetRound) continue;
    let sumResid = 0;
    let n = 0;
    for (let h = 1; h <= 18; h++) {
      const fit = coeffs.holes[h];
      const bearing = bearings[h];
      const actualVsPar = obs.vsParByHole[h];
      const yards = obs.setup.yardsByHole[h];
      if (
        !fit ||
        typeof bearing !== "number" ||
        typeof actualVsPar !== "number" ||
        typeof yards !== "number"
      )
        continue;
      const clusterLetter = obs.setup.clusterByHole?.[h];
      const cluster =
        clusterLetter && fit.clusterResiduals[clusterLetter] != null
          ? fit.clusterResiduals[clusterLetter]
          : 0;
      const baseAvg =
        fit.histMeanAvgVsParByRound[r] ?? fit.histMeanAvgVsPar;
      const baseYards = fit.histMeanYardsByRound[r] ?? fit.histMeanYards;
      const baseHead = fit.histMeanHeadByRound[r] ?? fit.histMeanHead;
      const head =
        obs.setup.wind.windMph *
        Math.cos(
          ((obs.setup.wind.windDirDeg - bearing) * Math.PI) / 180,
        );
      const predicted =
        baseAvg +
        cluster +
        fit.bHead * (head - baseHead) +
        fit.bYards * (yards - baseYards);
      sumResid += actualVsPar - predicted;
      n += 1;
    }
    if (n >= 15) levelShiftPerRound[r] = sumResid / n;
  }

  const availableRounds = Object.entries(levelShiftPerRound)
    .map(([rStr, v]) => ({ round: Number(rStr) as 1 | 2 | 3 | 4, value: v! }))
    .filter((x) => typeof x.value === "number");

  let selected = availableRounds;
  if (mode === "most-recent") {
    selected = availableRounds.length
      ? [availableRounds.sort((a, b) => b.round - a.round)[0]]
      : [];
  } else if (mode === "most-recent-post-cut") {
    const postCut = availableRounds.filter((r) => r.round >= 3);
    selected = postCut.length
      ? [postCut.sort((a, b) => b.round - a.round)[0]]
      : availableRounds.length
        ? [availableRounds.sort((a, b) => b.round - a.round)[0]]
        : [];
  }
  const rawLevelShift = selected.length
    ? (selected.reduce((a, b) => a + b.value, 0) / selected.length) * 18
    : 0;
  const levelShiftPerHole = selected.length
    ? selected.reduce((a, b) => a + b.value, 0) / selected.length
    : 0;
  const levelShiftAttenuated = rawLevelShift * levelShiftAttenuation;

  // ── Assemble field forecast ─────────────────────────────────────
  const fieldForecastVsPar =
    fieldTotal + levelShiftAttenuated + pinDifficultyAdder;
  const fieldForecast = par + fieldForecastVsPar;

  // ── Per-player projections ─────────────────────────────────────
  const playerForecasts: PlayerForecast[] = [];
  for (const p of players) {
    const compression = p.compressionFactor ?? 0.83;
    const compressedEdge = p.sgTotal * compression;
    const formWeight = p.formWeight ?? 0.2;
    const formBump = bayesianFormBump(p.weekRounds, p.sgTotal, formWeight);
    const skewGap = p.skewAdjustment ?? autoSkew(p.sgTotal);
    // Player expected mean = field mean − compressed edge + form bump
    // (formBump is negative if he's been out-performing).
    const expectedMean = fieldForecast - compressedEdge + formBump;
    const expectedMedian = expectedMean - skewGap;
    playerForecasts.push({
      name: p.name,
      sgTotal: p.sgTotal,
      sgTotalAdjusted: compressedEdge - formBump,
      formAdjustment: formBump,
      expectedMean,
      expectedMedian,
      breakdown: {
        fieldMean: fieldForecast,
        compressedEdge,
        formBump,
        skewGap,
      },
    });
  }

  // Apply level shift + pin adder to per-hole outputs proportionally
  // for the response — makes the returned per-hole numbers add up.
  const perHoleAdd = (levelShiftAttenuated + pinDifficultyAdder) / 18;
  for (const h of holeForecasts) {
    h.avgVsPar += perHoleAdd;
  }

  return {
    ok: true,
    tournamentId,
    targetRound,
    par,
    wind: { ...wind, source: windSource },
    historicalRoundMean: histMean,
    levelShift: rawLevelShift,
    levelShiftAttenuated,
    levelShiftMode: mode,
    levelShiftPerRound,
    pinDifficultyAdder,
    modelDelta: modelDeltaSum,
    fieldForecast,
    fieldForecastVsPar,
    holes: holeForecasts,
    players: playerForecasts,
    warnings,
  };
}

/** Utility: derive prior-round observations from the deployed
 *  courseStats + pin sheet — so callers who don't pass priorRounds
 *  still get a level shift. Read via the internal /api/course-pins
 *  endpoint. */
export async function fetchPriorRoundObservations(
  tournamentId: string,
  originUrl: string,
  targetRound: 1 | 2 | 3 | 4,
): Promise<Partial<Record<1 | 2 | 3 | 4, PriorRoundObservation>>> {
  const url = `${originUrl.replace(/\/$/, "")}/api/course-pins?tournamentId=${encodeURIComponent(tournamentId)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    const j = (await res.json()) as {
      pins?: {
        holes?: Array<{
          holeNumber: number;
          yardsByRound?: Record<string, number>;
          pinByRound?: Record<
            string,
            { x?: number; y?: number } | null
          >;
          scoringByRound?: Record<string, { vsPar?: number } | null>;
        }>;
      };
    };
    const holes = j?.pins?.holes ?? [];
    const out: Partial<Record<1 | 2 | 3 | 4, PriorRoundObservation>> = {};
    // Also need wind per round. Reuse Open-Meteo daily — same
    // history the tee-time-scoring API already pulls.
    const coords = coordsForTournamentId(tournamentId);
    const dailyByRound: Partial<
      Record<1 | 2 | 3 | 4, { windMph: number; windDirDeg: number }>
    > = {};
    if (coords) {
      const dates: Record<1 | 2 | 3 | 4, string> = {
        1: "", 2: "", 3: "", 4: "",
      };
      // Hard-coded round dates for 3M Open 2026 — same as tee-time-scoring
      if (tournamentId === "R2026525") {
        dates[1] = "2026-07-23";
        dates[2] = "2026-07-24";
        dates[3] = "2026-07-25";
        dates[4] = "2026-07-26";
      }
      const daily = await getDailyWeather(
        coords.lat,
        coords.lon,
        Object.values(dates).filter(Boolean),
        coords.tz,
      );
      for (const r of [1, 2, 3, 4] as const) {
        if (!dates[r]) continue;
        const d = daily.find((x) => x.date === dates[r]);
        if (
          d &&
          typeof d.windAvgMph === "number" &&
          typeof d.windDirDeg === "number"
        ) {
          dailyByRound[r] = { windMph: d.windAvgMph, windDirDeg: d.windDirDeg };
        }
      }
    }
    for (const r of [1, 2, 3, 4] as const) {
      if (r >= targetRound) continue;
      const wind = dailyByRound[r] ?? { windMph: 0, windDirDeg: 0 };
      const vsParByHole: Record<number, number> = {};
      const yardsByHole: Record<number, number> = {};
      for (const h of holes) {
        const sc = h.scoringByRound?.[String(r)];
        const yds = h.yardsByRound?.[String(r)];
        if (sc && typeof sc.vsPar === "number") {
          vsParByHole[h.holeNumber] = sc.vsPar;
        }
        if (typeof yds === "number") {
          yardsByHole[h.holeNumber] = yds;
        }
      }
      if (Object.keys(vsParByHole).length >= 15) {
        out[r] = {
          vsParByHole,
          setup: {
            yardsByHole,
            wind,
          },
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}
