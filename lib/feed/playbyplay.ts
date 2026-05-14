/**
 * Parse the PGA Tour orchestrator's `playByPlay` text.
 *
 * Observed live formats (PGA Championship 2026):
 *   "129 yds to left fairway, 63 ft 10 in. to hole"
 *   "127 yds to right green, 7 ft 2 in. to hole"
 *   "Waiting to tee off"
 *
 * Shape: "{distance} {yds|ft} to {location}, {proximity} to hole" where
 * proximity is "{ft} ft {in} in.", "{ft} ft", or "{in} in.".
 *
 * We use this to spot stuffed approaches — a full-swing shot (measured
 * in yards) that finishes on the green close to the hole.
 */

export interface ParsedShot {
  /** Distance of the shot just hit, in yards — null if it was a putt/chip (ft). */
  shotYards: number | null;
  /** True when the shot distance was given in yards (a full swing). */
  fullSwing: boolean;
  /** True when the resting location text mentions the green. */
  onGreen: boolean;
  /** Resulting distance to the hole, in inches — null if unparseable. */
  proximityInches: number | null;
}

const SHOT_RE = /^(\d+)\s*(yds|ft)\s+to\s+([a-z ]+?),/i;
// Matches "63 ft 10 in.", "7 ft 2 in.", "10 ft", "2 in." before "to hole".
const PROX_RE =
  /(?:(\d+)\s*ft)?\s*(?:(\d+)\s*in)?\.?\s+to hole/i;

export function parsePlayByPlay(text: string | null): ParsedShot | null {
  if (!text) return null;
  const t = text.trim();
  if (!t || /waiting to tee/i.test(t)) return null;

  const shot = SHOT_RE.exec(t);
  const prox = PROX_RE.exec(t);
  if (!shot && !prox) return null;

  let shotYards: number | null = null;
  let fullSwing = false;
  let onGreen = false;
  if (shot) {
    const dist = Number(shot[1]);
    const unit = shot[2].toLowerCase();
    const location = shot[3].toLowerCase();
    fullSwing = unit === "yds";
    shotYards = fullSwing && Number.isFinite(dist) ? dist : null;
    onGreen = location.includes("green");
  }

  let proximityInches: number | null = null;
  if (prox) {
    const ft = prox[1] ? Number(prox[1]) : 0;
    const inch = prox[2] ? Number(prox[2]) : 0;
    if (prox[1] || prox[2]) {
      proximityInches = ft * 12 + inch;
    }
  }

  return { shotYards, fullSwing, onGreen, proximityInches };
}

/** Inches → a friendly "4 ft" / "7 ft 2 in" string. */
export function formatProximity(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  if (ft === 0) return `${inch} in`;
  if (inch === 0) return `${ft} ft`;
  return `${ft} ft ${inch} in`;
}

/** A full-swing approach that finished on the green inside this is a highlight. */
export const STUFFED_THRESHOLD_INCHES = 60; // 5 feet
/** Inside this is "dead stiff" — bumped emoji + interest. */
export const STIFF_THRESHOLD_INCHES = 24; // 2 feet
