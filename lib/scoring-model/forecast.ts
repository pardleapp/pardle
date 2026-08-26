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
import { projectHoleAvgToPar, pinSpecificResidual } from "./project";
import { getScoringModel } from "./loader";
import { getTournamentConfig } from "./tournament-config";
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

// Historical round means, round dates, hole pars and course par
// are now all sourced dynamically from lib/scoring-model/
// tournament-config.ts — which reads whatever the fetch script has
// produced in data/historical/. See getForecastForRound below.

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
    /** Actual pin coord (0-1 normalised) per hole for that round.
     *  Used by pinSpecificResidual to isolate course-condition
     *  effects from pin-position variance within a cluster. */
    pinByHole?: Record<number, { x: number; y: number }>;
    wind: { windMph: number; windDirDeg: number };
  };
}

/** Per-round SG decomposition (strokes gained vs field). All values
 *  are optional so callers can supply whatever DataGolf returned. */
export interface RoundSgBreakdown {
  /** Off-the-tee — most persistent, weight 0.65. */
  sgOtt?: number | null;
  /** Approach — highly persistent, weight 0.60. */
  sgApp?: number | null;
  /** Around-the-green — moderately persistent, weight 0.40. */
  sgArg?: number | null;
  /** Putting — least persistent, weight 0.30. */
  sgPutt?: number | null;
}

/** Per-player skill + form knobs. */
/** DataGolf tail probabilities per player — passed through from the
 *  /api/scoring-model/field endpoint so we can echo them in the
 *  response alongside our own probability output. */
export interface DGPlayerProbs {
  win?: number;
  top3?: number;
  top5?: number;
  top10?: number;
  top20?: number;
  top30?: number;
  makeCut?: number;
  firstRoundLead?: number;
  ev?: number;
}

export interface PlayerInput {
  /** DataGolf dg_id — used to look up per-player round-score sigma
   *  from the tournament config (measured from every historical
   *  round we have on file for this player at this venue). */
  dgId?: string;
  /** DataGolf's own pre-tournament tail probabilities passed through
   *  to the response so bettors can compare our probabilities to
   *  theirs side-by-side. */
  dgProbs?: DGPlayerProbs;
  /** Display name — echoed back in the response. */
  name: string;
  /** Season-long SG total vs full field (positive = better than field
   *  average per round). */
  sgTotal: number;
  /** Where the sgTotal figure came from. When `"event-specific"` the
   *  number already includes course-fit adjustment (via DataGolf's
   *  pre-tournament decomposition CSV `final_prediction`), so applying
   *  the course-type compression factor on top would double-compress.
   *  In that case the default compressionFactor becomes 1.0 unless
   *  the caller explicitly overrides it. `"season-generic"` means the
   *  number is a season-long universal SG rating (no event fit
   *  applied), so the venue's compression correctly applies. */
  sgSource?: "event-specific" | "season-generic";
  /** Compression factor applied to sgTotal at this course. 1.0 = no
   *  compression, 0.83 = 17% shrink (typical at bunching-friendly
   *  venues). Default depends on sgSource — see the sgSource docs. */
  compressionFactor?: number;
  /** Mean-median gap for this player's personal round distribution.
   *  Elite (~0.15-0.2), mid-tier (~0.25), below-avg (~0.3). Default
   *  auto-picks by sgTotal band. */
  skewAdjustment?: number;
  /** This week's per-round scores-vs-par so far. Feeds the Bayesian
   *  form adjustment. */
  weekRounds?: number[];
  /** Optional per-round SG decomposition (from DataGolf live stats).
   *  When present the form bump becomes PERSISTENCE-WEIGHTED — an
   *  approach-driven round of -6 carries more signal into the next
   *  round than a putt-driven -6, since SG:APP persists year-over-year
   *  ~0.60 while SG:PUTT persists only ~0.30. Index-aligned with
   *  weekRounds; entries can be null when DG doesn't have a breakdown
   *  for that round yet. */
  weekRoundsSg?: Array<RoundSgBreakdown | null>;
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
  /** The field's tee times (local hours, fractional). When supplied
   *  AND HRRR hourly is available, the FIELD forecast is computed
   *  per hole using the average wind across each hole's actual play
   *  window (15 min/hole from every tee time). This matches how the
   *  per-player projection already handles wind. When omitted, the
   *  field forecast falls back to the day-average wind. */
  fieldTeeHoursLocal?: number[];
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
  /** Number of historical (pin, round) rows behind this hole's fit.
   *  Small values (< SAMPLE_LOW_THRESHOLD) mean the projection for
   *  this hole is thinly-supported — the UI badges those so the
   *  reader knows which per-hole numbers deserve less trust. */
  fitRowCount: number;
  /** True when this hole's historical sample is thin enough that
   *  the model's per-hole projection carries meaningful uncertainty
   *  beyond the field-level σ. */
  lowSample: boolean;
}

export interface PlayerForecast {
  name: string;
  dgId?: string;
  sgTotal: number;
  sgTotalAdjusted: number; // after compression + form
  formAdjustment: number;  // strokes/round bump from Bayesian shrinkage
  expectedMean: number;
  expectedMedian: number;
  /** One-sigma round-score spread. Sourced in priority order:
   *    1. Direct DataGolf sigma (if supplied via PlayerInput.dgProbs
   *       and we can back-solve — currently 2 & 3 are the only
   *       operational sources).
   *    2. Historical sigma at this venue (from every round on file
   *       for this dg_id).
   *    3. Course-average sigma (fallback). */
  roundScoreSigma: number;
  /** Where roundScoreSigma came from — surfaced so the UI can flag
   *  when we're falling back to the course baseline. */
  roundScoreSigmaSource: "player-history" | "course-baseline";
  /** P(round score ≤ threshold) for a set of absolute stroke
   *  thresholds around the player's expected median. Keys are
   *  absolute score strings ("64", "65", ..., "76"); values are
   *  0..1 probabilities computed from a skew-adjusted Gaussian
   *  (median shifted, then σ preserved). */
  probScoreUnder: Record<string, number>;
  /** DataGolf's own tail probabilities passed through. Undefined if
   *  no dgProbs were supplied in the PlayerInput. */
  dgProbs?: DGPlayerProbs;
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
    /** Per-round SG-persistence factor (1.0 = category-neutral,
     *  matches the old vs-par-only model; >1 = overperformance came
     *  from persistent skills like approach; <1 = came from putting).
     *  Index-aligned with the caller's weekRoundsSg input; entries
     *  are null when that round had no SG breakdown supplied. */
    formPersistencePerRound?: Array<number | null>;
  };
}

export interface ForecastResponse {
  ok: true;
  tournamentId: string;
  targetRound: 1 | 2 | 3 | 4;
  par: number;
  wind: { windMph: number; windDirDeg: number; source: string };
  historicalRoundMean: number | null;
  /** Same round's historical median field score. Round-score
   *  over/unders are typically set against the median, so bettors
   *  reading the tool alongside a bookmaker's line want this
   *  alongside the mean. Null when there aren't enough historicals
   *  on file to compute it. */
  historicalRoundMedian: number | null;
  /** Course-level right-skew of the field-round distribution
   *  (mean − median, averaged across every year:round on file).
   *  Positive → mean sits above median → the venue produces
   *  occasional blow-up rounds that pull the mean up. */
  historicalMeanMedianGap: number;
  levelShift: number;
  levelShiftAttenuated: number;
  levelShiftMode: LevelShiftMode;
  levelShiftPerRound: Partial<Record<1 | 2 | 3 | 4, number>>;
  pinDifficultyAdder: number;
  modelDelta: number;
  fieldForecast: number;
  fieldForecastVsPar: number;
  /** Field-round median forecast. Derived from the mean forecast
   *  minus the venue's historical mean-median gap — i.e. we apply
   *  the same right-skew we've observed at this course over the
   *  years, on top of today's mean projection. */
  fieldForecastMedian: number;
  /** One-standard-deviation width of the field-round-score
   *  distribution today. Combines a base historical round-score
   *  spread with an inflation term when small-sample holes are
   *  driving material portions of the projection. */
  fieldForecastSigma: number;
  holes: HoleForecast[];
  players: PlayerForecast[];
  warnings: string[];
}

// ── Helpers ────────────────────────────────────────────────────────

/** Below this many historical fit rows, a hole's per-hole projection
 *  is flagged as low-sample. Roughly 30 rows corresponds to ~4 years
 *  of tour play at that hole — thin enough that a single outlier pin
 *  can move the projection meaningfully. */
export const SAMPLE_LOW_THRESHOLD = 30;

/** Baseline standard deviation of a PGA Tour field-average round
 *  score. Empirically observed on tour events: field-round means sit
 *  in a distribution ~1.3-1.6 strokes wide. We use 1.4 as the base
 *  and inflate when the current model has thinly-sampled holes. */
const BASE_FIELD_ROUND_SIGMA = 1.4;

/** Scale the base skew by expected round conditions — harder rounds
 *  produce fatter right tails (more triples, lost balls) and widen
 *  the mean-median gap even for elite players. Anchored at 1.0 when
 *  conditions match historical baseline; grows above 1.0 when the
 *  field forecast is meaningfully harder than typical. */
function conditionsSkewMultiplier(
  fieldForecastVsPar: number,
  historicalMeanVsPar: number | null,
): number {
  if (
    historicalMeanVsPar == null ||
    !Number.isFinite(historicalMeanVsPar) ||
    !Number.isFinite(fieldForecastVsPar)
  ) {
    return 1;
  }
  // How much harder than typical is today? Positive delta → wider tail.
  const delta = fieldForecastVsPar - historicalMeanVsPar;
  // 3-stroke-harder-than-typical round widens skew by ~30%; capped so
  // extreme days don't produce runaway skew values.
  const factor = 1 + Math.max(-0.2, Math.min(0.35, delta * 0.1));
  return factor;
}

/** Standard-normal cumulative distribution function using the
 *  Abramowitz & Stegun 7.1.26 rational approximation of erf. Fast,
 *  accurate to ~1e-7 — plenty for probability-of-shooting-X output.
 *  Consumed by probScoreUnder to build the per-player P(score ≤ k)
 *  map without pulling in a stats library. */
function normalCdf(z: number): number {
  const sign = z >= 0 ? 1 : -1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Given a player's expected median score and one-σ round-score
 *  spread, build the P(round ≤ threshold) map for a band of
 *  bookmaker-style .5 thresholds centred on the median. Bookmakers
 *  set round-score over/unders on .5 lines (68.5, 69.5, ...) so
 *  the "under" event is unambiguous — this returns exactly those.
 *
 *  Keys are the .5 threshold string ("68.5"); values are P(round
 *  ≤ that threshold) via a normal approximation anchored at the
 *  median. The mean-median gap is already baked into
 *  `expectedMedian`, so no additional skew is applied here. */
function buildProbScoreUnder(
  expectedMedian: number,
  sigma: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Number.isFinite(expectedMedian) || !Number.isFinite(sigma) || sigma <= 0) {
    return out;
  }
  // Cover ±6 half-stroke steps around the median in .5-stroke
  // buckets — the range a bettor is most likely to eyeball against
  // an actual book O/U line.
  const centre = Math.round(expectedMedian);
  for (let k = centre - 6; k <= centre + 6; k++) {
    const threshold = k + 0.5;
    const z = (threshold - expectedMedian) / sigma;
    out[threshold.toFixed(1)] = Number(normalCdf(z).toFixed(4));
  }
  return out;
}

/** SG persistence coefficients — how much of an SG category
 *  overperformance in one round carries into the next. These are
 *  round-to-round persistence figures adapted from Broadie's SG
 *  literature (Every Shot Counts) and DataGolf's own skill-decay
 *  work. Off-the-tee and approach are core skills that show up
 *  reliably; around-the-green and putting have much bigger noise
 *  components (green firmness, weather-affected roll speed) that
 *  wash out inside a week.
 *
 *  A category-neutral (evenly distributed) round has an "effective
 *  persistence" equal to the arithmetic mean of these weights =
 *  0.4875. We normalise so a neutral round produces the same form
 *  bump the old vs-par-only model produced — that keeps the meaning
 *  of the user-facing `formWeight` (default 0.20) unchanged. */
export const SG_PERSISTENCE_WEIGHTS = {
  ott: 0.65,
  app: 0.6,
  arg: 0.4,
  putt: 0.3,
} as const;
const NEUTRAL_PERSISTENCE =
  (SG_PERSISTENCE_WEIGHTS.ott +
    SG_PERSISTENCE_WEIGHTS.app +
    SG_PERSISTENCE_WEIGHTS.arg +
    SG_PERSISTENCE_WEIGHTS.putt) /
  4;

/** Given a round's SG decomposition, how persistent is this specific
 *  performance? A round of +2 driven entirely by hot putting scores
 *  low (persistence ≈ 0.30); a round of +2 driven by approach scores
 *  high (persistence ≈ 0.60). Weighted by |SG_cat| — the categories
 *  that CONTRIBUTED to this round's SG total drive the persistence
 *  reading. Returns null when there's essentially no SG signal to
 *  weight (all categories near zero). */
export function effectivePersistenceForRound(
  b: RoundSgBreakdown,
): number | null {
  const ott = Math.abs(b.sgOtt ?? 0);
  const app = Math.abs(b.sgApp ?? 0);
  const arg = Math.abs(b.sgArg ?? 0);
  const putt = Math.abs(b.sgPutt ?? 0);
  const total = ott + app + arg + putt;
  if (total < 0.05) return null; // no meaningful signal
  return (
    (ott * SG_PERSISTENCE_WEIGHTS.ott +
      app * SG_PERSISTENCE_WEIGHTS.app +
      arg * SG_PERSISTENCE_WEIGHTS.arg +
      putt * SG_PERSISTENCE_WEIGHTS.putt) /
    total
  );
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
 *  When `weekRoundsSg[i]` is present for a round, that round's raw
 *  excess is multiplied by (effectivePersistence / neutralPersistence)
 *  before averaging — so an approach-driven -6 pushes the form bump
 *  further than a putt-driven -6, but a category-neutral -6 lands in
 *  the same place the old model did.
 *
 *  Returns strokes/round the projection should shift by. Negative =
 *  player has been out-performing → lower expected score.
 */
/** Bayesian prior weight in "equivalent rounds". Controls how much
 *  the form estimator shrinks toward the season baseline when the
 *  player has few completed rounds this week: `effective_weight =
 *  weight × n / (n + PRIOR_N_ROUNDS)`. With PRIOR_N_ROUNDS = 2, one
 *  completed round gets ⅓ of the full weight; two get half; three
 *  get 60% (0.6 × 0.20 = 0.12 effective on the average excess). */
const PRIOR_N_ROUNDS = 2;

function bayesianFormBump(
  weekRounds: number[] | undefined,
  weekRoundsSg: Array<RoundSgBreakdown | null> | undefined,
  sgTotal: number,
  weight: number,
  fieldMeansByRound: Partial<Record<1 | 2 | 3 | 4, number>>,
  /** Mean edge across the field, so a player's expectation for an
   *  observed round is set by how much better he is than the field
   *  he played in — not than the tour. Without it every above-average
   *  player reads as under-performing and picks up a spurious form
   *  penalty. */
  fieldMeanEdge = 0,
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
    const expectedVsPar = fieldMean - (sgTotal - fieldMeanEdge);
    let over = actualVsPar - expectedVsPar; // negative = over-performing

    // Persistence-weight when we have this round's SG decomposition.
    const sg = weekRoundsSg?.[i] ?? null;
    if (sg) {
      const eff = effectivePersistenceForRound(sg);
      if (eff != null) {
        over = over * (eff / NEUTRAL_PERSISTENCE);
      }
    }
    sumOver += over;
  }
  const n = weekRounds.length;
  const meanOver = sumOver / n;
  // Sample-size shrinkage: 1 round of data doesn't count the same as
  // 3. Effective weight ramps up with more rounds observed.
  const sampleShrink = n / (n + PRIOR_N_ROUNDS);
  return weight * sampleShrink * meanOver;
}

// ── Main entry ─────────────────────────────────────────────────────

export async function runForecast(
  input: ForecastInputs,
): Promise<
  | ForecastResponse
  | { ok: false; error: string; newVenue?: boolean }
> {
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
    fieldTeeHoursLocal,
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
  const cfg = await getTournamentConfig(tournamentId);
  if (!cfg) {
    // No historicals on disk for this venue — surface as a specific
    // "new venue" state so the UI can show a helpful message
    // instead of the generic "coefficients unavailable" error.
    return {
      ok: false,
      error:
        "This course is new on the PGA Tour schedule for us — round-score predictions will be available once we've collected a season of history.",
      newVenue: true,
    };
  }
  const par = cfg.coursePar;
  const pars = cfg.courseHolePars;
  const bearings = cfg.holeBearings;
  const coords = coordsForTournamentId(tournamentId);

  const coeffs = await getScoringModel(tournamentId, originUrl);
  if (!coeffs) {
    return { ok: false, error: "Scoring model coefficients unavailable" };
  }
  const bearingsAvailable = bearings && Object.keys(bearings).length > 0;
  if (!bearingsAvailable) {
    warnings.push(
      "Wind adjustment is off — this course's hole bearings haven't been added yet. Forecast is otherwise valid.",
    );
  }
  const histMean = cfg.historicalRoundMeansByRound[targetRound] ?? null;
  const histMedian =
    cfg.historicalRoundMediansByRound[targetRound] ?? null;
  const courseMeanMedianGap = cfg.historicalMeanMedianGap;

  // ── Wind resolution ─────────────────────────────────────────────
  // Target-round date: prefer the config's live round dates if
  // present (the fetch script writes these alongside the historical
  // JSONs); otherwise today's UTC. The fallback is a rough
  // approximation only used when the current tour week hasn't been
  // fully onboarded yet.
  const targetDate =
    cfg.liveRoundDates?.[String(targetRound)] ??
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

  // ── Fetch HRRR hourly once — used both for the field per-hole
  // wind (when tee times supplied) and per-player projections. */
  let hrrrHourlyEarly: HourlyWind[] = [];
  if (coords && !windOverride && useHrrr) {
    try {
      hrrrHourlyEarly = await getHrrrHourlyWind(
        coords.lat,
        coords.lon,
        targetDate,
        coords.tz,
      );
    } catch {
      /* fall back to day-avg */
    }
  }

  /** Per-hole wind: when field tee times are supplied AND HRRR
   *  hourly is available, compute the average wind at each hole's
   *  actual play time (15 min/hole from every tee time in the field,
   *  averaged). Otherwise use the day-average wind. */
  const perHoleWind: Record<number, { windMph: number; windDirDeg: number }> = {};
  const teeTimeAware =
    Array.isArray(fieldTeeHoursLocal) &&
    fieldTeeHoursLocal.length > 0 &&
    hrrrHourlyEarly.length > 0;
  if (teeTimeAware) {
    for (let h = 1; h <= 18; h++) {
      let uSum = 0;
      let vSum = 0;
      let n = 0;
      for (const teeHour of fieldTeeHoursLocal!) {
        const holeHour = teeHour + (h - 1) * 0.25;
        const w = windAtHour(hrrrHourlyEarly, holeHour);
        if (!w) continue;
        const rad = (w.windDirDeg * Math.PI) / 180;
        uSum += w.windMph * Math.cos(rad);
        vSum += w.windMph * Math.sin(rad);
        n += 1;
      }
      if (n === 0) continue;
      const u = uSum / n;
      const v = vSum / n;
      perHoleWind[h] = {
        windMph: Math.hypot(u, v),
        windDirDeg: ((Math.atan2(v, u) * 180) / Math.PI + 360) % 360,
      };
    }
  }

  // ── Per-hole projections + baseline sum ─────────────────────────
  const holeForecasts: HoleForecast[] = [];
  let modelDeltaSum = 0;
  let fieldTotal = 0;

  for (let h = 1; h <= 18; h++) {
    const fit: HoleFit | null = coeffs.holes[h] ?? null;
    if (!fit) continue;
    // Missing bearing → wind term neutralised for this hole. Rest
    // of the fit (pin cluster, yards, base per-hole mean) still
    // applies; the forecast just won't reflect today's wind at
    // this hole. See the "wind adjustment is off" warning we emit
    // upstream when the whole course lacks bearings.
    const bearing = typeof bearings[h] === "number" ? bearings[h] : 0;

    const holePar = pars[h] ?? 4;
    const override = effectiveHoles[h] ?? {};
    const yards = override.yards ?? fit.histMeanYards;

    // Prefer per-hole tee-time-aware wind when available, else fall
    // back to the day-average.
    const holeWind = perHoleWind[h] ?? wind;

    const conditions: TodayConditions = {
      yards,
      windSpeed: holeWind.windMph,
      windDir: holeWind.windDirDeg,
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
      holeWind.windMph *
      Math.cos(((holeWind.windDirDeg - bearing) * Math.PI) / 180);
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
      windMph: holeWind.windMph,
      windDirDeg: holeWind.windDirDeg,
      headwind: head,
      avgVsPar,
      clusterResidual,
      windDelta,
      yardsDelta,
      fitRowCount: fit.rowCount,
      lowSample: fit.rowCount < SAMPLE_LOW_THRESHOLD,
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
    // Weight each hole's contribution by that hole's historical sample
    // size (fit.rowCount). Small-sample holes contribute less so a
    // single unusual pin at a thinly-observed hole can't outsize
    // the round-total level shift.
    let sumWeightedResid = 0;
    let sumWeight = 0;
    let n = 0;
    for (let h = 1; h <= 18; h++) {
      const fit = coeffs.holes[h];
      const bearing = typeof bearings[h] === "number" ? bearings[h] : 0;
      const actualVsPar = obs.vsParByHole[h];
      const yards = obs.setup.yardsByHole[h];
      if (
        !fit ||
        typeof actualVsPar !== "number" ||
        typeof yards !== "number"
      )
        continue;
      // Pin difficulty term — prefer PIN-SPECIFIC historical residual
      // (nearest-neighbour lookup in the fit's historicalPins) so we
      // isolate course-condition residuals from pin-position variance
      // within a cluster. Falls through to cluster residual when the
      // exact pin coord isn't in the historical sample, else to 0.
      let pinTerm = 0;
      const pinCoord = obs.setup.pinByHole?.[h];
      let pinSource: "pin-specific" | "cluster" | "none" = "none";
      if (pinCoord) {
        const specific = pinSpecificResidual(
          fit,
          pinCoord.x,
          pinCoord.y,
          0.05,
          r,
        );
        if (specific && specific.totalWeight >= 40) {
          pinTerm = specific.residual;
          pinSource = "pin-specific";
        }
      }
      if (pinSource === "none") {
        const clusterLetter = obs.setup.clusterByHole?.[h];
        if (clusterLetter && fit.clusterResiduals[clusterLetter] != null) {
          pinTerm = fit.clusterResiduals[clusterLetter];
          pinSource = "cluster";
        }
      }
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
        pinTerm +
        fit.bHead * (head - baseHead) +
        fit.bYards * (yards - baseYards);
      const w = Math.max(1, fit.rowCount);
      sumWeightedResid += (actualVsPar - predicted) * w;
      sumWeight += w;
      n += 1;
    }
    if (n >= 15 && sumWeight > 0) {
      levelShiftPerRound[r] = sumWeightedResid / sumWeight;
    }
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

  // ── HRRR hourly wind — reuse the fetch from the field per-hole
  // block above. `hrrrHourlyEarly` is populated when useHrrr is on
  // AND coords are known; otherwise per-player projections fall
  // back to day-avg wind. */
  const hrrrHourly: HourlyWind[] = hrrrHourlyEarly;

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
      if (!fit) continue;
      const bearing =
        typeof bearings![holeNum] === "number" ? bearings![holeNum] : 0;
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
  // ── Field-strength re-centring ────────────────────────────────
  // sgTotal is measured against a TOUR-WIDE baseline, not against
  // the field in front of us. The course model's field forecast,
  // by contrast, is anchored on what actually got shot at this
  // venue — by whatever calibre of field historically plays it.
  // Subtracting a tour-relative edge from a field-anchored baseline
  // counts the field's strength twice.
  //
  // It shows up as a contradiction the model states out loud: at the
  // 2026 TOUR Championship the field forecast was 68.14 while the
  // mean of the thirty player projections built from it was 67.03.
  // Both describe the same thirty players. East Lake makes it
  // starkest because it hosts nothing but this event, so its entire
  // historical baseline is elite-field scoring — but the same gap
  // exists at every venue, equal to that field's mean edge.
  //
  // Re-centring on the field mean restores the invariant: a player
  // is projected by how much better he is THAN THE PLAYERS HE IS
  // PLAYING AGAINST, and the projections average back to the field
  // forecast by construction.
  const edges = players.map((p) => {
    const defaultCompression = p.sgSource === "event-specific" ? 1.0 : 0.83;
    return p.sgTotal * (p.compressionFactor ?? defaultCompression);
  });
  const fieldMeanEdge =
    edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length : 0;

  const playerForecasts: PlayerForecast[] = [];
  for (const p of players) {
    // Compression default is source-aware. DataGolf's event-specific
    // sgTotal (from decomposition CSV `final_prediction`) already
    // includes course-fit adjustment for THIS event, so applying the
    // venue's compression on top would double-compress. Season-generic
    // SG numbers correctly take the venue compression.
    const defaultCompression = p.sgSource === "event-specific" ? 1.0 : 0.83;
    const compression = p.compressionFactor ?? defaultCompression;
    const compressedEdge = p.sgTotal * compression;
    const formWeight = p.formWeight ?? 0.2;
    const formBump = bayesianFormBump(
      p.weekRounds,
      p.weekRoundsSg,
      p.sgTotal,
      formWeight,
      fieldMeansByRound,
      fieldMeanEdge,
    );
    // Per-round persistence factor for the UI subtitle — 1.0 means
    // the round was category-balanced (behaves like the old model),
    // >1 means the excess came from persistent skills (approach/
    // driving), <1 means it came from putting.
    const formPersistencePerRound: Array<number | null> = (
      p.weekRoundsSg ?? []
    ).map((sg) => {
      if (!sg) return null;
      const eff = effectivePersistenceForRound(sg);
      return eff == null ? null : eff / NEUTRAL_PERSISTENCE;
    });
    // Skew: default to the venue's empirical (mean − median) gap,
    // measured directly from every historical year:round on file
    // (aggregated over ~4400 observations). That's the only
    // sample-size-honest skew signal we have — per-player gaps at
    // n≈40 rounds have a standard error of ~0.5 strokes, so any
    // player-specific fit would be noise. Callers can still supply
    // an explicit `skewAdjustment` override for a player they have
    // a strong prior on. Conditions multiplier still widens the
    // gap on tough days (that's an empirically defensible player-
    // level effect).
    const baseSkew = p.skewAdjustment ?? courseMeanMedianGap;
    const skewConditionMult = conditionsSkewMultiplier(
      fieldForecastVsPar,
      histMean != null ? histMean - par : null,
    );
    const skewGap = baseSkew * skewConditionMult;

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
    const expectedMean =
      playerFieldMean - (compressedEdge - fieldMeanEdge) + formBump;
    const expectedMedian = expectedMean - skewGap;

    // Round-score sigma priority: per-player from historicals →
    // course-baseline. Player-specific always wins when we have
    // enough rounds on file for them (the config gate is ≥4 rounds).
    const playerHistorySigma = p.dgId
      ? cfg.playerRoundScoreSigmaByDgId[p.dgId]
      : undefined;
    const roundScoreSigma =
      typeof playerHistorySigma === "number" && playerHistorySigma > 0
        ? playerHistorySigma
        : cfg.fieldRoundScoreSigmaBaseline;
    const roundScoreSigmaSource: "player-history" | "course-baseline" =
      typeof playerHistorySigma === "number" && playerHistorySigma > 0
        ? "player-history"
        : "course-baseline";
    const probScoreUnder = buildProbScoreUnder(
      expectedMedian,
      roundScoreSigma,
    );

    playerForecasts.push({
      name: p.name,
      dgId: p.dgId,
      sgTotal: p.sgTotal,
      sgTotalAdjusted: compressedEdge - formBump,
      formAdjustment: formBump,
      expectedMean,
      expectedMedian,
      roundScoreSigma,
      roundScoreSigmaSource,
      probScoreUnder,
      dgProbs: p.dgProbs,
      breakdown: {
        fieldMean: playerFieldMean,
        compressedEdge,
        formBump,
        skewGap,
        teeTimeAdjusted,
        teeTimeWind,
        formPersistencePerRound,
      },
    });
  }

  // Apply level shift + pin adder to per-hole outputs proportionally
  // for the response — makes the returned per-hole numbers add up.
  const perHoleAdd = (levelShiftAttenuated + pinDifficultyAdder) / 18;
  for (const h of holeForecasts) {
    h.avgVsPar += perHoleAdd;
  }

  // Field-forecast σ: baseline PGA-tour field-round spread plus an
  // inflation term for thinly-sampled holes. Each low-sample hole
  // contributes ~0.05 strokes of extra uncertainty to the round total.
  const lowSampleHoles = holeForecasts.filter((h) => h.lowSample).length;
  const fieldForecastSigma =
    BASE_FIELD_ROUND_SIGMA + lowSampleHoles * 0.05;

  return {
    ok: true,
    tournamentId,
    targetRound,
    par,
    wind: {
      ...wind,
      source: teeTimeAware
        ? `${windSource} (tee-time-weighted across ${fieldTeeHoursLocal!.length} tee times)`
        : windSource,
    },
    historicalRoundMean: histMean,
    historicalRoundMedian: histMedian,
    historicalMeanMedianGap: courseMeanMedianGap,
    levelShift: rawLevelShift,
    levelShiftAttenuated,
    levelShiftMode: mode,
    levelShiftPerRound,
    pinDifficultyAdder,
    modelDelta: modelDeltaSum,
    fieldForecast,
    fieldForecastVsPar,
    // Median = mean minus the venue's typical (mean − median) gap.
    // Applies the empirical right-skew we've observed across every
    // year at this course on top of today's mean projection.
    fieldForecastMedian: fieldForecast - courseMeanMedianGap,
    fieldForecastSigma,
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
    // history the tee-time-scoring API already pulls. Round dates
    // come from the dynamic tournament-config (populated by the
    // fetch script per tour week).
    const coords = coordsForTournamentId(tournamentId);
    const dailyByRound: Partial<
      Record<1 | 2 | 3 | 4, { windMph: number; windDirDeg: number }>
    > = {};
    const cfgForDates = await getTournamentConfig(tournamentId);
    if (coords) {
      const dates: Record<1 | 2 | 3 | 4, string> = {
        1: "", 2: "", 3: "", 4: "",
      };
      if (cfgForDates?.liveRoundDates) {
        for (const r of [1, 2, 3, 4] as const) {
          dates[r] = cfgForDates.liveRoundDates[String(r)] ?? "";
        }
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
      const pinByHole: Record<number, { x: number; y: number }> = {};
      for (const h of holes) {
        const sc = h.scoringByRound?.[String(r)];
        const yds = h.yardsByRound?.[String(r)];
        const pin = h.pinByRound?.[String(r)];
        if (sc && typeof sc.vsPar === "number") {
          vsParByHole[h.holeNumber] = sc.vsPar;
        }
        if (typeof yds === "number") {
          yardsByHole[h.holeNumber] = yds;
        }
        if (
          pin &&
          typeof pin.x === "number" &&
          typeof pin.y === "number" &&
          pin.x !== -1 &&
          pin.y !== -1
        ) {
          pinByHole[h.holeNumber] = { x: pin.x, y: pin.y };
        }
      }
      if (Object.keys(vsParByHole).length >= 15) {
        out[r] = {
          vsParByHole,
          setup: {
            yardsByHole,
            pinByHole,
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
