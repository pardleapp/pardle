/**
 * Course-fit FORECAST (the actionable, predictive layer on top of the
 * descriptive archetype).
 *
 * The archetype panel answers: "what shape of ball flight fits this
 * course?" (correlation r between OTT outperformance and each radar
 * dimension across matched players).
 *
 * This module answers the next question: "given THIS player's radar
 * profile, how much better than his own SG:OTT baseline will he play
 * at THIS course?" Same underlying data, but the archetype's r gets
 * upgraded into a per-player prediction via a weighted least-squares
 * fit.
 *
 * Method — mirrors scripts/predict-course-fit.py:
 *   residual_i = β₀ + β_bs · z_ballSpeed_i + β_ap · z_apex_i
 *                + β_cv · z_curve_i + ε_i
 *
 *   sqrt(n_rounds_at_course) weighted, so a player with 20 course
 *   rounds outvotes a player with 4 rounds by ~2×.
 *
 *   5-fold CV R² is reported honestly so the UI can gate the forecast
 *   behind a reliability floor (courses with CV R² below the floor
 *   render as "no reliable driver-shape signal here").
 *
 * Reads: getCourseArchetype() output (which already builds the
 * matched-player pool + z-scores via getTourStats).
 */

import { Redis } from "@upstash/redis";
import {
  getTeeShots,
  getPlayerName,
  listRankedPlayers,
} from "@/lib/feed/tee-shots-store";
import {
  buildProfile,
  PROFILE_DIMENSIONS,
  type PlayerDrivingProfile,
  type ProfileDimension,
} from "@/lib/feed/tee-shots-profile";
import { getCourseHistoryByCourse } from "./index";

const redis = (() => {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
})();

const CACHE_TTL_TOUR_STATS = 24 * 60 * 60;
const CACHE_TTL_FORECAST = 6 * 60 * 60;
const KEY_TOUR_STATS = "course-history:tour-stats:v1"; // shared with archetype
const KEY_FORECAST = (courseName: string) =>
  `course-history:forecast:v2:${slugify(courseName)}`;

const MIN_SHOTS_PER_PLAYER = 100;
const MIN_ROUNDS_AT_COURSE = 3; // matches scripts/predict-course-fit.py
const MIN_TRAINING_ROWS = 12; // below this the WLS fit is too flimsy
/** The three dimensions the Python script found were the actionable
 *  course-fit signals. Same three the archetype panel marks as KEY. */
const FIT_DIMENSIONS: ProfileDimension[] = [
  "ballSpeed",
  "apexHeight",
  "curve",
];
/** Below this CV R² we don't trust the forecast for surfacing per-
 *  player numbers. The archetype's descriptive r still shows.
 *
 *  Calibration: with the full 4-season tee-shot backfill in place,
 *  the 3-feature radar model tops out at CV R² ≈ 0.05-0.08 even at
 *  courses where the ballSpeed β is unambiguously strong (Quail
 *  Hollow +0.120, Augusta +0.116). Setting the gate at 0.03 lets
 *  those defensible fits through while still excluding the
 *  courses whose CV R² is genuinely negative (Muirfield, Pebble,
 *  Scottsdale) where the radar features carry no signal. */
export const FORECAST_RELIABLE_R2 = 0.03;

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── Cached tour stats (shared with archetype) ─────────────────────

interface TourStatsRow {
  dim: ProfileDimension;
  tourMean: number;
  tourStd: number;
  samplePlayers: number;
}
type TourStats = Record<ProfileDimension, TourStatsRow>;

/** Concurrency cap for player-profile fetches. Upstash tolerates a
 *  few dozen concurrent HTTP round-trips; ~20 keeps latency low
 *  without tripping their rate limiter. */
const PROFILE_FETCH_CONCURRENCY = 24;

async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function getTourStats(): Promise<TourStats | null> {
  if (redis) {
    const cached = await redis
      .get<TourStats>(KEY_TOUR_STATS)
      .catch(() => null);
    if (cached) return cached;
  }
  // Cold-path build. Same code the archetype module uses; kept here
  // so this module can run standalone (both cache into the same
  // Redis key so we only warm once per 24h).
  const ranked = await listRankedPlayers(600);
  const eligible = ranked.filter((r) => r.shotCount >= MIN_SHOTS_PER_PLAYER);
  if (eligible.length === 0) return null;
  const perDim: Record<ProfileDimension, number[]> = Object.fromEntries(
    PROFILE_DIMENSIONS.map((d) => [d, [] as number[]]),
  ) as Record<ProfileDimension, number[]>;
  const perPlayer = await mapWithConcurrency(
    eligible,
    PROFILE_FETCH_CONCURRENCY,
    async (p) => {
      const [records, name] = await Promise.all([
        getTeeShots(p.playerId),
        getPlayerName(p.playerId),
      ]);
      if (!records || records.length === 0) return null;
      return buildProfile(p.playerId, name ?? p.playerId, records, 0);
    },
  );
  for (const prof of perPlayer) {
    if (!prof) continue;
    for (const d of PROFILE_DIMENSIONS) {
      const v = prof.stats[d]?.mean;
      if (Number.isFinite(v)) perDim[d].push(v);
    }
  }
  const stats = {} as TourStats;
  for (const d of PROFILE_DIMENSIONS) {
    const arr = perDim[d];
    if (arr.length < 3) {
      stats[d] = { dim: d, tourMean: 0, tourStd: 0, samplePlayers: arr.length };
      continue;
    }
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance =
      arr.reduce((a, v) => a + (v - mean) ** 2, 0) / arr.length;
    stats[d] = {
      dim: d,
      tourMean: mean,
      tourStd: Math.sqrt(variance),
      samplePlayers: arr.length,
    };
  }
  if (redis) {
    await redis
      .set(KEY_TOUR_STATS, stats, { ex: CACHE_TTL_TOUR_STATS })
      .catch(() => null);
  }
  return stats;
}

// ── Weighted least squares ─────────────────────────────────────────

/** Solve Aβ = b for β via Gaussian elimination with partial pivoting.
 *  A is p×p, b is length p. Handles the small (4×4) matrix WLS
 *  produces without pulling in a numeric lib. */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  // Augmented matrix.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    // Pivot: swap in the row with the largest |M[k][i]| below.
    let maxRow = i;
    let maxAbs = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      const v = Math.abs(M[k][i]);
      if (v > maxAbs) {
        maxAbs = v;
        maxRow = k;
      }
    }
    if (maxAbs < 1e-12) return null; // singular
    if (maxRow !== i) [M[i], M[maxRow]] = [M[maxRow], M[i]];
    // Eliminate.
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  // Back-substitute.
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x;
}

interface WlsResult {
  betas: number[]; // length p+1 (intercept first, then features in order)
  r2: number;
}

/** Weighted least-squares fit. X is n×p (features only, intercept
 *  added), y and w are length n. Weights w are used in-place — the
 *  Python impl weighted by sqrt(n_rounds), and we passed w = sqrt(n)
 *  already, so this weights by w². */
function fitWLS(X: number[][], y: number[], w: number[]): WlsResult | null {
  const n = X.length;
  if (n === 0) return null;
  const p = X[0].length + 1; // + intercept
  const XtWX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const XtWy: number[] = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const w2 = w[i] * w[i];
    const row = [1, ...X[i]];
    for (let a = 0; a < p; a++) {
      XtWy[a] += w2 * row[a] * y[i];
      for (let b = 0; b < p; b++) {
        XtWX[a][b] += w2 * row[a] * row[b];
      }
    }
  }
  const betas = solveLinearSystem(XtWX, XtWy);
  if (!betas) return null;
  // Weighted R²
  const w2Sum = w.reduce((a, v) => a + v * v, 0);
  const yMean =
    y.reduce((a, v, i) => a + v * w[i] * w[i], 0) / w2Sum;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const row = [1, ...X[i]];
    const yhat = row.reduce((a, x, j) => a + x * betas[j], 0);
    const w2 = w[i] * w[i];
    ssRes += w2 * (y[i] - yhat) ** 2;
    ssTot += w2 * (y[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { betas, r2 };
}

/** 5-fold CV R² with deterministic interleaved fold assignment
 *  (foldOf(i) = i % k). Matches the Python impl's outcome for the
 *  metric that matters (out-of-sample explained variance). */
function crossValidateR2(
  X: number[][],
  y: number[],
  w: number[],
  folds = 5,
): number {
  const n = X.length;
  if (n < folds * 2) return 0;
  let ssRes = 0;
  const w2Sum = w.reduce((a, v) => a + v * v, 0);
  const yMeanAll =
    y.reduce((a, v, i) => a + v * w[i] * w[i], 0) / w2Sum;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssTot += w[i] * w[i] * (y[i] - yMeanAll) ** 2;
  }
  for (let f = 0; f < folds; f++) {
    const trX: number[][] = [];
    const trY: number[] = [];
    const trW: number[] = [];
    const teIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i % folds === f) teIdx.push(i);
      else {
        trX.push(X[i]);
        trY.push(y[i]);
        trW.push(w[i]);
      }
    }
    const fit = fitWLS(trX, trY, trW);
    if (!fit) continue;
    for (const i of teIdx) {
      const row = [1, ...X[i]];
      const yhat = row.reduce((a, x, j) => a + x * fit.betas[j], 0);
      ssRes += w[i] * w[i] * (y[i] - yhat) ** 2;
    }
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

// ── Course forecast ───────────────────────────────────────────────

export interface CourseForecastBetas {
  intercept: number;
  ballSpeed: number;
  apexHeight: number;
  curve: number;
}

export interface CourseForecastPlayer {
  name: string;
  playerId: string;
  /** True when this player has enough rounds at the target course to
   *  appear in the model's training set. */
  isTrainingSample: boolean;
  roundsAtCourse: number;
  /** Player's z-scored radar dims (used for prediction). */
  zBallSpeed: number;
  zApexHeight: number;
  zCurve: number;
  /** Model's predicted per-round SG:OTT residual for this player. */
  predictedResidualPerRd: number;
  /** For training-sample players only: their actual historical
   *  residual at the course (baseline: player's own out-of-course
   *  SG:OTT). Null for prediction-only players. */
  actualResidualPerRd: number | null;
}

export interface CourseForecastResponse {
  courseName: string;
  fit: {
    n: number;
    r2Train: number;
    r2Cv: number;
    reliable: boolean;
    betas: CourseForecastBetas;
    dims: ProfileDimension[];
  };
  /** Every player with a radar profile (min 100 shots) — includes
   *  both training-sample players AND prediction-only players.
   *  Sorted by predictedResidualPerRd descending. */
  players: CourseForecastPlayer[];
}

export async function getCourseForecast(
  courseName: string,
): Promise<CourseForecastResponse | null> {
  const cleanCourse = courseName.trim();
  if (!cleanCourse) return null;
  if (redis) {
    const cached = await redis
      .get<CourseForecastResponse>(KEY_FORECAST(cleanCourse))
      .catch(() => null);
    if (cached) return cached;
  }

  const [history, tourStats, ranked] = await Promise.all([
    getCourseHistoryByCourse(cleanCourse),
    getTourStats(),
    listRankedPlayers(600),
  ]);
  if (!history || !tourStats) return null;

  // Assemble the profile pool once — everyone with ≥MIN_SHOTS is a
  // prediction candidate even if they've never played the course.
  // Parallelised: one round-trip pair (shots + name) per player,
  // capped concurrency. Sequential was pushing cold-path past 60s
  // once the profile pool grew past ~400 players.
  interface PlayerRecord {
    name: string;
    playerId: string;
    profile: PlayerDrivingProfile;
    z: { ballSpeed: number; apexHeight: number; curve: number };
  }
  const eligibleRanked = ranked.filter(
    (r) => r.shotCount >= MIN_SHOTS_PER_PLAYER,
  );
  const zOf = (
    profile: PlayerDrivingProfile,
    d: ProfileDimension,
  ): number => {
    const t = tourStats[d];
    if (!t || t.tourStd <= 0) return 0;
    const v = profile.stats[d]?.mean;
    if (!Number.isFinite(v)) return 0;
    return (v - t.tourMean) / t.tourStd;
  };
  const perPlayerRecs = await mapWithConcurrency(
    eligibleRanked,
    PROFILE_FETCH_CONCURRENCY,
    async (r): Promise<PlayerRecord | null> => {
      const [records, name] = await Promise.all([
        getTeeShots(r.playerId),
        getPlayerName(r.playerId),
      ]);
      if (!records || records.length < MIN_SHOTS_PER_PLAYER) return null;
      const profile = buildProfile(
        r.playerId,
        name ?? r.playerId,
        records,
        0,
      );
      return {
        name: name ?? r.playerId,
        playerId: r.playerId,
        profile,
        z: {
          ballSpeed: zOf(profile, "ballSpeed"),
          apexHeight: zOf(profile, "apexHeight"),
          curve: zOf(profile, "curve"),
        },
      };
    },
  );
  const players: PlayerRecord[] = [];
  const playerByNormName = new Map<string, PlayerRecord>();
  for (const rec of perPlayerRecs) {
    if (!rec) continue;
    players.push(rec);
    playerByNormName.set(normaliseName(rec.name), rec);
  }
  if (players.length === 0) return null;

  // Match course-history players onto the profile pool → training set.
  interface TrainingRow {
    playerId: string;
    name: string;
    roundsAtCourse: number;
    residual: number; // outperformanceSgOtt — the player's own baseline
    z: PlayerRecord["z"];
  }
  const training: TrainingRow[] = [];
  for (const p of history.players) {
    if (p.roundsPlayed < MIN_ROUNDS_AT_COURSE) continue;
    const key = normaliseName(p.name);
    const rec = playerByNormName.get(key);
    if (!rec) continue;
    training.push({
      playerId: rec.playerId,
      name: p.name,
      roundsAtCourse: p.roundsPlayed,
      residual: p.outperformanceSgOtt,
      z: rec.z,
    });
  }
  if (training.length < MIN_TRAINING_ROWS) return null;

  // Fit the WLS.
  const X = training.map((t) => [t.z.ballSpeed, t.z.apexHeight, t.z.curve]);
  const y = training.map((t) => t.residual);
  const w = training.map((t) => Math.sqrt(t.roundsAtCourse));
  const wls = fitWLS(X, y, w);
  if (!wls) return null;
  const r2Cv = crossValidateR2(X, y, w, 5);

  const betas: CourseForecastBetas = {
    intercept: wls.betas[0],
    ballSpeed: wls.betas[1],
    apexHeight: wls.betas[2],
    curve: wls.betas[3],
  };

  // Actual-residual lookup for the training-sample players.
  const actualByPlayerId = new Map<string, number>();
  for (const t of training) actualByPlayerId.set(t.playerId, t.residual);
  const trainingIds = new Set(training.map((t) => t.playerId));
  const trainingRoundsById = new Map(
    training.map((t) => [t.playerId, t.roundsAtCourse]),
  );

  const predict = (z: PlayerRecord["z"]): number =>
    betas.intercept +
    betas.ballSpeed * z.ballSpeed +
    betas.apexHeight * z.apexHeight +
    betas.curve * z.curve;

  const outPlayers: CourseForecastPlayer[] = players.map((p) => ({
    name: p.name,
    playerId: p.playerId,
    isTrainingSample: trainingIds.has(p.playerId),
    roundsAtCourse: trainingRoundsById.get(p.playerId) ?? 0,
    zBallSpeed: p.z.ballSpeed,
    zApexHeight: p.z.apexHeight,
    zCurve: p.z.curve,
    predictedResidualPerRd: predict(p.z),
    actualResidualPerRd: actualByPlayerId.get(p.playerId) ?? null,
  }));
  outPlayers.sort(
    (a, b) => b.predictedResidualPerRd - a.predictedResidualPerRd,
  );

  const response: CourseForecastResponse = {
    courseName: cleanCourse,
    fit: {
      n: training.length,
      r2Train: wls.r2,
      r2Cv,
      reliable: r2Cv >= FORECAST_RELIABLE_R2,
      betas,
      dims: FIT_DIMENSIONS,
    },
    players: outPlayers,
  };
  if (redis) {
    await redis
      .set(KEY_FORECAST(cleanCourse), response, { ex: CACHE_TTL_FORECAST })
      .catch(() => null);
  }
  return response;
}
