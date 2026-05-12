"""
Quick preview script: blend two PGA Tour headshots into one ambiguous
face, exactly as the Pardle Faces game does it (50% alpha overlay).

Usage:
    python scripts/blend_preview.py <pgaTourId1> <pgaTourId2> <output.png>
"""

from __future__ import annotations

import json
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageEnhance

CLOUDINARY = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_thumb,g_face,z_0.75,h_400,w_400,q_auto,f_auto/"
    "headshots_{id}.png"
)

# Canonical alignment params — match lib/data/face-alignment.ts so the
# Python output matches what the web renders.
CANONICAL_EYE_X = 0.5
CANONICAL_EYE_Y = 0.43
CANONICAL_DISTANCE = 0.2

_ALIGN_CACHE: dict | None = None


def load_alignment() -> dict:
    global _ALIGN_CACHE
    if _ALIGN_CACHE is None:
        try:
            _ALIGN_CACHE = json.loads(
                Path("lib/data/face-alignment.json").read_text(encoding="utf-8"),
            )
        except FileNotFoundError:
            _ALIGN_CACHE = {}
    return _ALIGN_CACHE


def align_image(img: Image.Image, player_id: str) -> Image.Image:
    """Apply translate+scale+rotate to land this pro's eyes on the
    canonical canvas position. Returns the transformed image at the
    same size as input (canvas is the rendered output, transform
    happens in canvas-space)."""
    aligns = load_alignment().get(player_id)
    if not aligns:
        return img
    w, h = img.size
    eye_mid_x = (aligns["leftEye"][0] + aligns["rightEye"][0]) / 2
    eye_mid_y = (aligns["leftEye"][1] + aligns["rightEye"][1]) / 2
    scale = CANONICAL_DISTANCE / aligns["distance"]
    angle = -aligns["angle"]  # degrees, negative because PIL rotates counter-clockwise

    # 1. Scale around (0,0). PIL doesn't do this directly; use resize.
    new_w = int(w * scale)
    new_h = int(h * scale)
    scaled = img.resize((new_w, new_h), Image.LANCZOS)
    # 2. Rotate around image centre.
    if abs(angle) > 0.1:
        scaled = scaled.rotate(angle, resample=Image.BICUBIC, expand=False)
    # 3. Paste at translate offset so eye-mid lands at canonical position.
    tx = int((CANONICAL_EYE_X - eye_mid_x * scale) * w)
    ty = int((CANONICAL_EYE_Y - eye_mid_y * scale) * h)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(scaled, (tx, ty), scaled if scaled.mode == "RGBA" else None)
    return canvas


def fetch(player_id: str) -> Image.Image:
    url = CLOUDINARY.format(id=player_id)
    print(f"fetching {url}")
    req = urllib.request.Request(
        url, headers={"User-Agent": "pardle-blend-preview"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read()
    img = Image.open(BytesIO(data)).convert("RGBA").resize((400, 400), Image.LANCZOS)
    return align_image(img, player_id)


def blend(a: Image.Image, b: Image.Image) -> Image.Image:
    # Match the game's CSS: base at 1.0, overlay at 0.5 normal alpha.
    # The mathematical equivalent is Image.blend(a, b, 0.5).
    out = Image.blend(a, b, 0.5)
    # Match the stage filter: contrast(1.05) saturate(1.06)
    out = ImageEnhance.Contrast(out).enhance(1.05)
    out = ImageEnhance.Color(out).enhance(1.06)
    return out


def main() -> None:
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    id_a, id_b, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    a = fetch(id_a)
    b = fetch(id_b)
    blended = blend(a, b)

    # Side-by-side composite: source A, blend, source B
    composite = Image.new("RGB", (1240, 440), (15, 31, 15))
    composite.paste(a.convert("RGB"), (20, 20))
    composite.paste(blended.convert("RGB"), (420, 20))
    composite.paste(b.convert("RGB"), (820, 20))
    composite.save(out_path)
    print(f"saved {out_path}")


if __name__ == "__main__":
    main()
