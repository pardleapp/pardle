"use client";

import Delaunator from "delaunator";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import faceLandmarksRaw from "@/lib/data/face-landmarks.json";
import { GOLFERS } from "@/lib/data/golfers";
import {
  PGA_TOUR_IDS,
  pgaTourHeadshotUrlById,
} from "@/lib/data/pga-tour-ids";
import { searchableName } from "@/lib/text";

const PRO_LANDMARKS = faceLandmarksRaw as Record<string, number[][]>;

const OUT_SIZE = 800;

// mediapipe FACEMESH_FACE_OVAL — closed loop of indices tracing the
// jawline + hairline. Used to mask the morph to just the face area.
const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397,
  365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58,
  132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

// ── helpers ────────────────────────────────────────────────────────

function loadImage(src: string, crossOrigin = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function downscale(img: HTMLImageElement, maxDim = 1200): HTMLCanvasElement {
  const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return c;
}

/** Mild skin-smoothing on the user selfie by downscaling 2x then back
 *  up with browser bicubic. Effectively a soft Gaussian blur. Hides
 *  the small noise / blemishes / harsh shadows that make raw selfies
 *  look worse than studio shots, without losing the structure that
 *  mediapipe needs to detect landmarks. Standard beauty-app trick. */
function softenSelfie(src: HTMLCanvasElement, factor = 1.7): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = Math.max(64, Math.round(src.width / factor));
  small.height = Math.max(64, Math.round(src.height / factor));
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, 0, 0, small.width, small.height);

  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

/** Affine transform matrix that maps source triangle to dest triangle.
 *  Returns [a, b, c, d, e, f] for canvas setTransform: x'=a*x+c*y+e. */
function getAffineTransform(
  src: number[][],
  dst: number[][],
): number[] | null {
  const [sx1, sy1] = src[0];
  const [sx2, sy2] = src[1];
  const [sx3, sy3] = src[2];
  const [dx1, dy1] = dst[0];
  const [dx2, dy2] = dst[1];
  const [dx3, dy3] = dst[2];
  const det = sx1 * (sy2 - sy3) + sx2 * (sy3 - sy1) + sx3 * (sy1 - sy2);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  return [
    (dx1 * (sy2 - sy3) + dx2 * (sy3 - sy1) + dx3 * (sy1 - sy2)) * inv,
    (dy1 * (sy2 - sy3) + dy2 * (sy3 - sy1) + dy3 * (sy1 - sy2)) * inv,
    (dx1 * (sx3 - sx2) + dx2 * (sx1 - sx3) + dx3 * (sx2 - sx1)) * inv,
    (dy1 * (sx3 - sx2) + dy2 * (sx1 - sx3) + dy3 * (sx2 - sx1)) * inv,
    (dx1 * (sx2 * sy3 - sx3 * sy2) +
      dx2 * (sx3 * sy1 - sx1 * sy3) +
      dx3 * (sx1 * sy2 - sx2 * sy1)) *
      inv,
    (dy1 * (sx2 * sy3 - sx3 * sy2) +
      dy2 * (sx3 * sy1 - sx1 * sy3) +
      dy3 * (sx1 * sy2 - sx2 * sy1)) *
      inv,
  ];
}

/** Expand a triangle outward from its centroid by `amount` pixels.
 *  Used so adjacent triangle clips overlap a hair — otherwise the clip
 *  antialiasing leaves visible seams along every shared edge. */
function expandTriangle(tri: number[][], amount: number): number[][] {
  const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
  const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
  return tri.map((p) => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return p;
    return [p[0] + (dx / len) * amount, p[1] + (dy / len) * amount];
  });
}

/** Warp `img` so its landmarks `srcLm` land where `dstLm` are, using
 *  the given triangulation. Returns an offscreen canvas of `size x size`. */
function warpFace(
  img: HTMLImageElement | HTMLCanvasElement,
  srcLm: number[][],
  dstLm: number[][],
  triangles: Uint32Array,
  size: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const iw = img.width;
  const ih = img.height;
  for (let t = 0; t < triangles.length; t += 3) {
    const i1 = triangles[t];
    const i2 = triangles[t + 1];
    const i3 = triangles[t + 2];
    if (!srcLm[i1] || !srcLm[i2] || !srcLm[i3]) continue;
    if (!dstLm[i1] || !dstLm[i2] || !dstLm[i3]) continue;
    const src = [
      [srcLm[i1][0] * iw, srcLm[i1][1] * ih],
      [srcLm[i2][0] * iw, srcLm[i2][1] * ih],
      [srcLm[i3][0] * iw, srcLm[i3][1] * ih],
    ];
    const dst = [
      [dstLm[i1][0] * size, dstLm[i1][1] * size],
      [dstLm[i2][0] * size, dstLm[i2][1] * size],
      [dstLm[i3][0] * size, dstLm[i3][1] * size],
    ];
    const m = getAffineTransform(src, dst);
    if (!m) continue;
    // Affine is computed from the ORIGINAL triangle pair so pixel
    // mapping stays accurate. Only the clip is expanded — neighbours
    // overlap by ~1px, hiding the antialiased seams.
    const clipDst = expandTriangle(dst, 0.7);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(clipDst[0][0], clipDst[0][1]);
    ctx.lineTo(clipDst[1][0], clipDst[1][1]);
    ctx.lineTo(clipDst[2][0], clipDst[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  return c;
}

/** Draw the source image onto a `size x size` canvas with the face
 *  centred and filling `fillFactor` of the canvas. No warp / no colour
 *  transfer / no enhance / no sharpen — used as the "100% you" and
 *  "100% pro" extremes of the blend slider. Face position matches
 *  roughly where the morph puts the face so the slider transition
 *  feels continuous. */
function fitFaceToCanvas(
  src: HTMLImageElement | HTMLCanvasElement,
  landmarks: number[][],
  size: number,
  fillFactor = 0.78,
): HTMLCanvasElement {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const idx of FACE_OVAL_INDICES) {
    const p = landmarks[idx];
    if (!p) continue;
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const sw = src.width;
  const sh = src.height;
  const faceWpx = (maxX - minX) * sw;
  const faceHpx = (maxY - minY) * sh;
  const drawScale = Math.min(
    (fillFactor * size) / faceWpx,
    (fillFactor * size) / faceHpx,
  );
  const drawnW = sw * drawScale;
  const drawnH = sh * drawScale;
  const faceCxPx = ((minX + maxX) / 2) * sw;
  const faceCyPx = ((minY + maxY) / 2) * sh;
  const offsetX = size / 2 - faceCxPx * drawScale;
  const offsetY = size / 2 - faceCyPx * drawScale;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, offsetX, offsetY, drawnW, drawnH);
  return c;
}

/** Scale + centre the given landmarks so the FACE_OVAL bounding box
 *  fills `fillFactor` of the canvas. Source landmarks are unchanged;
 *  this only runs on the TARGET geometry to make the morphed face
 *  fill the output. Without it the averaged user-x-pro face sits at
 *  whatever (often small) size their photo crops average to. */
function normalizeTargetLandmarks(
  lm: number[][],
  fillFactor: number,
): number[][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const idx of FACE_OVAL_INDICES) {
    const p = lm[idx];
    if (!p) continue;
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return lm;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Uniform scale to preserve face aspect ratio.
  const scale = Math.min(fillFactor / w, fillFactor / h);
  return lm.map((p) => [
    (p[0] - cx) * scale + 0.5,
    (p[1] - cy) * scale + 0.5,
  ]);
}

/** Build a face-oval alpha mask as a separate canvas. White inside the
 *  averaged face polygon, transparent outside, with a soft blurred
 *  edge. Used both for colour-stat sampling (which pixels are face?)
 *  AND for the final composite. shadowBlur instead of ctx.filter so
 *  iOS Safari doesn't hang. */
function buildFaceMask(
  dstLm: number[][],
  size: number,
): HTMLCanvasElement {
  const mask = document.createElement("canvas");
  mask.width = size;
  mask.height = size;
  const mctx = mask.getContext("2d")!;
  mctx.fillStyle = "white";
  mctx.shadowColor = "white";
  // 6% of canvas — soft enough that the face-to-BG edge is invisible.
  mctx.shadowBlur = Math.floor(size * 0.06);
  mctx.beginPath();
  for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
    const idx = FACE_OVAL_INDICES[i];
    const p = dstLm[idx];
    if (!p) continue;
    const px = p[0] * size;
    const py = p[1] * size;
    if (i === 0) mctx.moveTo(px, py);
    else mctx.lineTo(px, py);
  }
  mctx.closePath();
  mctx.fill();
  return mask;
}

/** Composite the built face mask + a polished gradient background +
 *  subtle vignette. Magazine-cover composition the user wants to share. */
function applyFaceOvalMask(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  size: number,
): void {
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);

  // Radial gradient BG: slightly lighter at the centre, deep dark
  // green at the edges. Draws the eye to the face.
  ctx.globalCompositeOperation = "destination-over";
  const bg = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.1,
    size / 2,
    size / 2,
    size * 0.75,
  );
  bg.addColorStop(0, "#1a3a1a");
  bg.addColorStop(0.6, "#0f1f0f");
  bg.addColorStop(1, "#040a04");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "source-over";
}

/** Soft corner vignette so eyes are pulled to the face. Applied at the
 *  end of the pipeline so it darkens the FINAL composition. */
function applyVignette(ctx: CanvasRenderingContext2D, size: number): void {
  const v = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.35,
    size / 2,
    size / 2,
    size * 0.72,
  );
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, size, size);
}

/** Magazine-style title bar at the top: "YOU × PRO NAME" centred in
 *  the brand accent, with a thin underline. */
function drawTitle(
  ctx: CanvasRenderingContext2D,
  size: number,
  proName: string,
): void {
  const text = `YOU × ${proName.toUpperCase()}`;
  const fontSize = Math.round(size * 0.045);
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fillText(text, size / 2, Math.round(size * 0.05));
  // thin separator underline
  const tw = ctx.measureText(text).width;
  const ly = Math.round(size * 0.05) + fontSize + Math.round(size * 0.012);
  ctx.fillStyle = "#E07B5B";
  ctx.fillRect(
    (size - tw * 0.4) / 2,
    ly,
    tw * 0.4,
    Math.max(2, Math.round(size * 0.004)),
  );
}

// ── sRGB <-> CIELAB conversion (D65) ──────────────────────────────
// LAB separates L (luminance) from A/B (colour). Doing Reinhard
// transfer in LAB matches skin TONE without flattening the user's
// natural lighting/shading. Much better than RGB.
function srgbToLin(c: number): number {
  const f = c / 255;
  return f > 0.04045 ? Math.pow((f + 0.055) / 1.055, 2.4) : f / 12.92;
}
function linToSrgb(c: number): number {
  const f = c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
  return Math.max(0, Math.min(255, Math.round(f * 255)));
}
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLin(r);
  const lg = srgbToLin(g);
  const lb = srgbToLin(b);
  // sRGB → XYZ (D65)
  let X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  let Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  let Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
  // Normalise to D65 white
  X /= 0.95047;
  Z /= 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116);
  const fX = f(X);
  const fY = f(Y);
  const fZ = f(Z);
  return [116 * fY - 16, 500 * (fX - fY), 200 * (fY - fZ)];
}
function labToRgb(L: number, A: number, B: number): [number, number, number] {
  const fY = (L + 16) / 116;
  const fX = A / 500 + fY;
  const fZ = fY - B / 200;
  const fi = (t: number) => (t > 0.206896 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = 0.95047 * fi(fX);
  const Y = fi(fY);
  const Z = 1.08883 * fi(fZ);
  const lr = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const lg = X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560;
  const lb = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  return [linToSrgb(lr), linToSrgb(lg), linToSrgb(lb)];
}

/** Reinhard colour transfer in CIELAB: shift target's pixel
 *  distribution to match reference, in a space where luminance and
 *  chroma are separated. Result is much more natural than RGB
 *  transfer — a warm phone selfie gets the pro's neutral white
 *  balance without flattening the user's own lighting. */
function colorHarmonize(
  target: HTMLCanvasElement,
  reference: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  size: number,
): void {
  const tctx = target.getContext("2d")!;
  const rctx = reference.getContext("2d")!;
  const mctx = mask.getContext("2d")!;
  const tImg = tctx.getImageData(0, 0, size, size);
  const rImg = rctx.getImageData(0, 0, size, size);
  const mImg = mctx.getImageData(0, 0, size, size);
  const tData = tImg.data;
  const rData = rImg.data;
  const mData = mImg.data;

  // Convert face-pixels to LAB and accumulate per-channel stats.
  const tSum = [0, 0, 0];
  const tSumSq = [0, 0, 0];
  const rSum = [0, 0, 0];
  const rSumSq = [0, 0, 0];
  let count = 0;
  // Cache LAB values for target so we don't convert twice.
  const tLab = new Float32Array(tData.length);
  for (let i = 0; i < tData.length; i += 4) {
    if (tData[i + 3] === 0) continue;
    const [L, A, B] = rgbToLab(tData[i], tData[i + 1], tData[i + 2]);
    tLab[i] = L;
    tLab[i + 1] = A;
    tLab[i + 2] = B;
    if (mData[i + 3] < 200) continue;
    if (rData[i + 3] === 0) continue;
    tSum[0] += L; tSum[1] += A; tSum[2] += B;
    tSumSq[0] += L * L; tSumSq[1] += A * A; tSumSq[2] += B * B;
    const [rL, rA, rB] = rgbToLab(rData[i], rData[i + 1], rData[i + 2]);
    rSum[0] += rL; rSum[1] += rA; rSum[2] += rB;
    rSumSq[0] += rL * rL; rSumSq[1] += rA * rA; rSumSq[2] += rB * rB;
    count++;
  }
  if (count < 100) return;

  const tMean = tSum.map((s) => s / count);
  const rMean = rSum.map((s) => s / count);
  const tStd = tSumSq.map((sq, i) =>
    Math.sqrt(Math.max(0.5, sq / count - tMean[i] * tMean[i])),
  );
  const rStd = rSumSq.map((sq, i) =>
    Math.sqrt(Math.max(0.5, sq / count - rMean[i] * rMean[i])),
  );

  // Clamp transfer strength so we don't amplify noise on a poor selfie.
  // L (luminance): 0.7-1.3 — preserve user's own lighting shape.
  // A/B (chroma): 0.4-1.8 — more aggressive on colour cast correction.
  const clamps: [number, number][] = [
    [0.7, 1.3],
    [0.4, 1.8],
    [0.4, 1.8],
  ];

  for (let i = 0; i < tData.length; i += 4) {
    if (tData[i + 3] === 0) continue;
    const L = tLab[i];
    const A = tLab[i + 1];
    const B = tLab[i + 2];
    const newL =
      (L - tMean[0]) *
        Math.max(clamps[0][0], Math.min(clamps[0][1], rStd[0] / tStd[0])) +
      rMean[0];
    const newA =
      (A - tMean[1]) *
        Math.max(clamps[1][0], Math.min(clamps[1][1], rStd[1] / tStd[1])) +
      rMean[1];
    const newB =
      (B - tMean[2]) *
        Math.max(clamps[2][0], Math.min(clamps[2][1], rStd[2] / tStd[2])) +
      rMean[2];
    const [r, g, b] = labToRgb(newL, newA, newB);
    tData[i] = r;
    tData[i + 1] = g;
    tData[i + 2] = b;
  }
  tctx.putImageData(tImg, 0, 0);
}

/** Unsharp mask sharpening via 3x3 kernel. Compensates for the slight
 *  high-frequency softening that any alpha-blend introduces — without
 *  it the result looks airbrushed. */
function sharpen(canvas: HTMLCanvasElement, amount: number): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(img.data);
  const dst = img.data;
  const wt = amount / 9; // weight per 8-neighbour
  const ct = 1 + amount * 8 / 9; // centre weight to keep mass = 1
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] === 0) continue;
      for (let ch = 0; ch < 3; ch++) {
        const sum =
          src[((y - 1) * w + (x - 1)) * 4 + ch] +
          src[((y - 1) * w + x) * 4 + ch] +
          src[((y - 1) * w + (x + 1)) * 4 + ch] +
          src[(y * w + (x - 1)) * 4 + ch] +
          src[(y * w + (x + 1)) * 4 + ch] +
          src[((y + 1) * w + (x - 1)) * 4 + ch] +
          src[((y + 1) * w + x) * 4 + ch] +
          src[((y + 1) * w + (x + 1)) * 4 + ch];
        const v = src[i + ch] * ct - sum * wt;
        dst[i + ch] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Pixel-level contrast + saturation bump. Replaces the ctx.filter
 *  approach which hangs iOS Safari. */
function enhanceBlend(
  canvas: HTMLCanvasElement,
  contrast: number,
  saturation: number,
): void {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    // Contrast around 128.
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    // Saturation around the perceptual grey of the pixel.
    const grey = r * 0.299 + g * 0.587 + b * 0.114;
    r = grey + (r - grey) * saturation;
    g = grey + (g - grey) * saturation;
    b = grey + (b - grey) * saturation;
    d[i] = Math.max(0, Math.min(255, Math.round(r)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
  ctx.putImageData(img, 0, 0);
}

// ── mediapipe loader (singleton) ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _detectorPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDetector(): Promise<any> {
  if (_detectorPromise) return _detectorPromise;
  _detectorPromise = (async () => {
    const { FilesetResolver, FaceLandmarker } = await import(
      "@mediapipe/tasks-vision"
    );
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
    );
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      },
      outputFaceBlendshapes: false,
      runningMode: "IMAGE",
      numFaces: 1,
    });
  })();
  return _detectorPromise;
}

function extractAllLandmarks(
  lm: { x: number; y: number }[],
): number[][] | null {
  if (lm.length < 478) return null;
  return lm.slice(0, 478).map((p) => [p.x, p.y]);
}

// ──────────────────────────────────────────────────────────────────────
// UI
// ──────────────────────────────────────────────────────────────────────

const FEATURED: { id: string; label: string }[] = [
  { id: "46046", label: "Scheffler" },
  { id: "28237", label: "McIlroy" },
  { id: "08793", label: "Tiger" },
  { id: "01810", label: "Phil" },
  { id: "47959", label: "Bryson" },
  { id: "52955", label: "Åberg" },
];

type Stage = "idle" | "detecting" | "ready" | "error";

export default function BlendMePage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [selfieLm, setSelfieLm] = useState<number[][] | null>(null);
  const [selectedPro, setSelectedPro] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  /** Blend ratio: 0 = 100% pro, 1 = 100% user. Default 0.6 matches the
   *  previous 60/40 user-bias. Driven by the slider. */
  const [blendRatio, setBlendRatio] = useState(0.6);
  /** True once the expensive morph has produced cached components and
   *  the slider can be displayed. */
  const [composeReady, setComposeReady] = useState(false);

  // Cached components reused across slider drags — none of these
  // change when the slider moves, so we never re-warp during dragging.
  const userCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const proCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceMaskRef = useRef<HTMLCanvasElement | null>(null);
  /** Unprocessed originals shown at the slider extremes. */
  const userOriginalRef = useRef<HTMLCanvasElement | null>(null);
  const proOriginalRef = useRef<HTMLCanvasElement | null>(null);
  /** The displayed canvas. Slider redraws this with the new alpha. */
  const outCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const pool = useMemo(
    () =>
      GOLFERS.filter(
        (g) =>
          PGA_TOUR_IDS[g.id] !== undefined &&
          PRO_LANDMARKS[PGA_TOUR_IDS[g.id]!],
      ),
    [],
  );
  const searchMatches = useMemo(() => {
    const q = searchableName(searchInput.trim());
    if (!q) return [];
    return pool
      .filter((g) => searchableName(g.name).includes(q))
      .slice(0, 6);
  }, [pool, searchInput]);

  const selectedProName = useMemo(() => {
    if (!selectedPro) return null;
    const slug = Object.entries(PGA_TOUR_IDS).find(
      ([, v]) => v === selectedPro,
    )?.[0];
    if (!slug) return null;
    return GOLFERS.find((g) => g.id === slug)?.name ?? null;
  }, [selectedPro]);

  useEffect(() => {
    console.log(
      "%c[blend/me] build v12 — slider extremes show raw photo",
      "color: #E07B5B; font-weight: bold",
    );
    getDetector().catch((e) => console.error("mediapipe preload failed", e));
  }, []);

  async function handleFile(file: File) {
    setErrMsg(null);
    setComposeReady(false);
    setSelectedPro(null);
    userCanvasRef.current = null;
    proCanvasRef.current = null;
    faceMaskRef.current = null;
    userOriginalRef.current = null;
    proOriginalRef.current = null;
    const url = URL.createObjectURL(file);
    setSelfieUrl(url);
    setStage("detecting");
    try {
      const img = await loadImage(url, false);
      const small = downscale(img, 1200);
      const detector = await getDetector();
      const result = detector.detect(small);
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        setErrMsg(
          "Couldn't find a face in that photo. Try a clearer head-on photo.",
        );
        setStage("error");
        return;
      }
      const lm = extractAllLandmarks(result.faceLandmarks[0]);
      if (!lm) {
        setErrMsg("Face detected but landmarks incomplete. Try another photo.");
        setStage("error");
        return;
      }
      setSelfieLm(lm);
      setStage("ready");
    } catch (e) {
      console.error(e);
      setErrMsg("Something went wrong loading the face detector. Try again.");
      setStage("error");
    }
  }

  /** Re-render the output canvas at the given blend ratio. Cheap — no
   *  warping, just composite the two cached canvases at alpha and
   *  apply the final composition layers. Safe to call on every slider
   *  input event. */
  const compositeAtRatio = useMemo(() => {
    return (ratio: number) => {
      const userCanvas = userCanvasRef.current;
      const proCanvas = proCanvasRef.current;
      const faceMask = faceMaskRef.current;
      const out = outCanvasRef.current;
      if (!userCanvas || !proCanvas || !faceMask || !out) return;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      out.width = OUT_SIZE;
      out.height = OUT_SIZE;
      ctx.clearRect(0, 0, OUT_SIZE, OUT_SIZE);
      // Slider extremes: show the ORIGINAL photo — no warp, no LAB
      // transfer, no sharpening. Just the photo, with the same
      // framing (mask / vignette / title / watermark) as the morph.
      if (ratio >= 1 && userOriginalRef.current) {
        ctx.drawImage(userOriginalRef.current, 0, 0);
      } else if (ratio <= 0 && proOriginalRef.current) {
        ctx.drawImage(proOriginalRef.current, 0, 0);
      } else {
        // Pro at full opacity, then user on top at `ratio` — net mix
        // is ratio*user + (1-ratio)*pro.
        ctx.drawImage(proCanvas, 0, 0);
        ctx.globalAlpha = ratio;
        ctx.drawImage(userCanvas, 0, 0);
        ctx.globalAlpha = 1;
      }
      // Mask + BG + vignette + title + watermark.
      applyFaceOvalMask(ctx, faceMask, OUT_SIZE);
      applyVignette(ctx, OUT_SIZE);
      if (selectedProName) drawTitle(ctx, OUT_SIZE, selectedProName);
      ctx.fillStyle = "rgba(255, 214, 74, 0.9)";
      ctx.font = `bold ${Math.round(OUT_SIZE * 0.038)}px system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        "pardle.app/blend",
        OUT_SIZE - Math.round(OUT_SIZE * 0.03),
        OUT_SIZE - Math.round(OUT_SIZE * 0.025),
      );
    };
  }, [selectedProName]);

  useEffect(() => {
    if (!selectedPro || !selfieUrl || !selfieLm) return;
    if (stage === "detecting" || stage === "error") return;
    if (composeReady) return; // already rendered for this pick
    let cancelled = false;
    const t0 = performance.now();
    const log = (msg: string) =>
      console.log(`[blend/me] ${(performance.now() - t0).toFixed(0)}ms ${msg}`);
    log("morph start");

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      console.warn("[blend/me] timed out after 20s");
      setErrMsg(
        "Morph took too long. Try a smaller photo or a different pro.",
      );
      setStage("error");
    }, 20000);

    (async () => {
      try {
        const proLm = PRO_LANDMARKS[selectedPro];
        if (!proLm || proLm.length < 478) {
          throw new Error("missing pro landmarks");
        }
        log(`have ${proLm.length} pro landmarks`);

        const proImgPromise = loadImage(
          pgaTourHeadshotUrlById(selectedPro, 600),
        );
        const proImg = (await Promise.race([
          proImgPromise,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("pro image fetch timed out")), 10000),
          ),
        ])) as HTMLImageElement;
        log("pro image loaded");

        const selfieImg = await loadImage(selfieUrl, false);
        const selfieRaw = downscale(selfieImg, 1200);
        // Soft beauty blur to hide selfie noise / micro blemishes /
        // patchy lighting BEFORE the morph. Restores skin texture
        // later via unsharp mask. Standard beauty-app pipeline.
        const selfieSmall = softenSelfie(selfieRaw, 1.7);
        log(`selfie softened ${selfieSmall.width}x${selfieSmall.height}`);

        if (cancelled) return;

        // Average the two landmark sets, then re-scale so the FACE_OVAL
        // fills ~78% of the canvas. Without this the output face ends
        // up small (user photos typically frame face at ~30% of frame).
        const avgLm = selfieLm.map((p, i) => [
          (p[0] + proLm[i][0]) / 2,
          (p[1] + proLm[i][1]) / 2,
        ]);
        const target = normalizeTargetLandmarks(avgLm, 0.78);
        log("target geometry built (face filled to 78%)");

        // Delaunay over the target landmark positions (in pixel coords).
        const flat = new Float64Array(target.length * 2);
        for (let i = 0; i < target.length; i++) {
          flat[i * 2] = target[i][0] * OUT_SIZE;
          flat[i * 2 + 1] = target[i][1] * OUT_SIZE;
        }
        const delaunay = new Delaunator(flat);
        const triangles = delaunay.triangles;
        log(`triangulation: ${triangles.length / 3} triangles`);

        const userCanvas = warpFace(
          selfieSmall,
          selfieLm,
          target,
          triangles,
          OUT_SIZE,
        );
        log("user face warped");

        const proCanvas = warpFace(
          proImg,
          proLm,
          target,
          triangles,
          OUT_SIZE,
        );
        log("pro face warped");

        // Build the face mask once — used both for colour-stat sampling
        // and for the final composite at every slider position.
        const faceMask = buildFaceMask(target, OUT_SIZE);
        log("face mask built");

        // Match the user's colour distribution to the pro's BEFORE
        // any blending. Eliminates the seam between a warm phone
        // selfie and the pro's neutral studio shot.
        colorHarmonize(userCanvas, proCanvas, faceMask, OUT_SIZE);
        log("colour harmonised");

        // Pre-enhance and sharpen BOTH component canvases so the live
        // slider preview is fast — just compositing, no per-pixel ops
        // on each drag.
        enhanceBlend(userCanvas, 1.08, 1.1);
        enhanceBlend(proCanvas, 1.08, 1.1);
        sharpen(userCanvas, 0.4);
        sharpen(proCanvas, 0.4);
        log("enhanced + sharpened components");

        if (cancelled) return;
        userCanvasRef.current = userCanvas;
        proCanvasRef.current = proCanvas;
        faceMaskRef.current = faceMask;
        // Build the "100% you" / "100% pro" originals — face-centred
        // versions of the raw photos with no processing applied. Used
        // at the slider extremes. Note we use selfieRaw (downscaled
        // but NOT soft-blurred) so what the user sees is genuinely
        // their photo.
        userOriginalRef.current = fitFaceToCanvas(
          selfieRaw,
          selfieLm,
          OUT_SIZE,
          0.78,
        );
        proOriginalRef.current = fitFaceToCanvas(
          proImg,
          proLm,
          OUT_SIZE,
          0.78,
        );
        log("originals fitted");
        // First composite at default ratio. The output canvas is
        // rendered in the DOM, so this paints to what the user sees.
        if (outCanvasRef.current) {
          compositeAtRatio(blendRatio);
          log("first composite");
        }
        if (!cancelled) {
          window.clearTimeout(timeoutId);
          setComposeReady(true);
        }
      } catch (e) {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        console.error("[blend/me] morph failed:", e);
        const msg = e instanceof Error ? e.message : String(e);
        setErrMsg(
          msg.includes("timed out")
            ? "The pro photo took too long to load. Try a different pro."
            : "Couldn't render the blend. Try a different photo or another pro.",
        );
        setStage("error");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPro, selfieUrl, selfieLm, composeReady]);

  // Re-composite whenever the slider moves OR when the cached
  // components first become ready.
  useEffect(() => {
    if (composeReady) compositeAtRatio(blendRatio);
  }, [blendRatio, composeReady, compositeAtRatio]);

  function currentBlendDataUrl(): string | null {
    const out = outCanvasRef.current;
    if (!out) return null;
    return out.toDataURL("image/jpeg", 0.92);
  }

  function downloadBlend() {
    const url = currentBlendDataUrl();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    const pct = Math.round(blendRatio * 100);
    a.download = `pardle-blend-${selectedPro ?? "me"}-${pct}user.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function shareBlend() {
    const dataUrl = currentBlendDataUrl();
    if (!dataUrl) return;
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    // Always use the full https:// URL — WhatsApp / iMessage / Twitter
    // auto-detect URLs starting with the protocol and make them
    // tappable. Bare "pardle.app/..." appears as plain text.
    const shareUrl = `${BRAND.url}/blend/me`;
    const shareText = `I blended myself with ${selectedProName ?? "a pro"} — try yours at ${shareUrl}`;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "pardle-blend.jpg", { type: "image/jpeg" });
      const data: ShareData = {
        files: [file],
        text: shareText,
        url: shareUrl,
      };
      if (nav.canShare?.(data) && nav.share) {
        await nav.share(data);
        return;
      }
    } catch {
      // fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      // ignore
    }
  }

  function reset() {
    if (selfieUrl) URL.revokeObjectURL(selfieUrl);
    setSelfieUrl(null);
    setSelfieLm(null);
    setSelectedPro(null);
    setComposeReady(false);
    setBlendRatio(0.6);
    setStage("idle");
    setErrMsg(null);
    setSearchInput("");
    userCanvasRef.current = null;
    proCanvasRef.current = null;
    faceMaskRef.current = null;
    userOriginalRef.current = null;
    proOriginalRef.current = null;
  }

  function tryAnotherPro() {
    setSelectedPro(null);
    setComposeReady(false);
    setBlendRatio(0.6);
    userCanvasRef.current = null;
    proCanvasRef.current = null;
    faceMaskRef.current = null;
    userOriginalRef.current = null;
    proOriginalRef.current = null;
  }

  return (
    <main className="container blend-landing">
      <header className="brand">
        <Link className="brand-back" href="/blend" aria-label="Blend tool">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Blend yourself with a pro</p>
      </header>

      <p className="blend-intro">
        Upload a head-on selfie and pick a PGA pro.
      </p>

      {!selfieUrl && (
        <label className="blendme-upload">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="blendme-upload-inner">
            <div className="blendme-upload-emoji">📸</div>
            <div className="blendme-upload-title">
              Upload a photo or take a selfie
            </div>
            <div className="blendme-upload-sub">
              Tap to choose from your camera roll or shoot one now
            </div>
          </div>
        </label>
      )}

      {stage === "detecting" && (
        <div className="blendme-status">
          <div className="blendme-spinner" />
          <p>Finding your face…</p>
        </div>
      )}

      {stage === "error" && errMsg && (
        <div className="blendme-error">
          <p>{errMsg}</p>
          <button className="blend-make" onClick={reset}>
            Try another photo
          </button>
        </div>
      )}

      {selfieUrl && selfieLm && stage !== "detecting" && stage !== "error" && (
        <>
          {!composeReady && (
            <div className="blendme-picker">
              <p className="blendme-picker-label">Blend with…</p>
              <div className="blend-featured-chips">
                {FEATURED.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`blend-featured-chip ${
                      selectedPro === f.id ? "blend-featured-chip-on" : ""
                    }`}
                    onClick={() => setSelectedPro(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="input-area" style={{ marginTop: 10 }}>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Or search any pro..."
                  autoComplete="off"
                  autoCapitalize="words"
                />
                {searchMatches.length > 0 && (
                  <ul className="suggestions">
                    {searchMatches.map((g) => (
                      <li
                        key={g.id}
                        onClick={() => {
                          setSelectedPro(PGA_TOUR_IDS[g.id]!);
                          setSearchInput("");
                        }}
                      >
                        {g.name}{" "}
                        <span className="suggestion-country">{g.country}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {selectedPro && !composeReady && (
            <div className="blendme-status">
              <div className="blendme-spinner" />
              <p>Morphing your face into the pro&apos;s…</p>
            </div>
          )}

          {/* Canvas is rendered in the DOM whether or not a blend is
              ready — the render useEffect needs a valid ref BEFORE
              it can paint into it. We hide it until composeReady. */}
          <canvas
            ref={outCanvasRef}
            width={OUT_SIZE}
            height={OUT_SIZE}
            className={`blendme-result ${composeReady ? "" : "blendme-result-hidden"}`}
            aria-label="Your blend"
          />

          {composeReady && (
            <>
              <div className="blendme-slider-block">
                <div className="blendme-slider-ends">
                  <span className="blendme-slider-end">
                    {selectedProName ?? "Pro"}
                  </span>
                  <span className="blendme-slider-end blendme-slider-end-me">
                    You
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(blendRatio * 100)}
                  onChange={(e) =>
                    setBlendRatio(Number(e.target.value) / 100)
                  }
                  className="blendme-slider"
                  aria-label="Blend ratio"
                />
                <div className="blendme-slider-pct">
                  {Math.round(blendRatio * 100)}% you ·{" "}
                  {100 - Math.round(blendRatio * 100)}%{" "}
                  {selectedProName?.split(" ").slice(-1)[0] ?? "pro"}
                </div>
              </div>

              <div className="blend-actions">
                <button className="blend-save" onClick={downloadBlend}>
                  Save image
                </button>
                <button className="blend-tweet" onClick={shareBlend}>
                  Share
                </button>
                <button className="blend-make" onClick={tryAnotherPro}>
                  Try another pro
                </button>
              </div>
            </>
          )}

          <button className="blendme-reset" onClick={reset}>
            ← Start with a different selfie
          </button>
        </>
      )}

      <div className="blend-cta">
        <p className="blend-cta-text">
          Like the blend? Try the daily golf puzzle.
        </p>
        <Link href="/faces" className="blend-cta-btn">
          Play today&apos;s Faces →
        </Link>
      </div>

      <footer>
        <p>
          {BRAND.domain} · Selfie processed locally, never uploaded to a
          server.
        </p>
      </footer>
    </main>
  );
}
