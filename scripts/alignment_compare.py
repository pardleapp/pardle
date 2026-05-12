"""
Quick A/B for the Cloudinary transform. Saves a side-by-side image:
  - Left column: old c_fill,g_face:center crops + blend
  - Right column: new c_thumb,g_face,z_0.75 crops + blend

Run: python scripts/alignment_compare.py
"""

from __future__ import annotations

import urllib.request
from io import BytesIO

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

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
        # Old
        a_old = fetch(OLD_TPL.format(id=a_id))
        b_old = fetch(OLD_TPL.format(id=b_id))
        bl_old = blend(a_old, b_old)
        # New
        a_new = fetch(NEW_TPL.format(id=a_id))
        b_new = fetch(NEW_TPL.format(id=b_id))
        bl_new = blend(a_new, b_new)

        for i, img in enumerate([a_old, bl_old, b_old, a_new, bl_new, b_new]):
            x = pad + i * (cell + pad)
            canvas.paste(img.convert("RGB"), (x, y))

        # Label across the row's bottom
        ty = y + cell + 8
        draw.text((pad, ty), f"OLD  c_fill,g_face:center   ←  →   NEW  c_thumb,g_face,z_0.75   ({label})",
                  font=small, fill=(255, 255, 255))

    canvas.save("alignment_compare.png")
    print("saved alignment_compare.png")


if __name__ == "__main__":
    main()
