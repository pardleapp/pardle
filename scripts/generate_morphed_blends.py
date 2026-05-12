"""
Pre-generate face-morphed blend images for every pair of pros we have
landmarks for. Outputs JPEG files to public/blends/{a}_{b}.jpg sorted
so {a} < {b} alphabetically (single canonical filename per pair).

The morph pipeline:
  1. For each pair (A, B):
     a. Fetch their Cloudinary headshots at the same dimensions
     b. Read 478 normalised landmarks from face-landmarks.json
     c. Compute average landmark positions in pixel coords
     d. Add boundary points (image corners, edge midpoints) so the
        Delaunay triangulation covers the full image, not just the face
     e. Build a Delaunay triangulation over the average landmarks
     f. For each triangle: compute the affine transform from A's
        triangle to the average triangle, and from B's triangle to the
        same. Warp pixels through both transforms.
     g. Blend the two warped images 50/50.
     h. Apply a soft oval face mask + dark background.
  2. Save as JPEG (q=88, ~25KB per pair).

Usage:
    # Generate all 70 choose 2 pairs:
    python scripts/generate_morphed_blends.py

    # Generate just one pair (handy for tuning):
    python scripts/generate_morphed_blends.py 08793 01810

    # Force-regenerate even if file exists:
    python scripts/generate_morphed_blends.py --force

Requires: pip install opencv-python pillow numpy
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import sys
import time
import urllib.request
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

CLOUDINARY = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_thumb,g_face,z_0.75,h_512,w_512,q_auto,f_auto/"
    "headshots_{id}.png"
)
OUT_DIR = Path("public/blends")
OUT_SIZE = 512  # 512px JPEG ~30KB; full set ~75MB, still under Vercel cap

LANDMARKS_PATH = Path("lib/data/face-landmarks.json")
PGA_IDS_PATH = Path("lib/data/pga-tour-ids.ts")

# mediapipe FACEMESH_FACE_OVAL — the closed loop of landmark indices
# that traces the jawline + hairline of the face. We use it both to
# build the morph triangulation boundary AND to mask the output so the
# blend never bleeds beyond either source's face boundary.
FACE_OVAL_INDICES = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397,
    365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58,
    132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]


def load_landmarks() -> dict[str, np.ndarray]:
    """Load full 478-point landmark sets. The dense mesh gives a much
    finer morph triangulation than the curated 80-point subset we used
    before — mouth corners, nostrils, eye creases all warp accurately."""
    raw = json.loads(LANDMARKS_PATH.read_text(encoding="utf-8"))
    return {
        pid: np.array(pts, dtype=np.float32) for pid, pts in raw.items()
    }


_IMAGE_CACHE: dict[str, np.ndarray] = {}


def fetch_image(pid: str) -> np.ndarray | None:
    """Fetch a Cloudinary headshot as a BGR opencv image array.
    Cached so the full pair-sweep fetches each headshot once."""
    if pid in _IMAGE_CACHE:
        return _IMAGE_CACHE[pid]
    url = CLOUDINARY.format(id=pid)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pardle-morph"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
    except Exception as e:
        print(f"  ! fetch failed for {pid}: {e}")
        return None
    pil = Image.open(BytesIO(data)).convert("RGB").resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
    arr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    _IMAGE_CACHE[pid] = arr
    return arr


def add_boundary_points(landmarks: np.ndarray, size: int) -> np.ndarray:
    """Append image-corner + edge-midpoint points so the Delaunay mesh
    spans the full image. Without these, triangles outside the face
    contour would warp unpredictably and the warp would leave black
    regions outside the face landmarks."""
    s = size - 1
    boundary = np.array([
        [0, 0], [s // 2, 0], [s, 0],
        [s, s // 2], [s, s],
        [s // 2, s], [0, s], [0, s // 2],
    ], dtype=np.float32)
    return np.vstack([landmarks, boundary])


def face_contour_mask(p_avg: np.ndarray, size: int = OUT_SIZE) -> np.ndarray:
    """Build a soft mask from the average face-oval landmark positions.
    Pixels inside the actual face contour stay opaque; everything
    outside fades to transparent. Crucially: this mask follows the
    morph target geometry, so a wider face never bleeds outside the
    average jawline."""
    points = p_avg[FACE_OVAL_INDICES]
    mask = np.zeros((size, size), dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.int32(points), 255, lineType=cv2.LINE_AA)
    # Inflate slightly so the soft edge sits just outside the face,
    # not biting into it.
    kernel = np.ones((9, 9), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)
    # Soft feather so the boundary blends with the dark background.
    blur = max(8, size // 32)
    mask = cv2.GaussianBlur(mask, (blur * 2 + 1, blur * 2 + 1), 0)
    return mask


def landmarks_to_pixels(
    lm: np.ndarray, size: int = OUT_SIZE
) -> np.ndarray:
    """Convert normalised [0,1] landmarks to pixel coords."""
    return lm * size


def delaunay_indices(points: np.ndarray, size: int = OUT_SIZE) -> list[tuple[int, int, int]]:
    """Return list of triangle vertex indices into `points`."""
    rect = (0, 0, size, size)
    subdiv = cv2.Subdiv2D(rect)
    for p in points:
        subdiv.insert((float(p[0]), float(p[1])))
    triangles = subdiv.getTriangleList()

    # Build a lookup from approximate pixel position back to the point
    # index in our input array. cv2 sometimes shifts coords by a hair
    # so we use a small tolerance.
    out: list[tuple[int, int, int]] = []
    for t in triangles:
        x1, y1, x2, y2, x3, y3 = t
        tri_pts = [(x1, y1), (x2, y2), (x3, y3)]
        idx_for_pt: list[int] = []
        for px, py in tri_pts:
            # Find closest input point within 1px.
            distances = np.sum((points - np.array([px, py])) ** 2, axis=1)
            closest = int(np.argmin(distances))
            if distances[closest] > 4:  # 2px tolerance
                idx_for_pt = []
                break
            idx_for_pt.append(closest)
        if len(idx_for_pt) == 3:
            out.append(tuple(idx_for_pt))  # type: ignore
    return out


def warp_triangle(
    src_img: np.ndarray, dst_img: np.ndarray,
    src_tri: np.ndarray, dst_tri: np.ndarray,
) -> None:
    """Warp the source triangle into the destination triangle and paste
    into dst_img. Operates in-place on dst_img."""
    # Bounding boxes
    src_rect = cv2.boundingRect(np.float32([src_tri]))
    dst_rect = cv2.boundingRect(np.float32([dst_tri]))

    src_tri_local = [(pt[0] - src_rect[0], pt[1] - src_rect[1]) for pt in src_tri]
    dst_tri_local = [(pt[0] - dst_rect[0], pt[1] - dst_rect[1]) for pt in dst_tri]

    src_patch = src_img[src_rect[1]:src_rect[1] + src_rect[3],
                        src_rect[0]:src_rect[0] + src_rect[2]]

    if src_patch.size == 0 or dst_rect[2] == 0 or dst_rect[3] == 0:
        return

    transform = cv2.getAffineTransform(
        np.float32(src_tri_local), np.float32(dst_tri_local),
    )
    warped = cv2.warpAffine(
        src_patch, transform, (dst_rect[2], dst_rect[3]),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101,
    )

    mask = np.zeros((dst_rect[3], dst_rect[2], 3), dtype=np.float32)
    cv2.fillConvexPoly(mask, np.int32(dst_tri_local), (1.0, 1.0, 1.0), lineType=cv2.LINE_AA)

    dst_patch = dst_img[dst_rect[1]:dst_rect[1] + dst_rect[3],
                        dst_rect[0]:dst_rect[0] + dst_rect[2]]
    # Blend the warped patch into dst over the triangle's mask area.
    dst_patch[:] = dst_patch * (1 - mask) + warped * mask


def morph_pair(img_a: np.ndarray, lm_a: np.ndarray,
               img_b: np.ndarray, lm_b: np.ndarray,
               alpha: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
    """Run a full Delaunay-triangulation face morph between the two pros.
    Returns (blended_image, face_contour_mask)."""
    pa = landmarks_to_pixels(lm_a)
    pb = landmarks_to_pixels(lm_b)
    # Average landmark positions = the morph target geometry.
    p_avg = pa * (1 - alpha) + pb * alpha

    # Add boundary points so the mesh spans the entire image — without
    # them, image pixels outside the face mesh aren't covered by any
    # triangle and end up black.
    pa_full = add_boundary_points(pa, OUT_SIZE)
    pb_full = add_boundary_points(pb, OUT_SIZE)
    pavg_full = add_boundary_points(p_avg, OUT_SIZE)

    triangles = delaunay_indices(pavg_full)
    if not triangles:
        # Fall back: simple alpha blend with a flat mask.
        h, w = img_a.shape[:2]
        flat = np.full((h, w), 255, dtype=np.uint8)
        return cv2.addWeighted(img_a, 1 - alpha, img_b, alpha, 0), flat

    warped_a = np.zeros_like(img_a, dtype=np.float32)
    warped_b = np.zeros_like(img_b, dtype=np.float32)

    img_a_f = img_a.astype(np.float32)
    img_b_f = img_b.astype(np.float32)
    for (i, j, k) in triangles:
        src_tri_a = [tuple(pa_full[i]), tuple(pa_full[j]), tuple(pa_full[k])]
        src_tri_b = [tuple(pb_full[i]), tuple(pb_full[j]), tuple(pb_full[k])]
        dst_tri = [tuple(pavg_full[i]), tuple(pavg_full[j]), tuple(pavg_full[k])]
        warp_triangle(img_a_f, warped_a, src_tri_a, dst_tri)
        warp_triangle(img_b_f, warped_b, src_tri_b, dst_tri)

    blended = warped_a * (1 - alpha) + warped_b * alpha
    blended = np.clip(blended, 0, 255).astype(np.uint8)

    # Face-contour mask built from the AVERAGE landmark positions —
    # tracks the actual morphed face outline rather than a static oval.
    mask = face_contour_mask(p_avg)
    return blended, mask


def apply_contour_mask(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Composite the morphed face onto a dark BG using the per-pair
    face-contour mask. Anything outside both sources' jawlines fades
    cleanly into the background."""
    mask3 = (mask.astype(np.float32) / 255.0)[..., None]
    bg = np.full_like(img, fill_value=(15, 31, 15), dtype=np.uint8)
    out = img.astype(np.float32) * mask3 + bg.astype(np.float32) * (1 - mask3)
    return np.clip(out, 0, 255).astype(np.uint8)


def output_path(id_a: str, id_b: str) -> Path:
    a, b = sorted([id_a, id_b])
    return OUT_DIR / f"{a}_{b}.jpg"


def generate_one(id_a: str, id_b: str, landmarks: dict[str, np.ndarray],
                 force: bool = False) -> bool:
    out = output_path(id_a, id_b)
    if out.exists() and not force:
        return False
    if id_a not in landmarks or id_b not in landmarks:
        return False
    img_a = fetch_image(id_a)
    img_b = fetch_image(id_b)
    if img_a is None or img_b is None:
        return False
    morphed, mask = morph_pair(img_a, landmarks[id_a], img_b, landmarks[id_b])
    masked = apply_contour_mask(morphed, mask)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), masked, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return True


_WORKER_LANDMARKS: dict[str, np.ndarray] = {}
_WORKER_FORCE = False


def _worker_init(force: bool) -> None:
    global _WORKER_LANDMARKS, _WORKER_FORCE
    _WORKER_LANDMARKS = load_landmarks()
    _WORKER_FORCE = force


def _worker_pair(pair: tuple[str, str]) -> bool:
    a, b = pair
    try:
        return generate_one(a, b, _WORKER_LANDMARKS, force=_WORKER_FORCE)
    except Exception as e:
        print(f"  ! {a} x {b}: {e}", flush=True)
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ids", nargs="*", help="optional two IDs for a single pair")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4)))
    args = parser.parse_args()

    landmarks = load_landmarks()
    ids = sorted(landmarks.keys())

    if len(args.ids) == 2:
        ok = generate_one(args.ids[0], args.ids[1], landmarks, force=True)
        print(f"  -> {output_path(args.ids[0], args.ids[1])} ({'ok' if ok else 'failed'})")
        return

    pairs = [
        (a, b) for i, a in enumerate(ids) for b in ids[i + 1:]
    ]
    if not args.force:
        pairs = [(a, b) for a, b in pairs if not output_path(a, b).exists()]

    if not pairs:
        print("nothing to do — all pairs already exist (pass --force to regenerate)")
        return

    print(f"generating {len(pairs)} pairs across {args.workers} workers into {OUT_DIR}")
    start = time.time()
    made = 0

    if args.workers <= 1:
        for i, pair in enumerate(pairs):
            if _worker_pair_local(pair, landmarks, args.force):
                made += 1
            if (i + 1) % 25 == 0:
                elapsed = time.time() - start
                print(f"  {i + 1}/{len(pairs)} pairs ({made} new) in {elapsed:.0f}s", flush=True)
    else:
        with mp.Pool(
            processes=args.workers,
            initializer=_worker_init,
            initargs=(args.force,),
        ) as pool:
            done = 0
            for ok in pool.imap_unordered(_worker_pair, pairs, chunksize=8):
                done += 1
                if ok:
                    made += 1
                if done % 25 == 0:
                    elapsed = time.time() - start
                    print(f"  {done}/{len(pairs)} pairs ({made} new) in {elapsed:.0f}s", flush=True)

    elapsed = time.time() - start
    print(f"done — {made} pairs generated in {elapsed:.0f}s")


def _worker_pair_local(pair, landmarks, force):
    a, b = pair
    return generate_one(a, b, landmarks, force=force)


if __name__ == "__main__":
    main()
