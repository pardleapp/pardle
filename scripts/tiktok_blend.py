"""
Pardle Faces — TikTok-ready blend → reveal video generator.

Produces a 9:16 portrait MP4 (1080×1920) optimised for TikTok / Reels /
Shorts. Shows:
  - 0.5s   PARDLE / FACES brand title fades in
  - 4.0s   the blend image (two pros at 50/50) with "Can you name them?"
  - 0.4s   the two faces animate apart (translate + scale, mirrors the
           in-game unblend reveal)
  - 2.5s   both pros revealed by name with "pardle.app/faces" CTA

Usage:
    python scripts/tiktok_blend.py <pgaTourId1> <pgaTourId2> "Pro A name" "Pro B name" [output.mp4]

Example:
    python scripts/tiktok_blend.py 52453 57366 "Nicolai Hojgaard" "Cameron Young"

Requires: pip install pillow imageio imageio-ffmpeg
"""

from __future__ import annotations

import json
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

# Canonical alignment params — match lib/data/face-alignment.ts.
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
    aligns = load_alignment().get(player_id)
    if not aligns:
        return img
    w, h = img.size
    eye_mid_x = (aligns["leftEye"][0] + aligns["rightEye"][0]) / 2
    eye_mid_y = (aligns["leftEye"][1] + aligns["rightEye"][1]) / 2
    scale = CANONICAL_DISTANCE / aligns["distance"]
    angle = -aligns["angle"]
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

# ---- video config ----
W, H = 1080, 1920
FPS = 30
DUR_INTRO = 0.5  # PARDLE / FACES title
DUR_BLEND = 4.0  # blended image + "Can you name them?"
DUR_REVEAL = 0.4  # animation: blend splits into two faces
DUR_OUTRO = 2.5  # both pros named + CTA

ACCENT = (224, 123, 91)
BG_TOP = (15, 31, 15)
BG_BOTTOM = (44, 90, 40)

CLOUDINARY = (
    "https://pga-tour-res.cloudinary.com/image/upload/"
    "c_thumb,g_face,z_0.75,h_600,w_600,q_auto,f_auto/"
    "headshots_{id}.png"
)


def fetch_headshot(pid: str) -> Image.Image:
    url = CLOUDINARY.format(id=pid)
    print(f"  fetching {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "pardle-tiktok"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read()
    img = Image.open(BytesIO(data)).convert("RGBA").resize((600, 600), Image.LANCZOS)
    return align_image(img, pid)


def background() -> Image.Image:
    """Vertical green gradient — same vibe as the site / OG cards."""
    bg = Image.new("RGB", (W, H), BG_TOP)
    draw = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        r = int(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t)
        g = int(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t)
        b = int(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    return bg


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_centered(draw: ImageDraw.ImageDraw, text: str, y: int, f: ImageFont.FreeTypeFont, fill=(255, 255, 255)) -> None:
    bbox = draw.textbbox((0, 0), text, font=f)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) / 2, y), text, font=f, fill=fill)


def blend_pair(a: Image.Image, b: Image.Image) -> Image.Image:
    """50/50 alpha blend matching the in-game default. Returns 600×600 RGBA."""
    out = Image.blend(a, b, 0.5)
    out = ImageEnhance.Contrast(out).enhance(1.05)
    out = ImageEnhance.Color(out).enhance(1.06)
    return out


def paste_centered_block(bg: Image.Image, fg: Image.Image, cx: int, cy: int) -> None:
    fw, fh = fg.size
    bg.paste(fg, (cx - fw // 2, cy - fh // 2), fg if fg.mode == "RGBA" else None)


def frame_intro(t: float) -> Image.Image:
    """Brand title fading in."""
    bg = background()
    draw = ImageDraw.Draw(bg)
    alpha = min(1.0, t / DUR_INTRO * 2)
    if alpha <= 0:
        return bg
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(overlay)
    fade = int(255 * alpha)
    title_font = font(96)
    accent_font = font(144)
    d2.text((0, 0), "", font=title_font)
    bbox = d2.textbbox((0, 0), "PARDLE", font=title_font)
    tw = bbox[2] - bbox[0]
    d2.text(((W - tw) / 2, H // 2 - 200), "PARDLE", font=title_font, fill=(255, 255, 255, fade))
    bbox = d2.textbbox((0, 0), "FACES", font=accent_font)
    tw = bbox[2] - bbox[0]
    d2.text(((W - tw) / 2, H // 2 - 70), "FACES", font=accent_font, fill=(*ACCENT, fade))
    bg.paste(overlay, (0, 0), overlay)
    return bg


def frame_blend(blend_img: Image.Image) -> Image.Image:
    """The mysterious blend with prompt text. Static for DUR_BLEND."""
    bg = background()
    draw = ImageDraw.Draw(bg)

    draw_centered(draw, "Can you name", 280, font(72))
    draw_centered(draw, "them both?", 380, font(72))

    # Hero blend image, big and centred
    hero = blend_img.copy()
    hero = hero.resize((780, 780), Image.LANCZOS)
    paste_centered_block(bg, hero, W // 2, 1000)
    return bg


def frame_reveal(t: float, a: Image.Image, b: Image.Image) -> Image.Image:
    """Animated split: at t=0 the two are blended; at t=1 they sit side-by-side."""
    bg = background()
    progress = max(0.0, min(1.0, t / DUR_REVEAL))

    # Each image starts at 780×780 in centre. End: 380×380 in its half.
    start_size = 780
    end_size = 380
    cur_size = int(start_size + (end_size - start_size) * progress)
    start_cx = W // 2
    end_cx_a = W // 2 - 220
    end_cx_b = W // 2 + 220
    cur_cx_a = int(start_cx + (end_cx_a - start_cx) * progress)
    cur_cx_b = int(start_cx + (end_cx_b - start_cx) * progress)
    # Opacity for B: starts at 0.5 (blended) ends at 1.0 (solo)
    alpha_a = 1.0  # base always full
    alpha_b = 0.5 + 0.5 * progress

    img_a = a.resize((cur_size, cur_size), Image.LANCZOS)
    img_b = b.resize((cur_size, cur_size), Image.LANCZOS)

    if alpha_b < 1.0:
        # apply opacity to overlay
        layer = img_b.copy()
        alpha_band = layer.split()[3].point(lambda v: int(v * alpha_b))
        layer.putalpha(alpha_band)
        img_b = layer

    paste_centered_block(bg, img_a, cur_cx_a, 1000)
    paste_centered_block(bg, img_b, cur_cx_b, 1000)

    draw = ImageDraw.Draw(bg)
    draw_centered(draw, "Can you name", 280, font(72))
    draw_centered(draw, "them both?", 380, font(72))
    return bg


def frame_outro(name_a: str, name_b: str, a: Image.Image, b: Image.Image) -> Image.Image:
    """Final reveal — brand-only CTA, no clickable-looking URL so the
    video doesn't trigger TikTok's external-link demotion filter. The
    link lives in the bio + pinned comment instead."""
    bg = background()
    draw = ImageDraw.Draw(bg)

    draw_centered(draw, "It's...", 280, font(80))

    end_size = 380
    img_a = a.resize((end_size, end_size), Image.LANCZOS)
    img_b = b.resize((end_size, end_size), Image.LANCZOS)
    paste_centered_block(bg, img_a, W // 2 - 220, 800)
    paste_centered_block(bg, img_b, W // 2 + 220, 800)

    name_font = font(48)
    bbox = draw.textbbox((0, 0), name_a, font=name_font)
    draw.text((W // 2 - 220 - (bbox[2] - bbox[0]) / 2, 1020), name_a, font=name_font, fill=(255, 255, 255))
    bbox = draw.textbbox((0, 0), name_b, font=name_font)
    draw.text((W // 2 + 220 - (bbox[2] - bbox[0]) / 2, 1020), name_b, font=name_font, fill=(255, 255, 255))

    draw_centered(draw, "6 more daily", 1380, font(64))
    draw_centered(draw, "PARDLE", 1490, font(112), fill=ACCENT)
    return bg


def main() -> None:
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)
    id_a, id_b, name_a, name_b = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    out_path = sys.argv[5] if len(sys.argv) > 5 else f"tiktok_{id_a}_{id_b}.mp4"

    print(f"building tiktok video: {name_a} × {name_b}")
    a = fetch_headshot(id_a)
    b = fetch_headshot(id_b)
    blended = blend_pair(a, b)

    print(f"  encoding to {out_path}")
    writer = imageio.get_writer(out_path, fps=FPS, codec="libx264", quality=8, macro_block_size=1)

    intro_frames = int(DUR_INTRO * FPS)
    blend_frames = int(DUR_BLEND * FPS)
    reveal_frames = int(DUR_REVEAL * FPS)
    outro_frames = int(DUR_OUTRO * FPS)

    blend_static = frame_blend(blended)
    outro_static = frame_outro(name_a, name_b, a, b)

    for f in range(intro_frames):
        writer.append_data(np.asarray(frame_intro(f / FPS)))
    for _ in range(blend_frames):
        writer.append_data(np.asarray(blend_static))
    for f in range(reveal_frames):
        writer.append_data(np.asarray(frame_reveal(f / FPS, a, b)))
    for _ in range(outro_frames):
        writer.append_data(np.asarray(outro_static))

    writer.close()
    print(f"  done: {out_path}")


if __name__ == "__main__":
    main()
