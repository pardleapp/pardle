"""
Quick preview script: blend two PGA Tour headshots into one ambiguous
face, exactly as the Pardle Faces game does it (50% alpha overlay).

Usage:
    python scripts/blend_preview.py <pgaTourId1> <pgaTourId2> <output.png>
"""

from __future__ import annotations

import sys
import urllib.request

from PIL import Image, ImageEnhance
from io import BytesIO

CLOUDINARY = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_fill,g_face:center,h_400,w_400,q_auto,f_auto/"
    "headshots_{id}.png"
)


def fetch(player_id: str) -> Image.Image:
    url = CLOUDINARY.format(id=player_id)
    print(f"fetching {url}")
    req = urllib.request.Request(
        url, headers={"User-Agent": "pardle-blend-preview"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read()
    img = Image.open(BytesIO(data)).convert("RGBA")
    return img.resize((400, 400), Image.LANCZOS)


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
