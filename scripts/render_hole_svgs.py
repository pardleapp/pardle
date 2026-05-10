"""
Render a clean single-hole illustration per course as an SVG, drawn from
OpenStreetMap golf=* polygon data. The output is a yardage-book-style
view (fairway, green, bunkers, water, trees, tee) of one hole only —
no clubhouse, no parking, no neighbouring holes.

For each course in lib/data/hole-coords.ts that has a polyline (the
green-end coordinate) we:
  1. Fetch every golf=* way + natural=water polygon within a tight
     radius around the green.
  2. Project lat/lng -> local meters using an equirectangular
     approximation centred on the green.
  3. Render an SVG with styled polygons (greens, fairway, bunkers,
     water, trees) plus the hole's polyline in gold on top.
  4. Save to public/holes/<course-id>.svg.

The Holes page swaps the Mapbox satellite for this SVG when in hard
mode, giving every hole the same clean illustrated look.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "PardleScraper/0.1 (https://pardle.app)"

OUT_DIR = "public/holes"
WIDTH = 800
HEIGHT = 600
RADIUS_M = 280  # tight enough to exclude neighbouring holes most of the time

# Visual style
COLORS = {
    "bg": "#143018",
    "rough": "#2b5a2a",
    "fairway": "#5a9540",
    "green": "#2f7825",
    "tee": "#4f8a3e",
    "bunker": "#e7d6a3",
    "water": "#2e5577",
    "tree": "#0f2810",
    "path": "#a6927a",
    "hole_line": "#ffd64a",
}


def fetch_features(lat: float, lng: float) -> dict:
    """Return raw OSM features within RADIUS_M of (lat, lng)."""
    query = f"""[out:json][timeout:30];
(
  way(around:{RADIUS_M},{lat},{lng})["golf"];
  way(around:{RADIUS_M},{lat},{lng})["natural"="water"];
  way(around:{RADIUS_M},{lat},{lng})["natural"="wood"];
  way(around:{RADIUS_M},{lat},{lng})["leisure"="pitch"];
);
out geom tags;"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        OVERPASS, data=data, headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def project_to_meters(
    points: list[tuple[float, float]],
    centre_lat: float,
    centre_lng: float,
) -> list[tuple[float, float]]:
    """Equirectangular projection — (lat, lng) -> (x_m, y_m) where +x is
    east and +y is north of the centre."""
    cos_lat = math.cos(math.radians(centre_lat))
    out = []
    for lat, lng in points:
        x = (lng - centre_lng) * 111000.0 * cos_lat
        y = (lat - centre_lat) * 111000.0
        out.append((x, y))
    return out


def meters_to_svg(
    points: list[tuple[float, float]],
    half_width_m: float,
    half_height_m: float,
) -> list[tuple[float, float]]:
    """Map meters-from-centre to SVG pixel coords (0..WIDTH, 0..HEIGHT).
    +y in meters is north, +y in SVG is down — so we flip y."""
    out = []
    for x, y in points:
        sx = WIDTH / 2 + (x / half_width_m) * (WIDTH / 2)
        sy = HEIGHT / 2 - (y / half_height_m) * (HEIGHT / 2)
        out.append((sx, sy))
    return out


def classify(tags: dict) -> str | None:
    """Map OSM tags to a render layer keyword. Order matters: greens
    should win over fairway etc."""
    golf = tags.get("golf")
    if golf == "green":
        return "green"
    if golf == "tee":
        return "tee"
    if golf == "bunker":
        return "bunker"
    if golf == "fairway":
        return "fairway"
    if golf == "rough":
        return "rough"
    if golf == "water_hazard" or tags.get("natural") == "water":
        return "water"
    if tags.get("natural") == "wood":
        return "tree"
    if golf == "cartpath" or golf == "path":
        return "path"
    return None


def decode_polyline(s: str) -> list[tuple[float, float]]:
    """Decode a Google-encoded polyline back into (lat, lng) tuples."""
    coords: list[tuple[float, float]] = []
    i = 0
    lat = 0
    lng = 0
    while i < len(s):
        # latitude
        result = 0
        shift = 0
        while True:
            b = ord(s[i]) - 63
            i += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if not (b & 0x20):
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat
        # longitude
        result = 0
        shift = 0
        while True:
            b = ord(s[i]) - 63
            i += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if not (b & 0x20):
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng
        coords.append((lat / 1e5, lng / 1e5))
    return coords


# Render order: lowest to highest in z (later = drawn on top)
LAYER_ORDER = ["tree", "rough", "fairway", "water", "bunker", "tee", "green"]


def svg_path_from_points(points: list[tuple[float, float]]) -> str:
    if not points:
        return ""
    parts = [f"M{points[0][0]:.1f},{points[0][1]:.1f}"]
    for x, y in points[1:]:
        parts.append(f"L{x:.1f},{y:.1f}")
    parts.append("Z")
    return " ".join(parts)


def render_course(course_id: str, hole_record: dict) -> str | None:
    centre_lat = hole_record["lat"]
    centre_lng = hole_record["lng"]
    print(f"  fetching features...", flush=True)
    try:
        features = fetch_features(centre_lat, centre_lng)
    except Exception as exc:
        print(f"  fetch error: {exc}", file=sys.stderr)
        return None

    half_w_m = RADIUS_M
    half_h_m = RADIUS_M * (HEIGHT / WIDTH)

    by_layer: dict[str, list[list[tuple[float, float]]]] = {
        k: [] for k in LAYER_ORDER
    }
    for el in features.get("elements", []):
        tags = el.get("tags") or {}
        layer = classify(tags)
        if not layer or layer not in by_layer:
            continue
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        latlngs = [(p["lat"], p["lon"]) for p in geom]
        meters = project_to_meters(latlngs, centre_lat, centre_lng)
        # Skip features whose centroid is outside the visible frame —
        # they don't add useful context.
        cx = sum(x for x, _ in meters) / len(meters)
        cy = sum(y for _, y in meters) / len(meters)
        if abs(cx) > half_w_m * 1.4 or abs(cy) > half_h_m * 1.4:
            continue
        svg_pts = meters_to_svg(meters, half_w_m, half_h_m)
        by_layer[layer].append(svg_pts)

    # Build SVG
    parts = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}" '
        f'preserveAspectRatio="xMidYMid slice">'
    )
    parts.append(f'<rect width="100%" height="100%" fill="{COLORS["bg"]}"/>')

    for layer in LAYER_ORDER:
        if not by_layer[layer]:
            continue
        fill = COLORS[layer]
        for poly in by_layer[layer]:
            d = svg_path_from_points(poly)
            if not d:
                continue
            parts.append(f'<path d="{d}" fill="{fill}" stroke="none"/>')

    # Draw the hole line over the top
    if hole_record.get("path"):
        line_latlngs = decode_polyline(hole_record["path"])
        meters = project_to_meters(line_latlngs, centre_lat, centre_lng)
        svg_pts = meters_to_svg(meters, half_w_m, half_h_m)
        d = " ".join(
            [
                f"M{svg_pts[0][0]:.1f},{svg_pts[0][1]:.1f}",
                *[f"L{x:.1f},{y:.1f}" for x, y in svg_pts[1:]],
            ]
        )
        parts.append(
            f'<path d="{d}" fill="none" stroke="{COLORS["hole_line"]}" '
            f'stroke-width="5" stroke-linecap="round" '
            f'stroke-linejoin="round" opacity="0.95"/>'
        )

    parts.append("</svg>")
    return "\n".join(parts)


def main() -> int:
    with open("lib/data/hole-coords.ts", "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(
        r"export const HOLE_COORDS: Record<string, HoleCoords> = (\{.*?\});",
        text,
        re.DOTALL,
    )
    coords = json.loads(m.group(1))
    targets = {
        k: v for k, v in coords.items() if v.get("path")
    }
    print(f"Rendering SVGs for {len(targets)} courses")

    os.makedirs(OUT_DIR, exist_ok=True)
    rendered_ids: list[str] = []
    for course_id, record in targets.items():
        print(f"[{course_id}]")
        svg = render_course(course_id, record)
        if not svg:
            continue
        out_path = os.path.join(OUT_DIR, f"{course_id}.svg")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(svg)
        rendered_ids.append(course_id)
        time.sleep(0.7)
    # Also pick up any SVG files already in OUT_DIR (e.g. from a previous
    # run when Overpass rate-limited some courses) so the page's
    # "course has an SVG" check stays in sync with what's on disk.
    on_disk = sorted(
        os.path.splitext(f)[0]
        for f in os.listdir(OUT_DIR)
        if f.endswith(".svg")
    )
    ids_path = "lib/data/hole-svgs.ts"
    with open(ids_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/render_hole_svgs.py.\n")
        f.write("// Course ids that have a rendered single-hole illustration\n")
        f.write("// at public/holes/<id>.svg. Hard mode in /holes only picks\n")
        f.write("// from this set so the illustration is always available.\n\n")
        f.write("export const HOLE_SVG_IDS: ReadonlySet<string> = new Set([\n")
        for cid in on_disk:
            f.write(f'  "{cid}",\n')
        f.write("]);\n")
    print(f"Wrote {len(rendered_ids)}/{len(targets)} SVGs to {OUT_DIR}/")
    print(f"Wrote {len(on_disk)} ids to {ids_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
