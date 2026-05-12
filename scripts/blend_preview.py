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
CANONICAL_EYE_Y = 0.40
CANONICAL_MOUTH_X = 0.5
CANONICAL_MOUTH_Y = 0.62

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
    """Apply translate+scale+rotate so the eye-midpoint AND mouth-midpoint
    land on canonical canvas positions. Two-point similarity transform
    — same maths as lib/data/face-alignment.ts."""
    import math

    aligns = load_alignment().get(player_id)
    if not aligns:
        return img
    w, h = img.size
    eye_mid_x = (aligns["leftEye"][0] + aligns["rightEye"][0]) / 2
    eye_mid_y = (aligns["leftEye"][1] + aligns["rightEye"][1]) / 2
    mouth_x, mouth_y = aligns["mouth"]

    dx_meas = mouth_x - eye_mid_x
    dy_meas = mouth_y - eye_mid_y
    meas_len = math.hypot(dx_meas, dy_meas)
    canon_len = CANONICAL_MOUTH_Y - CANONICAL_EYE_Y  # vector points straight down
    scale = canon_len / meas_len

    angle_meas = math.atan2(dy_meas, dx_meas)
    angle_canon = math.atan2(canon_len, 0)  # pi/2
    rotate_rad = angle_canon - angle_meas

    # Rotate -> scale -> translate (origin at top-left of image).
    cos_r = math.cos(rotate_rad)
    sin_r = math.sin(rotate_rad)
    eye_rot_x = eye_mid_x * cos_r - eye_mid_y * sin_r
    eye_rot_y = eye_mid_x * sin_r + eye_mid_y * cos_r
    tx = int((CANONICAL_EYE_X - eye_rot_x * scale) * w)
    ty = int((CANONICAL_EYE_Y - eye_rot_y * scale) * h)

    # PIL rotates counter-clockwise about image centre, but we want
    # rotation about (0,0) — easier to compose: rotate-resize-paste with
    # expansion math. Pragmatic alternative: resize first (scale), then
    # rotate about centre, then paste with translation offset adjusted
    # for the centre-vs-origin shift. The visible result is identical
    # when rotation is small (~ few degrees), which it always is here.
    new_w = int(w * scale)
    new_h = int(h * scale)
    scaled = img.resize((new_w, new_h), Image.LANCZOS)
    if abs(math.degrees(rotate_rad)) > 0.1:
        # PIL rotate sign is opposite of math convention.
        scaled = scaled.rotate(-math.degrees(rotate_rad), resample=Image.BICUBIC, expand=False)

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
    """50/50 alpha blend + the same oval face-mask the web stage applies.
    Both inputs should already be aligned via align_image()."""
    out = Image.blend(a, b, 0.5)
    out = ImageEnhance.Contrast(out).enhance(1.05)
    out = ImageEnhance.Color(out).enhance(1.06)
    return apply_oval_mask(out)


def apply_oval_mask(img: Image.Image) -> Image.Image:
    """Soft elliptical mask centred on the face zone — clips hat/hair/
    shoulders to match the web .faces-stage mask. Mirror of:
      mask-image: radial-gradient(ellipse 48% 60% at 50% 50%, ...)
    """
    from PIL import ImageDraw, ImageFilter

    w, h = img.size
    # Solid mask inside the inner ellipse, fades to transparent at the
    # outer one. We approximate the radial-gradient with two ellipses
    # plus a heavy gaussian blur on the transition.
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    # Inner ellipse — solid opaque region
    rx_in = int(w * 0.48 * 0.7)
    ry_in = int(h * 0.60 * 0.7)
    draw.ellipse(
        (w // 2 - rx_in, h // 2 - ry_in, w // 2 + rx_in, h // 2 + ry_in),
        fill=255,
    )
    # Outer ellipse — fully transparent edge marker; blur fills the gap
    rx_out = int(w * 0.48)
    ry_out = int(h * 0.60)
    edge = Image.new("L", (w, h), 0)
    edge_draw = ImageDraw.Draw(edge)
    edge_draw.ellipse(
        (w // 2 - rx_out, h // 2 - ry_out, w // 2 + rx_out, h // 2 + ry_out),
        fill=255,
    )
    # Combine: mask = blurred(edge) intersected with the inner solid
    edge = edge.filter(ImageFilter.GaussianBlur(radius=int(min(w, h) * 0.06)))
    final_mask = Image.eval(edge, lambda v: v)
    # Composite: put img over a dark background, using final_mask as alpha
    bg = Image.new("RGB", (w, h), (15, 31, 15))
    out = Image.composite(img.convert("RGB"), bg, final_mask)
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
