"""
Pull the full 478-point mediapipe FaceMesh landmark set for every PGA
Tour ID we know about, and write to lib/data/face-landmarks.json.

The full landmark set is what the offline face-morph pipeline
(scripts/generate_morphed_blends.py) needs to do Delaunay-triangulation
warping. The lighter face-alignment.json (eyes + mouth only) is still
used by the in-browser CSS overlay path.

Run:
    python scripts/extract_full_landmarks.py
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

CLOUDINARY = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_thumb,g_face,z_0.75,h_400,w_400,q_auto,f_auto/"
    "headshots_{id}.png"
)

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
MODEL_PATH = Path("scripts/.face_landmarker.task")


def read_pga_ids() -> dict[str, str]:
    src = Path("lib/data/pga-tour-ids.ts").read_text(encoding="utf-8")
    out: dict[str, str] = {}
    pat = re.compile(r'^\s*"([a-z0-9\-À-ſ]+)":\s*"(\d{4,6})",\s*$', re.MULTILINE)
    for m in pat.finditer(src):
        out[m.group(1)] = m.group(2)
    return out


def fetch_image(pid: str) -> Image.Image | None:
    url = CLOUDINARY.format(id=pid)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pardle-lm"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return Image.open(BytesIO(r.read())).convert("RGB")
    except Exception as e:
        print(f"  ! fetch failed for {pid}: {e}")
        return None


def ensure_model() -> Path:
    if MODEL_PATH.exists():
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def main() -> None:
    pga_ids = read_pga_ids()
    print(f"loaded {len(pga_ids)} pros")

    base_options = mp_tasks.BaseOptions(model_asset_path=str(ensure_model()))
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
    )
    detector = vision.FaceLandmarker.create_from_options(options)

    out: dict[str, list[list[float]]] = {}
    skipped: list[str] = []

    for slug, pid in pga_ids.items():
        print(f"  {slug} ({pid})")
        img = fetch_image(pid)
        if img is None:
            skipped.append(slug)
            continue
        arr = np.array(img)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=arr)
        res = detector.detect(mp_image)
        if not res.face_landmarks:
            print("    no face detected")
            skipped.append(slug)
            continue
        lm = res.face_landmarks[0]
        # Store normalised [x, y] only (z unused for 2D morph).
        out[pid] = [[round(p.x, 4), round(p.y, 4)] for p in lm]

    target = Path("lib/data/face-landmarks.json")
    target.write_text(json.dumps(out), encoding="utf-8")
    size_kb = target.stat().st_size / 1024
    print(f"\nwrote {len(out)} landmark sets to {target} ({size_kb:.1f} KB)")
    if skipped:
        print(f"skipped {len(skipped)}: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
