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
  windAtHour,
  type HourlyWind,
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

/** Hard-coded round dates per tournament. Same table as the
 *  tee-time-scoring API uses — real dates for each round so the
 *  wind fetch targets the correct day rather than the server's
 *  system clock (which may be off from the tournament's dates). */
const ROUND_DATES: Record<string, Record<1 | 2 | 3 | 4, string>> = {
  R2026525: {
    1: "2026-07-23",
    2: "2026-07-24",
    3: "2026-07-25",
    4: "2026-07-26",
  },
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
  /** Local tee time in fractional hours (e.g. 14.5 for 2:30 PM).
   *  When provided AND HRRR hourly wind is available, the model
   *  recomputes each hole's expected score using the wind at that
   *  hole's play time (15 min per hole from tee-off). Late tee times
   *  facing a building afternoon wind get a properly harder
   *  projection than the day-average field forecast. */
  teeHourLocal?: number;
  /** Starting hole (1 or 10 typically). Only used with teeHourLocal;
   *  defaults to 1 for regular non-shotgun rounds. */
  startHole?: number;
}

export interface ForecastInputs {
  tournamentId: string;
  /** Round to forecast, 1-4. */
  targetRound: 1 | 2 | 3 | 4;
  /** Absolute origin URL for internal fetches (birdies API). */
  originUrl: string;
  /** Per-hole overrides — cluster letter + yardage. When null/absent
   *  the model auto-populates from the pin sheet (yardsByRound +
   *  nearest-centroid cluster match on pinByRound). */
  holes?: Record<number, HoleOverride>;
  /** When true (default), fetch yardages + pin coords from the pin
   *  sheet for the target round and pre-populate any `holes` entries
   *  that weren't overridden. Turn off if you want the model to fall
   *  back to historical means without touching the pin sheet.
   *  Kept for backwards compat with older callers — new callers
   *  should use `autoYardage` / `autoPins` independently. */
  autoYardageAndPins?: boolean;
  /** Independent control: fetch target-round yardage from the pin
   *  sheet. Defaults to autoYardageAndPins (else true). */
  autoYardage?: boolean;
  /** Independent control: fetch target-round pin coords and auto-match
   *  to cluster residuals. Defaults to autoYardageAndPins (else true).
   *  Turning this off means every hole's cluster residual = 0 —
   *  useful when the caller wants to specify pin difficulty as a
   *  single manual adjustment via `pinDifficultyAdder` instead. */
  autoPins?: boolean;
  /** Alternative yardage-source: derive target-round yardage from a
   *  PRIOR round's actual yardages plus a total-course delta. Useful
   *  when the target round's yardages haven't been posted but the
   *  user knows the setup is X yards longer/shorter than the prior
   *  round they trust. Delta is applied evenly across all 18 holes
   *  (each hole gets delta/18 yards). */
  yardsDeltaFromRound?: {
    sourceRound: 1 | 2 | 3 | 4;
    totalDeltaYards: number;
  };
  /** Flat stroke adder for setup effects the model can't otherwise
   *  see (green firmness, rough length, novel pins outside any
   *  historical cluster). Applied to the field forecast total. */
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
    /** True when the player's field mean was recomputed with tee-
     *  time-specific hourly wind (vs the day-avg field forecast). */
    teeTimeAdjusted?: boolean;
    /** Wind at tee-off, when tee-time-adjusted. */
    teeTimeWind?: { windMph: number; windDirDeg: number };
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
 *  baseline. Compares player's actual score EACH round to what they
 *  should have shot given THAT round's actual field mean (soft-field
 *  weeks pull the "expected" lower for every player), then shrinks
 *  the average delta toward zero by the weight.
 *
 *  weekRounds are indexed by prior round: [R1_score, R2_score, ...].
 *  fieldMeansByRound gives the field's vs-par mean per round. When
 *  a field mean isn't available for a round, we fall back to the
 *  "shoots vs par 0" assumption (season-baseline behaviour) for that
 *  round only.
 *
 *  Returns strokes/round the projection should shift by. Negative =
 *  player has been out-performing → lower expected score.
 */
function bayesianFormBump(
  weekRounds: number[] | undefined,
  sgTotal: number,
  weight: number,
  fieldMeansByRound: Partial<Record<1 | 2 | 3 | 4, number>>,
): number {
  if (!weekRounds || weekRounds.length === 0) return 0;
  let sumOver = 0;
  for (let i = 0; i < weekRounds.length; i++) {
    const round = (i + 1) as 1 | 2 | 3 | 4;
    const actualVsPar = weekRounds[i];
    const fieldMean = fieldMeansByRound[round] ?? 0;
    // Expected for this player in this specific field:
    //   expected_vs_par = field_mean_vs_par − sgTotal
    // A +3 SG player in a −2 vs-par field is expected at −5 vs par.
    const expectedVsPar = fieldMean - sgTotal;
    sumOver += actualVsPar - expectedVsPar; // negative = over-performing
  }
  const meanOver = sumOver / weekRounds.length;
  return weight * meanOver;
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
    autoYardageAndPins = true,
    yardsDeltaFromRound,
    pinDifficultyAdder = 0,
    windOverride,
    useHrrr = true,
    levelShiftMode: rawMode,
    levelShiftAttenuation = 1,
    priorRounds = {},
    players = [],
  } = input;
  const autoYardage = input.autoYardage ?? autoYardageAndPins;
  const autoPins = input.autoPins ?? autoYardageAndPins;

  // Auto-populate yardage + pin coords from the pin sheet when the
  // caller didn't supply overrides for those fields. The pin sheet
  // is the authoritative source; the fit's histMeanYards is only a
  // last-resort fallback when the sheet hasn't been posted for the
  // target round.
  const effectiveHoles: Record<
    number,
    { cluster?: string; yards?: number; pinX?: number; pinY?: number }
  > = {};
  for (const [hStr, o] of Object.entries(holes)) {
    effectiveHoles[Number(hStr)] = { ...o };
  }
  if (autoYardage || autoPins || yardsDeltaFromRound) {
    try {
      const pinSheet = await fetchPinSheet(tournamentId, originUrl);
      if (pinSheet) {
        for (const h of pinSheet.holes ?? []) {
          const num = h.holeNumber;
          const cur = effectiveHoles[num] ?? {};
          // Check whether the target round's pin is really posted for
          // this hole (real coord, not the -1 sentinel). Orchestrator
          // returns default scorecard yardage when a round hasn't been
          // officially set — trusting that yardage blindly leads to
          // e.g. R4 H16 = 411 (scorecard default) rather than the
          // actual R4 setup which may still be pending.
          const pinBy = h.pinByRound?.[String(targetRound)];
          const pinConfirmed =
            !!pinBy &&
            typeof pinBy.x === "number" &&
            typeof pinBy.y === "number" &&
            pinBy.x !== -1 &&
            pinBy.y !== -1;

          // Yardage source: manual delta beats target-round-auto.
          if (yardsDeltaFromRound && cur.yards == null) {
            const src =
              h.yardsByRound?.[String(yardsDeltaFromRound.sourceRound)];
            if (typeof src === "number") {
              cur.yards = src + yardsDeltaFromRound.totalDeltaYards / 18;
            }
          }
          if (autoYardage && cur.yards == null && pinConfirmed) {
            const yBy = h.yardsByRound?.[String(targetRound)];
            if (typeof yBy === "number") cur.yards = yBy;
          }
          // Pin coords — only when autoPins is enabled AND the round
          // has a real coord (not the -1 sentinel).
          if (
            autoPins &&
            cur.pinX == null &&
            cur.pinY == null &&
            pinConfirmed
          ) {
            cur.pinX = pinBy!.x;
            cur.pinY = pinBy!.y;
          }
          effectiveHoles[num] = cur;
        }
      }
    } catch {
      /* pin sheet unavailable — fall back to fit means */
    }
  }

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
  // Target-round date: prefer the hard-coded per-tournament table
  // (real tournament dates), else fall back to today's UTC. The
  // fallback is a rough approximation when a tournament hasn't been
  // added to the table.
  const targetDate =
    ROUND_DATES[tournamentId]?.[targetRound] ??
    new Date().toISOString().slice(0, 10);

  let wind: { windMph: number; windDirDeg: number };
  let windSource: string;
  if (windOverride) {
    wind = windOverride;
    windSource = "user-override";
  } else if (useHrrr && coords) {
    try {
      const hourly = await getHrrrHourlyWind(
        coords.lat,
        coords.lon,
        targetDate,
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
    try {
      const daily = await getDailyWeather(coords.lat, coords.lon, [targetDate], coords.tz);
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
    const override = effectiveHoles[h] ?? {};
    const yards = override.yards ?? fit.histMeanYards;

    const conditions: TodayConditions = {
      yards,
      windSpeed: wind.windMph,
      windDir: wind.windDirDeg,
      pinX: override.pinX,
      pinY: override.pinY,
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
    // If user supplied a cluster letter, swap the cluster residual
    // (overriding the auto-matched one). Otherwise use whatever the
    // projector matched from pinX/pinY.
    let avgVsPar = proj.modelAvgVsPar;
    let clusterResidual = 0;
    if (clusterOverride) {
      // Remove auto-matched residual and add user's letter's residual.
      const autoRes = proj.matchedCluster
        ? fit.clusterResiduals[proj.matchedCluster] ?? 0
        : 0;
      clusterResidual = fit.clusterResiduals[clusterOverride] ?? 0;
      avgVsPar = avgVsPar - autoRes + clusterResidual;
    } else if (proj.matchedCluster) {
      clusterResidual = fit.clusterResiduals[proj.matchedCluster] ?? 0;
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
      cluster: clusterOverride ?? proj.matchedCluster,
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

  // ── Fetch HRRR hourly wind once (shared across all tee-time-
  // aware player projections). Cheap in-process cache in
  // getHrrrHourlyWind means we don't re-hit Open-Meteo. */
  let hrrrHourly: HourlyWind[] = [];
  if (coords && !windOverride) {
    try {
      hrrrHourly = await getHrrrHourlyWind(
        coords.lat,
        coords.lon,
        targetDate,
        coords.tz,
      );
    } catch {
      /* no hourly — players fall back to day-avg wind */
    }
  }

  /** Per-player field-mean recompute with hourly wind. When we know
   *  the player's tee time we can trace the wind hour-by-hour along
   *  their round and produce a mean-anchored expectation that
   *  reflects the actual wind they'll face — not the day average. */
  function fieldMeanForTeeTime(
    teeHour: number,
    startHole: number,
  ): { fieldForecastVsPar: number; teeWind: { windMph: number; windDirDeg: number } } | null {
    if (hrrrHourly.length === 0) return null;
    let sum = 0;
    for (let step = 0; step < 18; step++) {
      const holeNum = ((startHole - 1 + step) % 18) + 1;
      const fit = coeffs!.holes[holeNum];
      const bearing = bearings![holeNum];
      if (!fit || typeof bearing !== "number") continue;
      const holeHour = teeHour + step * 0.25; // 15 min/hole
      const w = windAtHour(hrrrHourly, holeHour);
      if (!w) return null;
      const override = effectiveHoles[holeNum] ?? {};
      const yards = override.yards ?? fit.histMeanYards;
      const conditions: TodayConditions = {
        yards,
        windSpeed: w.windMph,
        windDir: w.windDirDeg,
        pinX: override.pinX,
        pinY: override.pinY,
      };
      const p = projectHoleAvgToPar({
        fit,
        bearing,
        conditions,
        roundNum: targetRound,
      });
      let avg = p.modelAvgVsPar;
      if (override.cluster && fit.clusterResiduals[override.cluster] != null) {
        const autoRes = p.matchedCluster
          ? fit.clusterResiduals[p.matchedCluster] ?? 0
          : 0;
        avg = avg - autoRes + fit.clusterResiduals[override.cluster];
      }
      // Apply the same level shift + pin adder per-hole share.
      avg += (levelShiftAttenuated + pinDifficultyAdder) / 18;
      sum += avg;
    }
    const startWind = windAtHour(hrrrHourly, teeHour);
    return {
      fieldForecastVsPar: sum,
      teeWind: startWind ?? { windMph: wind.windMph, windDirDeg: wind.windDirDeg },
    };
  }

  // ── Per-player projections ─────────────────────────────────────
  // Compute per-round field mean vs par from priorRounds observations.
  // Used to make form adjustment context-aware — a player who shot
  // "great" in a soft field may just be shooting to his skill, not
  // out-performing baseline.
  const fieldMeansByRound: Partial<Record<1 | 2 | 3 | 4, number>> = {};
  for (const [rStr, obs] of Object.entries(priorRounds)) {
    if (!obs) continue;
    const r = Number(rStr) as 1 | 2 | 3 | 4;
    let sum = 0;
    let n = 0;
    for (const v of Object.values(obs.vsParByHole)) {
      if (typeof v === "number") {
        sum += v;
        n += 1;
      }
    }
    if (n > 0) fieldMeansByRound[r] = sum; // sum of per-hole vs-par = round total vs par
  }
  const playerForecasts: PlayerForecast[] = [];
  for (const p of players) {
    const compression = p.compressionFactor ?? 0.83;
    const compressedEdge = p.sgTotal * compression;
    const formWeight = p.formWeight ?? 0.2;
    const formBump = bayesianFormBump(
      p.weekRounds,
      p.sgTotal,
      formWeight,
      fieldMeansByRound,
    );
    const skewGap = p.skewAdjustment ?? autoSkew(p.sgTotal);

    // Player-specific field baseline. If a tee time is given AND
    // hourly HRRR data is available, walk the hourly wind along
    // their round to get a wind-time-aware baseline. Otherwise fall
    // back to the day-average field forecast.
    let playerFieldMean = fieldForecast;
    let teeTimeAdjusted = false;
    let teeTimeWind: { windMph: number; windDirDeg: number } | undefined;
    if (typeof p.teeHourLocal === "number" && hrrrHourly.length > 0) {
      const walk = fieldMeanForTeeTime(
        p.teeHourLocal,
        p.startHole ?? 1,
      );
      if (walk) {
        playerFieldMean = par + walk.fieldForecastVsPar;
        teeTimeAdjusted = true;
        teeTimeWind = walk.teeWind;
      }
    }

    // Player expected mean = field mean − compressed edge + form bump
    // (formBump is negative if he's been out-performing).
    const expectedMean = playerFieldMean - compressedEdge + formBump;
    const expectedMedian = expectedMean - skewGap;
    playerForecasts.push({
      name: p.name,
      sgTotal: p.sgTotal,
      sgTotalAdjusted: compressedEdge - formBump,
      formAdjustment: formBump,
      expectedMean,
      expectedMedian,
      breakdown: {
        fieldMean: playerFieldMean,
        compressedEdge,
        formBump,
        skewGap,
        teeTimeAdjusted,
        teeTimeWind,
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

/** Fetch the pin sheet — hits the orchestrator's courseStats query
 *  directly rather than Pardle's cached /api/course-pins endpoint.
 *  The Pardle endpoint has a 6-hour Redis cache that ends up serving
 *  R3 pins as R4 placeholders (and missing R4 yardages) for hours
 *  after the tour posts the real R4 setup. The forecast tool needs
 *  the freshest data possible so it bypasses that cache. */
interface PinSheetHole {
  holeNumber: number;
  yards?: number | null;
  yardsByRound?: Record<string, number>;
  pinByRound?: Record<string, { x?: number; y?: number } | null>;
  scoringByRound?: Record<string, { vsPar?: number } | null>;
}
interface PinSheetShape {
  holes?: PinSheetHole[];
}
async function fetchPinSheet(
  tournamentId: string,
  _originUrl: string,
): Promise<PinSheetShape | null> {
  const url = "https://orchestrator.pgatour.com/graphql";
  const query = `{
    courseStats(tournamentId:"${tournamentId}") {
      courses {
        roundHoleStats {
          roundNum
          holeStats {
            ... on CourseHoleStats {
              courseHoleNum
              parValue
              yards
              scoringAverage
              scoringAverageDiff
              pinGreen {
                leftToRightCoords {
                  enhancedX
                  enhancedY
                }
              }
            }
          }
        }
      }
    }
  }`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "da2-gsrx5bibzbb4njvhl7t37wqyl4",
        Origin: "https://www.pgatour.com",
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    interface OrchCoords {
      enhancedX?: number;
      enhancedY?: number;
    }
    interface OrchHole {
      courseHoleNum?: number;
      yards?: number;
      scoringAverageDiff?: number;
      pinGreen?: { leftToRightCoords?: OrchCoords };
    }
    interface OrchRound {
      roundNum?: number;
      holeStats?: OrchHole[];
    }
    const j = (await res.json()) as {
      data?: {
        courseStats?: { courses?: Array<{ roundHoleStats?: OrchRound[] }> };
      };
    };
    const rounds =
      j.data?.courseStats?.courses?.[0]?.roundHoleStats ?? [];
    // Assemble the per-hole shape the caller expects.
    const byHole = new Map<number, PinSheetHole>();
    for (const r of rounds) {
      const roundNum = r.roundNum;
      if (typeof roundNum !== "number") continue;
      for (const h of r.holeStats ?? []) {
        const num = h.courseHoleNum;
        if (typeof num !== "number" || num < 1 || num > 18) continue;
        const entry: PinSheetHole =
          byHole.get(num) ?? {
            holeNumber: num,
            yardsByRound: {},
            pinByRound: {},
            scoringByRound: {},
          };
        if (typeof h.yards === "number" && h.yards > 0) {
          entry.yardsByRound![String(roundNum)] = h.yards;
        }
        const coords = h.pinGreen?.leftToRightCoords;
        if (
          coords &&
          typeof coords.enhancedX === "number" &&
          typeof coords.enhancedY === "number"
        ) {
          entry.pinByRound![String(roundNum)] = {
            x: coords.enhancedX,
            y: coords.enhancedY,
          };
        }
        if (typeof h.scoringAverageDiff === "number") {
          entry.scoringByRound![String(roundNum)] = {
            vsPar: h.scoringAverageDiff,
          };
        }
        byHole.set(num, entry);
      }
    }
    return { holes: Array.from(byHole.values()) };
  } catch {
    return null;
  }
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
