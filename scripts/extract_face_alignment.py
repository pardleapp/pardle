"""
Build a per-pro face-alignment map for the Faces blend.

For each PGA Tour ID we know about, fetch the Cloudinary headshot we
serve in-game (same exact URL the browser fetches, so alignment maths
match render-time geometry), run mediapipe FaceMesh to find the eye
landmarks, and write a JSON file:

    lib/data/face-alignment.json

Each entry holds normalised eye-centre positions (0..1 within the
400x400 cropped headshot) plus the inter-eye distance. At render time
the frontend uses these to translate + scale each face so the eyes
land at the same canonical screen position across all pros.

Run:
    python scripts/extract_face_alignment.py

Requires: pip install mediapipe pillow numpy

Re-run any time PGA_TOUR_IDS gets new entries.
"""

from __future__ import annotations

import json
import re
import urllib.request
from io import BytesIO
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
from PIL import Image

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
MODEL_PATH = Path("scripts/.face_landmarker.task")

# Same transform used at render time. Crops match exactly so eye coords
# computed here are directly applicable to the in-app rendered image.
CLOUDINARY = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_thumb,g_face,z_0.75,h_400,w_400,q_auto,f_auto/"
    "headshots_{id}.png"
)

# mediapipe FaceMesh landmark indices for the eye centres.
# These approximate the iris centre on each side.
LEFT_EYE_IDX = 468  # left iris centre
RIGHT_EYE_IDX = 473  # right iris centre


def read_pga_ids() -> dict[str, str]:
    """Parse lib/data/pga-tour-ids.ts and pull out the slug → id map.
    Cheap regex is enough — the file is hand-edited and well-formed."""
    src = Path("lib/data/pga-tour-ids.ts").read_text(encoding="utf-8")
    out: dict[str, str] = {}
    pat = re.compile(r'^\s*"([a-z0-9\-À-ſ]+)":\s*"(\d{4,6})",\s*$', re.MULTILINE)
    for m in pat.finditer(src):
        slug, pid = m.group(1), m.group(2)
        out[slug] = pid
    return out


def fetch_image(pid: str) -> Image.Image | None:
    url = CLOUDINARY.format(id=pid)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pardle-align"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return Image.open(BytesIO(r.read())).convert("RGB")
    except Exception as e:
        print(f"  ! fetch failed for {pid}: {e}")
        return None


def extract_eyes(img: Image.Image, detector) -> dict | None:
    """Return normalised eye-centre coords + inter-eye distance, or None
    if mediapipe couldn't find a face."""
    arr = np.array(img)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=arr)
    res = detector.detect(mp_image)
    if not res.face_landmarks:
        return None
    lm = res.face_landmarks[0]
    if len(lm) <= max(LEFT_EYE_IDX, RIGHT_EYE_IDX):
        return None
    le = lm[LEFT_EYE_IDX]
    re = lm[RIGHT_EYE_IDX]
    # mediapipe returns x,y already normalised to image dims (0..1).
    # The "left eye" in mediapipe is anatomically the subject's left,
    # so it appears on the RIGHT side of the image. We name them by
    # screen position to keep render-time code intuitive.
    if le.x < re.x:
        screen_left = (le.x, le.y)
        screen_right = (re.x, re.y)
    else:
        screen_left = (re.x, re.y)
        screen_right = (le.x, le.y)
    dx = screen_right[0] - screen_left[0]
    dy = screen_right[1] - screen_left[1]
    distance = float(np.hypot(dx, dy))
    angle_deg = float(np.degrees(np.arctan2(dy, dx)))
    return {
        "leftEye": [round(screen_left[0], 4), round(screen_left[1], 4)],
        "rightEye": [round(screen_right[0], 4), round(screen_right[1], 4)],
        "distance": round(distance, 4),
        "angle": round(angle_deg, 2),
    }


def ensure_model() -> Path:
    if MODEL_PATH.exists():
        return MODEL_PATH
    print(f"  downloading face_landmarker model -> {MODEL_PATH}")
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def main() -> None:
    pga_ids = read_pga_ids()
    print(f"loaded {len(pga_ids)} pros from lib/data/pga-tour-ids.ts")

    model = ensure_model()
    base_options = mp_tasks.BaseOptions(model_asset_path=str(model))
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
    )
    detector = vision.FaceLandmarker.create_from_options(options)

    out: dict[str, dict] = {}
    skipped: list[str] = []
    for slug, pid in pga_ids.items():
        print(f"  {slug} ({pid})")
        img = fetch_image(pid)
        if img is None:
            skipped.append(slug)
            continue
        align = extract_eyes(img, detector)
        if align is None:
            print(f"    no face detected — skipping")
            skipped.append(slug)
            continue
        out[pid] = align

    target = Path("lib/data/face-alignment.json")
    target.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(f"\nwrote {len(out)} alignments to {target}")
    if skipped:
        print(f"skipped {len(skipped)}: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
