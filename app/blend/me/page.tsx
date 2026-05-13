"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import faceAlignmentRaw from "@/lib/data/face-alignment.json";
import { GOLFERS } from "@/lib/data/golfers";
import {
  PGA_TOUR_IDS,
  pgaTourHeadshotUrlById,
} from "@/lib/data/pga-tour-ids";
import { searchableName } from "@/lib/text";

interface ProAlignment {
  leftEye: number[];
  rightEye: number[];
  mouth: number[];
  distance: number;
  angle: number;
  eyeMouthDistance: number;
  eyeMouthAngle: number;
}
const PRO_ALIGNMENT = faceAlignmentRaw as Record<string, ProAlignment>;

// ── canonical alignment constants — match lib/data/face-alignment.ts ─
const CANONICAL_EYE_X = 0.5;
const CANONICAL_EYE_Y = 0.4;
const CANONICAL_MOUTH_X = 0.5;
const CANONICAL_MOUTH_Y = 0.62;

// mediapipe FaceMesh landmark indices (refined-landmarks model)
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const MOUTH_LEFT_CORNER = 61;
const MOUTH_RIGHT_CORNER = 291;

const OUT_SIZE = 600;

interface FaceLm {
  leftEye: [number, number];
  rightEye: [number, number];
  mouth: [number, number];
}

interface AlignTransform {
  /** Pixel translation. */
  tx: number;
  ty: number;
  /** Uniform scale around origin (0, 0). */
  scale: number;
  /** Rotation in degrees around origin. */
  rotateDeg: number;
}

function computeAlignTransform(lm: FaceLm, size: number): AlignTransform {
  const eyeMidX = (lm.leftEye[0] + lm.rightEye[0]) / 2;
  const eyeMidY = (lm.leftEye[1] + lm.rightEye[1]) / 2;
  const dx = lm.mouth[0] - eyeMidX;
  const dy = lm.mouth[1] - eyeMidY;
  const measLen = Math.hypot(dx, dy);
  const canonLen = CANONICAL_MOUTH_Y - CANONICAL_EYE_Y;
  const scale = canonLen / measLen;
  const angleMeas = Math.atan2(dy, dx);
  const angleCanon = Math.atan2(canonLen, 0); // pi/2
  const rotateRad = angleCanon - angleMeas;
  const cos = Math.cos(rotateRad);
  const sin = Math.sin(rotateRad);
  const eyeRotX = eyeMidX * cos - eyeMidY * sin;
  const eyeRotY = eyeMidX * sin + eyeMidY * cos;
  const tx = (CANONICAL_EYE_X - eyeRotX * scale) * size;
  const ty = (CANONICAL_EYE_Y - eyeRotY * scale) * size;
  return { tx, ty, scale, rotateDeg: (rotateRad * 180) / Math.PI };
}

/** Load an image element from a URL (or blob URL) and wait for decode. */
function loadImage(src: string, crossOrigin = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Downscale an image element to a max dimension on a temporary canvas.
 * 4000+px iPhone selfies blow up canvas drawImage / toDataURL — drawing
 * them at full size synchronously locks the main thread for minutes
 * and starves the timeout callback. Bring everything down to ~1200px
 * before any further work.
 */
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

/** Draw `img` onto `ctx` at the aligned position derived from `t`. */
function drawAligned(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  t: AlignTransform,
  size: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Canvas applies transforms in source order: translate, rotate, scale.
  // We want: rotate first (around origin), then scale, then translate —
  // which means we call translate(tx,ty) → rotate(deg) → scale(s) before
  // drawing the image at its native size.
  ctx.translate(t.tx, t.ty);
  ctx.rotate((t.rotateDeg * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(img, 0, 0, size, size);
  ctx.restore();
}

/** Apply soft-edged elliptical face mask via composite-out trick. */
function applyOvalMask(ctx: CanvasRenderingContext2D, size: number): void {
  // Build the mask alpha on a side canvas then use composite-out to
  // erase the corners.
  const mask = document.createElement("canvas");
  mask.width = size;
  mask.height = size;
  const mctx = mask.getContext("2d")!;
  // Dark green BG
  mctx.fillStyle = "#0f1f0f";
  mctx.fillRect(0, 0, size, size);
  // Cut a soft oval hole
  mctx.globalCompositeOperation = "destination-out";
  const grad = mctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.25,
    size / 2,
    size / 2,
    size * 0.45,
  );
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.7, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  mctx.fillStyle = grad;
  mctx.fillRect(0, 0, size, size);
  // Composite back over the main canvas
  ctx.globalCompositeOperation = "destination-over";
  // Actually we want the mask ON TOP — draw it normally
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(mask, 0, 0);
}

// Module-level singleton — load mediapipe + the FaceLandmarker model
// exactly once per page session. The promise is created on first call;
// subsequent callers await the same promise.
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

function extractFaceLm(landmarks: { x: number; y: number }[]): FaceLm | null {
  const needed = Math.max(
    LEFT_IRIS,
    RIGHT_IRIS,
    MOUTH_LEFT_CORNER,
    MOUTH_RIGHT_CORNER,
  );
  if (landmarks.length <= needed) return null;
  const le = landmarks[LEFT_IRIS];
  const re = landmarks[RIGHT_IRIS];
  const screenLeft: [number, number] =
    le.x < re.x ? [le.x, le.y] : [re.x, re.y];
  const screenRight: [number, number] =
    le.x < re.x ? [re.x, re.y] : [le.x, le.y];
  const ml = landmarks[MOUTH_LEFT_CORNER];
  const mr = landmarks[MOUTH_RIGHT_CORNER];
  const mouth: [number, number] = [(ml.x + mr.x) / 2, (ml.y + mr.y) / 2];
  return { leftEye: screenLeft, rightEye: screenRight, mouth };
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

type Stage = "idle" | "detecting" | "ready" | "rendering" | "error";

export default function BlendMePage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [selfieLm, setSelfieLm] = useState<FaceLm | null>(null);
  const [selectedPro, setSelectedPro] = useState<string | null>(null);
  const [blendUrl, setBlendUrl] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Eligible pros to blend with — those with PGA Tour IDs (so we have
  // a Cloudinary headshot we can fetch).
  const pool = useMemo(
    () => GOLFERS.filter((g) => PGA_TOUR_IDS[g.id] !== undefined),
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

  // Pre-load mediapipe on mount — by the time the user uploads a
  // selfie, the model is already cached and detection is instant.
  // Also prints a build marker so we can sanity-check the deploy is
  // current when troubleshooting from a screenshot.
  useEffect(() => {
    console.log(
      "%c[blend/me] build v5 (granular logs + filter dropped)",
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
      // Downscale right away. 4000px+ iPhone selfies hang mediapipe AND
      // the canvas pipeline; ~1200px is plenty for face detection.
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
      const lm = extractFaceLm(result.faceLandmarks[0]);
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

  // ── render blend whenever a pro is picked ──────────────────────────
  useEffect(() => {
    if (!selectedPro || !selfieUrl || !selfieLm || stage !== "ready") return;
    let cancelled = false;
    setStage("rendering");

    // Hard timeout — surfaces an error if any step gets stuck. Per-step
    // logs (visible in the browser console) let us pinpoint hangs.
    const t0 = performance.now();
    const log = (msg: string) =>
      console.log(`[blend/me] ${(performance.now() - t0).toFixed(0)}ms ${msg}`);
    log("render start");

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      console.warn("[blend/me] timed out after 15s — see logs above");
      setErrMsg(
        "Blending took too long. Try a smaller photo or a different pro.",
      );
      setStage("error");
    }, 15000);

    (async () => {
      try {
        const proAlign = PRO_ALIGNMENT[selectedPro];
        if (!proAlign) throw new Error(`no alignment data for ${selectedPro}`);
        const proLm: FaceLm = {
          leftEye: [proAlign.leftEye[0], proAlign.leftEye[1]],
          rightEye: [proAlign.rightEye[0], proAlign.rightEye[1]],
          mouth: [proAlign.mouth[0], proAlign.mouth[1]],
        };
        log(`have pro landmarks for ${selectedPro}`);

        // Race the pro image fetch against a 10s deadline. If Cloudinary
        // is slow, we want to error out cleanly rather than hang.
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
        log(`selfie image loaded (${selfieImg.width}x${selfieImg.height})`);

        // Downscale the selfie BEFORE feeding to canvas. A 4032x3024
        // iPhone shot will lock the main thread for minutes on
        // drawImage + toDataURL. ~1200px is way more than the 600px
        // output stage needs.
        const selfieSmall = downscale(selfieImg, 1200);
        log(`selfie downscaled to ${selfieSmall.width}x${selfieSmall.height}`);

        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error("canvas ref missing");
        }
        canvas.width = OUT_SIZE;
        canvas.height = OUT_SIZE;
        log("canvas sized");
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, OUT_SIZE, OUT_SIZE);
        ctx.fillStyle = "#0f1f0f";
        ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
        log("bg filled");

        const proT = computeAlignTransform(proLm, OUT_SIZE);
        const selfieT = computeAlignTransform(selfieLm, OUT_SIZE);

        // No ctx.filter — iOS Safari hangs hard on it. We accept a
        // slightly less punchy result rather than risk the freeze.
        drawAligned(ctx, proImg, proT, OUT_SIZE, 1);
        log("pro drawn");
        drawAligned(ctx, selfieSmall, selfieT, OUT_SIZE, 0.5);
        log("canvas drawn");

        // Soft elliptical face mask using a clip-via-mask trick.
        const mask = document.createElement("canvas");
        mask.width = OUT_SIZE;
        mask.height = OUT_SIZE;
        const mctx = mask.getContext("2d")!;
        const grad = mctx.createRadialGradient(
          OUT_SIZE / 2,
          OUT_SIZE / 2,
          OUT_SIZE * 0.3,
          OUT_SIZE / 2,
          OUT_SIZE / 2,
          OUT_SIZE * 0.48,
        );
        grad.addColorStop(0, "rgba(15,31,15,0)");
        grad.addColorStop(0.6, "rgba(15,31,15,0)");
        grad.addColorStop(1, "rgba(15,31,15,1)");
        mctx.fillStyle = grad;
        mctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
        ctx.drawImage(mask, 0, 0);
        log("mask applied");

        // pardle.app watermark — small, bottom-right, low opacity
        ctx.fillStyle = "rgba(255, 214, 74, 0.85)";
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText("pardle.app/blend", OUT_SIZE - 18, OUT_SIZE - 14);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        log("jpeg encoded");
        if (!cancelled) {
          window.clearTimeout(timeoutId);
          setBlendUrl(dataUrl);
          setStage("ready");
        }
      } catch (e) {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        console.error("[blend/me] render failed:", e);
        const msg = e instanceof Error ? e.message : String(e);
        setErrMsg(
          msg.includes("timed out")
            ? "The pro photo took too long to load. Try a different pro."
            : msg.includes("SecurityError") || msg.includes("tainted")
              ? "Browser blocked the image (CORS). Try refreshing the page."
              : "Couldn't render the blend. Try a different photo or another pro.",
        );
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [selectedPro, selfieUrl, selfieLm, stage]);

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
      // fall through to copy
    }
    // Fallback: copy a text invite, user can paste anywhere
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

  // ── render ─────────────────────────────────────────────────────────
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
        this browser — the detection and blending all run locally.
      </p>

      {/* Step 1: upload — accept gallery OR camera. No `capture` so
          mobile lets the user choose between Camera and Photo Library. */}
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

      {/* Detecting state */}
      {stage === "detecting" && (
        <div className="blendme-status">
          <div className="blendme-spinner" />
          <p>Finding your face…</p>
        </div>
      )}

      {/* Error state */}
      {stage === "error" && errMsg && (
        <div className="blendme-error">
          <p>{errMsg}</p>
          <button className="blend-make" onClick={reset}>
            Try another photo
          </button>
        </div>
      )}

      {/* Picker + result */}
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

          {/* Result */}
          {stage === "rendering" && (
            <div className="blendme-status">
              <div className="blendme-spinner" />
              <p>Blending…</p>
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

          {/* Hidden canvas used to compose the blend */}
          <canvas
            ref={canvasRef}
            style={{ display: "none" }}
            width={OUT_SIZE}
            height={OUT_SIZE}
          />

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
