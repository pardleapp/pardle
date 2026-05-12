"""
Quick A/B for the Cloudinary transform. Saves a side-by-side image:
  - Left column: old c_fill,g_face:center crops + blend
  - Right column: new c_thumb,g_face,z_0.75 crops + blend

Run: python scripts/alignment_compare.py
"""

from __future__ import annotations

import json
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

CANONICAL_EYE_X = 0.5
CANONICAL_EYE_Y = 0.43
CANONICAL_DISTANCE = 0.2

_ALIGN = None


def alignment() -> dict:
    global _ALIGN
    if _ALIGN is None:
        try:
            _ALIGN = json.loads(
                Path("lib/data/face-alignment.json").read_text(encoding="utf-8")
            )
        except FileNotFoundError:
            _ALIGN = {}
    return _ALIGN


def align_image(img: Image.Image, pid: str) -> Image.Image:
    a = alignment().get(pid)
    if not a:
        return img
    w, h = img.size
    eye_mid_x = (a["leftEye"][0] + a["rightEye"][0]) / 2
    eye_mid_y = (a["leftEye"][1] + a["rightEye"][1]) / 2
    scale = CANONICAL_DISTANCE / a["distance"]
    angle = -a["angle"]
    new_w = int(w * scale)
    new_h = int(h * scale)
    scaled = img.resize((new_w, new_h), Image.LANCZOS)
    if abs(angle) > 0.1:
        scaled = scaled.rotate(angle, resample=Image.BICUBIC, expand=False)
    tx = int((CANONICAL_EYE_X - eye_mid_x * scale) * w)
    ty = int((CANONICAL_EYE_Y - eye_mid_y * scale) * h)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(scaled, (tx, ty), scaled if scaled.mode == "RGBA" else None)
    return canvas

PAIRS = [
    ("46046", "28237", "Scheffler × Rory"),       # similar build, baseline
    ("47959", "57366", "Bryson × Cam Young"),     # tall vs medium
    ("52453", "57366", "Hojgaard × Cam Young"),   # the user's reference
    ("01810", "08793", "Phil × Tiger"),           # legends
]

OLD_TPL = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_fill,g_face:center,h_400,w_400,q_auto,f_auto/headshots_{id}.png"
)
NEW_TPL = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_thumb,g_face,z_0.75,h_400,w_400,q_auto,f_auto/headshots_{id}.png"
)


def fetch(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "pardle-cmp"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return Image.open(BytesIO(r.read())).convert("RGBA").resize((400, 400), Image.LANCZOS)


def blend(a: Image.Image, b: Image.Image) -> Image.Image:
    out = Image.blend(a, b, 0.5)
    out = ImageEnhance.Contrast(out).enhance(1.05)
    out = ImageEnhance.Color(out).enhance(1.06)
    return out


def main() -> None:
    cell = 400
    pad = 16
    cols = 6  # 3 imgs (a, blend, b) × 2 modes (old/new)
    rows = len(PAIRS)
    label_h = 50
    width = cols * cell + (cols + 1) * pad
    height = rows * (cell + label_h) + (rows + 1) * pad
    canvas = Image.new("RGB", (width, height), (15, 31, 15))
    draw = ImageDraw.Draw(canvas)

    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 28)
        small = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
        small = ImageFont.load_default()

    for r, (a_id, b_id, label) in enumerate(PAIRS):
        print(f"  {label}")
        y = pad + r * (cell + label_h + pad)
        # Old: just Cloudinary c_thumb, no alignment
        a_old = fetch(NEW_TPL.format(id=a_id))
        b_old = fetch(NEW_TPL.format(id=b_id))
        bl_old = blend(a_old, b_old)
        # New: with face-landmark alignment
        a_new = align_image(a_old.copy(), a_id)
        b_new = align_image(b_old.copy(), b_id)
        bl_new = blend(a_new, b_new)

        for i, img in enumerate([a_old, bl_old, b_old, a_new, bl_new, b_new]):
            x = pad + i * (cell + pad)
            canvas.paste(img.convert("RGB"), (x, y))

        # Label across the row's bottom
        ty = y + cell + 8
        draw.text((pad, ty), f"NO ALIGNMENT  <-->  EYE-ALIGNED   ({label})",
                  font=small, fill=(255, 255, 255))

    canvas.save("alignment_compare.png")
    print("saved alignment_compare.png")


if __name__ == "__main__":
    main()
