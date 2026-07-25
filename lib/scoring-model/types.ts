/**
 * Shared types for the scoring model — per-hole regression on
 * field-average strokes-vs-par, with wind and pin adjustments.
 */

/** One historical observation used to fit the per-hole regression.
 *  Each pin position × round it was used = one row. */
export interface FitRow {
  /** Cluster index (0-based) within the hole's cluster array. */
  clusterIdx: number;
  /** Round number (1-4) this observation came from. Used to build
   *  round-specific baselines — R3s at 3M Open play systematically
   *  softer than R1s, so a projection for R3 should anchor on the
   *  R3-only mean, not the all-rounds mean. */
  round: number;
  /** Hole yardage played that round. */
  yards: number;
  /** Headwind component (mph, sign carries direction) for that round.
   *  Positive = into the wind; negative = tailwind. */
  headwind: number;
  /** Field-average strokes-vs-par at this pin across ALL rounds it
   *  was used. The dependent variable. */
  avgVsPar: number;
  /** Sample-size weight for this pin (number of player rounds behind
   *  the avgVsPar figure). Rows are weighted by sqrt(total) in WLS. */
  total: number;
}

/** Fitted coefficients + baseline stats for one hole. */
export interface HoleFit {
  /** Regression coefficient: strokes-vs-par per yard of hole length. */
  bYards: number;
  /** Regression coefficient: strokes-vs-par per mph of headwind. */
  bHead: number;
  /** Intercept — needed for absolute predictions but usually not used
   *  by callers (deltas are what matter). */
  intercept: number;
  /** Weighted mean residual per cluster (after yards + wind fit).
   *  Keys are cluster letters (A, B, C, ...). This is the "pin
   *  intrinsic difficulty" signal. */
  clusterResiduals: Record<string, number>;
  /** Centroid coordinates (x, y in 0-1 normalised green frame) per
   *  cluster. Used to auto-match today's pin to a cluster letter. */
  clusterCentroids: Record<string, { x: number; y: number }>;
  /** Historical mean hole yardage across all rounds in the fit. Used
   *  as the reference point for the yardage-delta term. */
  histMeanYards: number;
  /** Historical mean headwind across all rounds in the fit. Used as
   *  the reference point for the wind-delta term. */
  histMeanHead: number;
  /** Historical mean avg-vs-par across all pins × rounds (weighted).
   *  Used as the baseline for absolute-prediction callers when no
   *  round-specific baseline is available. */
  histMeanAvgVsPar: number;
  /** Per-round historical mean avg-vs-par (weighted). Populated when
   *  the round has ≥3 fit rows; otherwise omitted so callers can
   *  fall back to histMeanAvgVsPar. This captures the systematic
   *  round-to-round difference — e.g. R3 at 3M Open plays about
   *  a stroke below the all-rounds mean. */
  histMeanAvgVsParByRound: Partial<Record<1 | 2 | 3 | 4, number>>;
  /** Per-round historical mean yardage (weighted). Populated when
   *  the per-round sample supports it. */
  histMeanYardsByRound: Partial<Record<1 | 2 | 3 | 4, number>>;
  /** Per-round historical mean headwind (weighted). */
  histMeanHeadByRound: Partial<Record<1 | 2 | 3 | 4, number>>;
  /** Number of fit rows. Below ~6 the fit is unreliable. */
  rowCount: number;
}

/** Full coefficient set for one tournament — one HoleFit per hole,
 *  keyed by hole number (1-18). Some holes may be null if we didn't
 *  have enough data to fit. */
export type ScoringModelCoefficients = {
  tournamentId: string;
  /** ISO timestamp — when this fit was computed. Callers use it for
   *  cache invalidation. */
  fittedAt: string;
  holes: Record<number, HoleFit | null>;
};

/** Today's conditions on one hole — inputs to the projection. */
export interface TodayConditions {
  /** Today's tee-block yardage for this hole. */
  yards: number;
  /** Wind speed in mph at the time we're projecting for. */
  windSpeed: number;
  /** Wind direction in degrees (0-360, meteorological FROM). */
  windDir: number;
  /** Today's pin position on the green (0-1 normalised). Used to
   *  auto-match to a cluster. Optional — if omitted, cluster
   *  residual = 0 (i.e. no pin adjustment). */
  pinX?: number;
  pinY?: number;
}

/** Live-round observation on one hole so far — used to blend the
 *  model prediction with real data as it comes in. */
export interface LiveSample {
  /** Field average score-vs-par observed on this hole in the current
   *  round so far. */
  avgVsPar: number;
  /** Number of players who have finished the hole. */
  count: number;
}

/** Return type of projectHoleAvgToPar. Exposes both the raw model
 *  prediction and the blended output so callers can log the split. */
export interface HoleProjection {
  /** Blended avg-vs-par prediction (this is what most callers want). */
  avgVsPar: number;
  /** Model-only prediction (no live-data blend). */
  modelAvgVsPar: number;
  /** How much of the final answer came from live data (0 = pure
   *  model, 1 = pure live). */
  liveWeight: number;
  /** Cluster letter matched from pinX/pinY, if provided. */
  matchedCluster: string | null;
  /** Distance from today's pin to the nearest cluster centroid. High
   *  values (>0.15) indicate the match is ambiguous. */
  clusterMatchDistance: number | null;
}
