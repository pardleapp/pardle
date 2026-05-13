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

/** Composite a built face mask onto the output canvas + fill BG. */
function applyFaceOvalMask(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  size: number,
): void {
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#0f1f0f";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
}

/** Reinhard colour transfer in RGB: shift `target` canvas's pixel
 *  distribution to match `reference` canvas. Computes mean & std per
 *  channel using only pixels marked as face in `mask`, then for each
 *  pixel in target applies (v - tMean) * (rStd / tStd) + rMean.
 *
 *  Result: a selfie shot in warm tungsten / blue daylight / underexposed
 *  light blends seamlessly with the pro's neutral studio shot. Without
 *  this the colour mismatch makes the blend look like two separate
 *  faces stitched together. */
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

  // Compute mean / std over face-masked pixels for each channel.
  const tSum = [0, 0, 0];
  const tSumSq = [0, 0, 0];
  const rSum = [0, 0, 0];
  const rSumSq = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < tData.length; i += 4) {
    // Need both source pixels to be present AND mask to be solid.
    if (mData[i + 3] < 200) continue;
    if (tData[i + 3] === 0 || rData[i + 3] === 0) continue;
    for (let ch = 0; ch < 3; ch++) {
      const tv = tData[i + ch];
      const rv = rData[i + ch];
      tSum[ch] += tv;
      tSumSq[ch] += tv * tv;
      rSum[ch] += rv;
      rSumSq[ch] += rv * rv;
    }
    count++;
  }
  if (count < 100) return; // not enough face pixels to compute stats

  const tMean: number[] = [];
  const tStd: number[] = [];
  const rMean: number[] = [];
  const rStd: number[] = [];
  for (let ch = 0; ch < 3; ch++) {
    tMean[ch] = tSum[ch] / count;
    rMean[ch] = rSum[ch] / count;
    tStd[ch] = Math.sqrt(Math.max(1, tSumSq[ch] / count - tMean[ch] * tMean[ch]));
    rStd[ch] = Math.sqrt(Math.max(1, rSumSq[ch] / count - rMean[ch] * rMean[ch]));
  }

  // Don't over-correct — clamp the scale factor so an under-lit photo
  // doesn't get amplified to a noisy mess. 0.6-1.6x is plenty.
  const scaleClamp = (s: number) => Math.max(0.6, Math.min(1.6, s));

  // Apply transfer to target pixels.
  for (let i = 0; i < tData.length; i += 4) {
    if (tData[i + 3] === 0) continue;
    for (let ch = 0; ch < 3; ch++) {
      const scale = scaleClamp(rStd[ch] / tStd[ch]);
      const v = (tData[i + ch] - tMean[ch]) * scale + rMean[ch];
      tData[i + ch] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  tctx.putImageData(tImg, 0, 0);
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
  const [blendUrl, setBlendUrl] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");

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
      "%c[blend/me] build v8 — 800px + colour harmonize + enhance",
      "color: #E07B5B; font-weight: bold",
    );
    getDetector().catch((e) => console.error("mediapipe preload failed", e));
  }, []);

  async function handleFile(file: File) {
    setErrMsg(null);
    setBlendUrl(null);
    setSelectedPro(null);
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

  useEffect(() => {
    if (!selectedPro || !selfieUrl || !selfieLm) return;
    if (stage === "detecting" || stage === "error") return;
    if (blendUrl) return;
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
        const selfieSmall = downscale(selfieImg, 1200);
        log(`selfie ready ${selfieSmall.width}x${selfieSmall.height}`);

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
        // (which pixels count as "face"?) and for the final composite.
        const faceMask = buildFaceMask(target, OUT_SIZE);
        log("face mask built");

        // Match the user's colour distribution to the pro's BEFORE
        // blending. Eliminates the seam between a warm phone selfie
        // and the pro's neutral studio shot.
        colorHarmonize(userCanvas, proCanvas, faceMask, OUT_SIZE);
        log("colour harmonised");

        const out = document.createElement("canvas");
        out.width = OUT_SIZE;
        out.height = OUT_SIZE;
        const outCtx = out.getContext("2d")!;
        outCtx.drawImage(proCanvas, 0, 0);
        outCtx.globalAlpha = 0.5;
        outCtx.drawImage(userCanvas, 0, 0);
        outCtx.globalAlpha = 1;
        log("blended");

        applyFaceOvalMask(outCtx, faceMask, OUT_SIZE);
        log("mask applied");

        // Pixel-level contrast + saturation — same "punch" the offline
        // pro x pro pipeline applies via OpenCV. Done in pixel space
        // because ctx.filter hangs iOS Safari.
        enhanceBlend(out, 1.08, 1.1);
        log("enhanced");

        outCtx.fillStyle = "rgba(255, 214, 74, 0.9)";
        outCtx.font = `bold ${Math.round(OUT_SIZE * 0.038)}px system-ui, sans-serif`;
        outCtx.textAlign = "right";
        outCtx.textBaseline = "bottom";
        outCtx.fillText(
          "pardle.app/blend",
          OUT_SIZE - Math.round(OUT_SIZE * 0.03),
          OUT_SIZE - Math.round(OUT_SIZE * 0.025),
        );

        const dataUrl = out.toDataURL("image/jpeg", 0.9);
        log("jpeg encoded");
        if (!cancelled) {
          window.clearTimeout(timeoutId);
          setBlendUrl(dataUrl);
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
  }, [selectedPro, selfieUrl, selfieLm, blendUrl]);

  function downloadBlend() {
    if (!blendUrl) return;
    const a = document.createElement("a");
    a.href = blendUrl;
    a.download = `pardle-blend-${selectedPro ?? "me"}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function shareBlend() {
    if (!blendUrl) return;
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    try {
      const blob = await (await fetch(blendUrl)).blob();
      const file = new File([blob], "pardle-blend.jpg", { type: "image/jpeg" });
      const data: ShareData = {
        files: [file],
        text: `I blended myself with ${selectedProName ?? "a pro"} on pardle.app/blend 👇`,
      };
      if (nav.canShare?.(data) && nav.share) {
        await nav.share(data);
        return;
      }
    } catch {
      // fall through
    }
    try {
      await navigator.clipboard.writeText(
        `Made this on ${BRAND.url}/blend/me — try yours.`,
      );
    } catch {
      // ignore
    }
  }

  function reset() {
    if (selfieUrl) URL.revokeObjectURL(selfieUrl);
    setSelfieUrl(null);
    setSelfieLm(null);
    setSelectedPro(null);
    setBlendUrl(null);
    setStage("idle");
    setErrMsg(null);
    setSearchInput("");
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
        Upload a head-on selfie and pick a PGA pro. Your face never leaves
        this browser — detection and morphing all run locally.
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
          {!blendUrl && (
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

          {selectedPro && !blendUrl && (
            <div className="blendme-status">
              <div className="blendme-spinner" />
              <p>Morphing your face into the pro&apos;s…</p>
            </div>
          )}

          {blendUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="blendme-result"
                src={blendUrl}
                alt="Your blend"
              />
              {selectedProName && (
                <div className="blend-names">
                  <span>You</span>
                  <span className="blend-x">×</span>
                  <span>{selectedProName}</span>
                </div>
              )}
              <div className="blend-actions">
                <button className="blend-save" onClick={downloadBlend}>
                  Save image
                </button>
                <button className="blend-tweet" onClick={shareBlend}>
                  Share
                </button>
                <button
                  className="blend-make"
                  onClick={() => {
                    setBlendUrl(null);
                    setSelectedPro(null);
                  }}
                >
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
