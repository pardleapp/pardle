"""
Render each course's clubhouse footprint as a clean silhouette SVG.

Reads lib/data/clubhouses.ts (scraped polygons from OSM building data)
and outputs one styled silhouette per course into public/clubhouses/.

Style: bold dark silhouette on a soft parchment background, with a
subtle drop-shadow so it reads as a deliberate architectural plan
rather than a flat blob. Each silhouette is auto-rotated so the
building's longest side runs horizontal — keeps the framing
consistent across portrait and landscape footprints, and avoids the
awkward "tilted at 37°" look you get straight from OSM.

Also generates lib/data/clubhouse-svgs.ts — the manifest of course ids
that have a rendered silhouette, used by the Clubs page pool filter.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys

OUT_DIR = "public/clubhouses"

# SVG sizing — long edge fixed; short edge tracks the building's aspect
# ratio (after auto-rotation). The Clubs page uses a 3:2 frame with
# object-fit: contain, so portrait silhouettes letterbox cleanly into
# the parchment background of the surrounding frame.
LONG_EDGE_PX = 800
PAD_M = 6  # metres of breathing room around the building

# Visual style — parchment + ink, like a yardage book / club crest
COLORS = {
    "bg": "#f3ead5",          # warm parchment
    "ink": "#2a2a2a",         # silhouette fill
    "ink_outline": "#1a1a1a", # thin contour line
    "shadow": "#00000022",    # soft drop shadow
}


def project_to_meters(
    points: list[tuple[float, float]],
    centre_lat: float,
    centre_lng: float,
) -> list[tuple[float, float]]:
    cos_lat = math.cos(math.radians(centre_lat))
    out = []
    for lat, lng in points:
        x = (lng - centre_lng) * 111000.0 * cos_lat
        y = (lat - centre_lat) * 111000.0
        out.append((x, y))
    return out


def best_rotation_angle(points: list[tuple[float, float]]) -> float:
    """Find the rotation angle that makes the polygon's bounding box
    narrowest in the height dimension (long side horizontal).

    Brute-force rotates in 1° steps from 0..179° and picks the angle
    that minimises bbox_width/bbox_height... wait, we want the long
    side horizontal, so we pick the angle that maximises that ratio.
    """
    best_angle = 0.0
    best_ratio = 0.0
    for deg in range(0, 180):
        theta = math.radians(deg)
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        xs = [x * cos_t + y * sin_t for x, y in points]
        ys = [-x * sin_t + y * cos_t for x, y in points]
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        if h == 0:
            continue
        ratio = w / h
        if ratio > best_ratio:
            best_ratio = ratio
            best_angle = theta
    return best_angle


def render(course_id: str, record: dict) -> str | None:
    polygon = record.get("polygon") or []
    if len(polygon) < 3:
        return None

    # Project into metres using the polygon centroid as origin.
    lats = [p[0] for p in polygon]
    lngs = [p[1] for p in polygon]
    centre_lat = sum(lats) / len(lats)
    centre_lng = sum(lngs) / len(lngs)
    points_m = project_to_meters(polygon, centre_lat, centre_lng)

    # Auto-rotate so the long side runs horizontal.
    theta = best_rotation_angle(points_m)
    cos_t = math.cos(theta)
    sin_t = math.sin(theta)
    rotated = [(x * cos_t + y * sin_t, -x * sin_t + y * cos_t) for x, y in points_m]

    xs = [p[0] for p in rotated]
    ys = [p[1] for p in rotated]
    min_x = min(xs) - PAD_M
    max_x = max(xs) + PAD_M
    min_y = min(ys) - PAD_M
    max_y = max(ys) + PAD_M

    bbox_w_m = max_x - min_x
    bbox_h_m = max_y - min_y
    if bbox_w_m <= 0 or bbox_h_m <= 0:
        return None

    # SVG dimensions: long edge = LONG_EDGE_PX.
    if bbox_w_m >= bbox_h_m:
        width_px = LONG_EDGE_PX
        height_px = max(120, int(round(LONG_EDGE_PX * bbox_h_m / bbox_w_m)))
    else:
        height_px = LONG_EDGE_PX
        width_px = max(120, int(round(LONG_EDGE_PX * bbox_w_m / bbox_h_m)))
    scale_px_per_m = LONG_EDGE_PX / max(bbox_w_m, bbox_h_m)

    def to_svg(x_m: float, y_m: float) -> tuple[float, float]:
        sx = (x_m - min_x) * scale_px_per_m
        # Flip y so +y_metres-north is up in the SVG.
        sy = height_px - (y_m - min_y) * scale_px_per_m
        return sx, sy

    svg_pts = [to_svg(x, y) for x, y in rotated]
    d_parts = [f"M{svg_pts[0][0]:.1f},{svg_pts[0][1]:.1f}"]
    for sx, sy in svg_pts[1:]:
        d_parts.append(f"L{sx:.1f},{sy:.1f}")
    d_parts.append("Z")
    d = " ".join(d_parts)

    # Shadow path is the same shape, translated a few px right/down.
    shadow_offset = 4
    d_shadow_parts = [f"M{svg_pts[0][0]+shadow_offset:.1f},{svg_pts[0][1]+shadow_offset:.1f}"]
    for sx, sy in svg_pts[1:]:
        d_shadow_parts.append(f"L{sx+shadow_offset:.1f},{sy+shadow_offset:.1f}")
    d_shadow_parts.append("Z")
    d_shadow = " ".join(d_shadow_parts)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {width_px} {height_px}" '
        f'preserveAspectRatio="xMidYMid meet">',
        f'<rect width="100%" height="100%" fill="{COLORS["bg"]}"/>',
        # soft shadow
        f'<path d="{d_shadow}" fill="{COLORS["shadow"]}" stroke="none"/>',
        # silhouette
        f'<path d="{d}" fill="{COLORS["ink"]}" '
        f'stroke="{COLORS["ink_outline"]}" stroke-width="1.5" '
        f'stroke-linejoin="round"/>',
        "</svg>",
    ]
    return "\n".join(parts)


def load_clubhouses() -> dict:
    with open("lib/data/clubhouses.ts", "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(
        r"export const CLUBHOUSES: Record<string, Clubhouse> = (\{.*?\});",
        text,
        re.DOTALL,
    )
    if not m:
        raise RuntimeError("clubhouses.ts not in expected format")
    return json.loads(m.group(1))


def main() -> int:
    data = load_clubhouses()
    os.makedirs(OUT_DIR, exist_ok=True)
    rendered_ids: list[str] = []
    for course_id, record in data.items():
        svg = render(course_id, record)
        if not svg:
            print(f"skip {course_id} (bad polygon)")
            continue
        out_path = os.path.join(OUT_DIR, f"{course_id}.svg")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(svg)
        rendered_ids.append(course_id)

    on_disk = sorted(
        os.path.splitext(f)[0]
        for f in os.listdir(OUT_DIR)
        if f.endswith(".svg")
    )
    ids_path = "lib/data/clubhouse-svgs.ts"
    with open(ids_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/render_clubhouse_svgs.py.\n")
        f.write("// Course ids that have a rendered clubhouse silhouette\n")
        f.write("// at public/clubhouses/<id>.svg. The Clubs page pool is\n")
        f.write("// restricted to this set so every puzzle has art to show.\n\n")
        f.write("export const CLUBHOUSE_SVG_IDS: ReadonlySet<string> = new Set([\n")
        for cid in on_disk:
            f.write(f'  "{cid}",\n')
        f.write("]);\n")
    print(f"Wrote {len(rendered_ids)} silhouettes to {OUT_DIR}/")
    print(f"Wrote {len(on_disk)} ids to {ids_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
