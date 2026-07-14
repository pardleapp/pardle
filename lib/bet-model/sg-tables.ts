/**
 * Strokes-gained lookup tables — ported verbatim from
 * `golf-model/src/features/shotlink.py`. These are tour-average
 * expected-strokes-to-hole-out baselines, calibrated against
 * historical ShotLink data. Course-specific overrides layer on top
 * per event; player-skill adjustments live in expected-strokes.ts.
 *
 * All tables are ascending by threshold — walk them and take the
 * first entry whose threshold ≥ the query. Fall through to the
 * DEFAULT constant for values past the last row.
 */

/**
 * Expected strokes-to-hole-out from the FAIRWAY at various yardages.
 * The 15yd bucket for pitches/wedges is < 100yd bucket by design —
 * shorter shots convert slightly better than mid-iron approaches
 * because the player is on the green after this shot and putting
 * from short range.
 */
export const FAIRWAY_BASELINE: Array<[yards: number, expectedStrokes: number]> = [
  [15, 1.98],
  [30, 2.25],
  [50, 2.55],
  [75, 2.70],
  [100, 2.60],
  [125, 2.72],
  [150, 2.83],
  [175, 2.98],
  [200, 3.16],
  [225, 3.35],
  [250, 3.55],
  [275, 3.70],
  [300, 3.84],
  [350, 3.98],
  [400, 4.10],
];
/** Above 400 yds — very rare, treat as par-5 tee shot territory. */
export const FAIRWAY_BASELINE_DEFAULT = 3.95;

/** Additive penalty for landing on non-fairway surfaces. */
export const LIE_PENALTY: Record<string, number> = {
  fairway: 0.0,
  fringe: 0.05,
  rough: 0.22,
  deep_rough: 0.35,
  bunker: 0.28,
  trees: 0.45,
  water: 1.0,
  native: 0.3,
  waste: 0.3,
  penalty: 1.0,
  green: 0.0, // green uses PUTT_TABLE — this is only if we fall through
  unknown: 0.1,
  tee: 0.0,
};

/** Expected putts from various distances in feet. */
export const PUTT_TABLE: Array<[feet: number, expectedPutts: number]> = [
  [2, 1.0],
  [4, 1.01],
  [7, 1.15],
  [10, 1.53],
  [13, 1.62],
  [18, 1.77],
  [25, 1.87],
  [35, 1.92],
  [50, 2.05],
];
export const PUTT_DEFAULT = 2.18; // > 50 ft
export const PUTT_UNKNOWN = 1.8;

/**
 * Putt-skill impact per +1.0 sg_putt (per round), bucketed by
 * distance. From Broadie "Every Shot Counts" + DG research.
 * Sum × freq of putts per round = 1.0 stroke gained.
 */
export const PUTT_SKILL_TABLE: Array<[feet: number, adjPerSg: number]> = [
  [2, 0.014],
  [4, 0.014],
  [7, 0.062],
  [10, 0.062],
  [15, 0.062],
  [18, 0.048],
  [25, 0.021],
  [35, 0.014],
  [50, 0.007],
];
export const PUTT_SKILL_DEFAULT = 0.005;
export const PUTT_SKILL_UNKNOWN = 0.015;

/** Divisors converting DG per-round SG into per-shot adjustment. */
export const APPROACHES_PER_ROUND = 14;
export const ARG_SHOTS_PER_ROUND = 6;
