/**
 * Tour-wide baseline make rates by putt distance. Public figures from
 * PGA Tour's published ShotLink aggregates — these are slowly-changing
 * averages (basically static within a season) so we hardcode them
 * here rather than fetching.
 *
 * Used by the putt-poll widget to anchor "will it drop?" with the
 * actual tour-average make rate at the polled distance, plus the
 * player's putting SG for the week so the bettor can calibrate
 * against the field.
 */

/** (distance ft, make rate 0..1) anchor points — PGA Tour 2024 averages. */
const PUTT_MAKE_ANCHORS: Array<[number, number]> = [
  [1, 0.99],
  [2, 0.98],
  [3, 0.96],
  [4, 0.88],
  [5, 0.78],
  [6, 0.67],
  [7, 0.58],
  [8, 0.5],
  [9, 0.45],
  [10, 0.4],
  [12, 0.31],
  [15, 0.22],
  [18, 0.17],
  [20, 0.14],
  [25, 0.09],
  [30, 0.06],
  [35, 0.04],
  [40, 0.03],
  [50, 0.02],
  [70, 0.01],
];

/**
 * Linear-interpolated tour-average make rate at `distanceFt`. Clamps
 * to the endpoints of the anchor table. Returns null for clearly bad
 * inputs.
 */
export function tourPuttMakeRate(distanceFt: number): number | null {
  if (!Number.isFinite(distanceFt) || distanceFt <= 0) return null;
  if (distanceFt <= PUTT_MAKE_ANCHORS[0][0]) return PUTT_MAKE_ANCHORS[0][1];
  for (let i = 1; i < PUTT_MAKE_ANCHORS.length; i++) {
    const [d1, r1] = PUTT_MAKE_ANCHORS[i - 1];
    const [d2, r2] = PUTT_MAKE_ANCHORS[i];
    if (distanceFt <= d2) {
      const t = (distanceFt - d1) / (d2 - d1);
      return r1 + t * (r2 - r1);
    }
  }
  return PUTT_MAKE_ANCHORS[PUTT_MAKE_ANCHORS.length - 1][1];
}
