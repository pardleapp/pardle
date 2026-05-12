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
  leftEye: number[];
  rightEye: number[];
  mouth: number[];
  /** Inter-eye distance (legacy single-reference fit, unused by the
   *  two-point fit but kept in JSON for tooling / debugging). */
  distance: number;
  angle: number;
  /** Distance from eye-midpoint to mouth midpoint, normalised. */
  eyeMouthDistance: number;
  /** Angle of the eye->mouth vector (degrees, ~90 for upright). */
  eyeMouthAngle: number;
}

// JSON import infers arrays as number[] not tuples — accept and rely
// on the offline extractor always writing exactly two values.
const FACE_ALIGNMENT = rawJson as Record<string, FaceAlignment>;

// Canonical layout: eye-midpoint and mouth-midpoint pinned at fixed
// screen positions. With two reference points anchored, both eye-line
// and face-height land where we want — Phil-vs-Tiger no longer have
// different jaw lengths in the blend.
const CANONICAL_EYE_X = 0.5;
const CANONICAL_EYE_Y = 0.40;
const CANONICAL_MOUTH_X = 0.5;
const CANONICAL_MOUTH_Y = 0.62;
const CANONICAL_EYE_MOUTH_DISTANCE = CANONICAL_MOUTH_Y - CANONICAL_EYE_Y; // 0.22

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

  // Two anchor points: eye-midpoint and mouth-midpoint. We compute the
  // similarity transform (translate + uniform scale + rotation around
  // origin) that maps measured -> canonical for these two points.
  const eyeMidX = (a.leftEye[0] + a.rightEye[0]) / 2;
  const eyeMidY = (a.leftEye[1] + a.rightEye[1]) / 2;
  const mouthX = a.mouth[0];
  const mouthY = a.mouth[1];

  // Measured eye->mouth vector and its canonical equivalent (0, ~0.22).
  const dxMeas = mouthX - eyeMidX;
  const dyMeas = mouthY - eyeMidY;
  const measLen = Math.hypot(dxMeas, dyMeas);
  const dxCanon = CANONICAL_MOUTH_X - CANONICAL_EYE_X; // = 0
  const dyCanon = CANONICAL_MOUTH_Y - CANONICAL_EYE_Y; // = CANONICAL_EYE_MOUTH_DISTANCE
  const canonLen = Math.hypot(dxCanon, dyCanon);

  // Scale = canonical length / measured length. This is the unique scale
  // that makes the two anchor distances equal.
  const scale = canonLen / measLen;

  // Rotation = angle(canon) - angle(meas). For our canonical vector
  // pointing straight down, angle = 90°. We want to rotate the measured
  // vector to match — which de-tilts any head lean using both eye AND
  // mouth as references, more robust than the eye-line angle alone.
  const angleMeas = Math.atan2(dyMeas, dxMeas);
  const angleCanon = Math.atan2(dyCanon, dxCanon);
  const rotateRad = angleCanon - angleMeas;
  const rotateDeg = (rotateRad * 180) / Math.PI;

  // Translate places the eye-midpoint at canonical position. CSS applies
  // transforms right-to-left with origin (0,0): rotate first (around 0,0),
  // then scale, then translate. After rotate + scale around the origin,
  // the measured eye-midpoint sits at scale * R(eyeMid) where R is the
  // rotation matrix.
  const cos = Math.cos(rotateRad);
  const sin = Math.sin(rotateRad);
  const eyeMidRotX = eyeMidX * cos - eyeMidY * sin;
  const eyeMidRotY = eyeMidX * sin + eyeMidY * cos;
  const txPct = (CANONICAL_EYE_X - eyeMidRotX * scale) * 100;
  const tyPct = (CANONICAL_EYE_Y - eyeMidRotY * scale) * 100;

  return {
    transform: `translate(${txPct.toFixed(2)}%, ${tyPct.toFixed(2)}%) scale(${scale.toFixed(4)}) rotate(${rotateDeg.toFixed(2)}deg)`,
    transformOrigin: "0 0",
  };
}

/** Diagnostic: how many pros have alignment data. */
export const alignedPlayerCount = Object.keys(FACE_ALIGNMENT).length;
