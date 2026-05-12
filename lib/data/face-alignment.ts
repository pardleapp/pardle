/**
 * Per-pro face-alignment metadata, generated offline by
 * scripts/extract_face_alignment.py using mediapipe's FaceLandmarker.
 *
 * For each PGA Tour ID we store the detected eye-centre positions and
 * inter-eye distance, all normalised to the 400x400 cropped headshot.
 * At render time we compose a CSS transform that:
 *   1. Translates the image so the midpoint between the eyes lands at
 *      a fixed CANONICAL position on the stage.
 *   2. Scales the image so the inter-eye distance matches a fixed
 *      CANONICAL value across every pro.
 *   3. Rotates to flatten any head-tilt back to horizontal.
 *
 * Result: when two pros are blended, their eyes (and by extension nose
 * and mouth) sit on top of each other. The blend reads as one face,
 * not two overlapping silhouettes.
 *
 * To refresh / extend: add IDs to PGA_TOUR_IDS, then run
 *   python scripts/extract_face_alignment.py
 */

import rawJson from "./face-alignment.json";

interface FaceAlignment {
  /** Eye centre on the SCREEN-LEFT (subject's right), x/y normalised [0,1]. */
  leftEye: [number, number];
  /** Eye centre on the SCREEN-RIGHT (subject's left). */
  rightEye: [number, number];
  /** Distance between the two eye centres, normalised. */
  distance: number;
  /** Head tilt in degrees. Positive = right eye lower than left. */
  angle: number;
}

const FACE_ALIGNMENT = rawJson as Record<string, FaceAlignment>;

// Canonical screen position the eyes should land at after alignment.
// Eye Y at ~43% from the top puts the bridge of the nose roughly at
// the visual centre, which is what a clean portrait crop looks like.
// Inter-eye distance of 0.20 (20% of stage width) is the median across
// our pool so most pros need only a small scale tweak.
const CANONICAL_EYE_X = 0.5;
const CANONICAL_EYE_Y = 0.43;
const CANONICAL_DISTANCE = 0.2;

export interface AlignedTransform {
  /** Inline CSS `transform` value, e.g. "translate(8px, -4px) scale(1.12) rotate(-1.5deg)". */
  transform: string;
  /** Companion `transform-origin` — top-left so the maths is simple. */
  transformOrigin: string;
}

/**
 * Compute the per-face CSS transform that aligns this pro's eyes onto
 * the canonical canvas position. Returns null if we don't have
 * alignment data for this PGA Tour ID — caller should fall back to the
 * un-transformed image (still better than nothing).
 *
 * Output uses percentages so the same transform string works at any
 * canvas size — translate(X%) is relative to the img's own width, and
 * the img is sized 100% of the canvas, so 1 % of the img = 1 % of the
 * canvas. No render-time pixel measurement needed.
 */
export function alignmentTransform(
  pgaTourId: string,
): AlignedTransform | null {
  const a = FACE_ALIGNMENT[pgaTourId];
  if (!a) return null;

  const eyeMidX = (a.leftEye[0] + a.rightEye[0]) / 2;
  const eyeMidY = (a.leftEye[1] + a.rightEye[1]) / 2;
  const measuredD = a.distance;

  const scale = CANONICAL_DISTANCE / measuredD;
  const rotateDeg = -a.angle;

  // With transform-origin (0, 0), CSS applies transforms right-to-left:
  // rotate first, then scale, then translate. After rotate + scale the
  // eye midpoint sits at (eyeMid * scale); translate moves it onto the
  // canonical canvas position. Small rotation's effect on midpoint
  // position is negligible at the tilts we see (max ~5°).
  const txPct = (CANONICAL_EYE_X - eyeMidX * scale) * 100;
  const tyPct = (CANONICAL_EYE_Y - eyeMidY * scale) * 100;

  return {
    transform: `translate(${txPct.toFixed(2)}%, ${tyPct.toFixed(2)}%) scale(${scale.toFixed(4)}) rotate(${rotateDeg.toFixed(2)}deg)`,
    transformOrigin: "0 0",
  };
}

/** Diagnostic: how many pros have alignment data. */
export const alignedPlayerCount = Object.keys(FACE_ALIGNMENT).length;
