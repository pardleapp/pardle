"""
Render a clean single-hole illustration per course as an SVG, drawn
from OpenStreetMap golf=* polygons.

Each SVG is framed *on the hole itself* — bounding box = the hole-line
tee->green polyline plus a small breathing pad. The result reads like
a yardage-book card: the hole fills the frame, no neighbouring fairways
sneak in.

For every course in lib/data/hole-coords.ts that has a polyline we:
  1. Decode the polyline (tee -> green path).
  2. Compute its bounding box in metres relative to the green.
  3. Pad the bbox by PAD_M for breathing room.
  4. Query OSM for golf=* + natural=water polygons within enough
     radius to cover the bbox (cached to disk so re-renders don't
     re-hit Overpass).
  5. Project features into bbox-relative SVG coords with the long
     edge fixed at LONG_EDGE_PX; the short edge tracks the bbox
     aspect ratio so portrait holes render portrait.
  6. Draw a soft fairway "corridor" stroke along the hole-line under
     the OSM polygons so the hole shape reads clearly even when OSM
     fairway data is patchy, and the hole-line itself in gold on top.

The Holes page (`app/holes/page.tsx`) renders these as the Hard mode
image, sized with `object-fit: contain` in a 3:2 frame.
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
CACHE_DIR = "data/osm-features"

# SVG sizing: the longer of (width, height) is fixed at this many pixels.
# The shorter dimension is scaled to match the hole's actual aspect ratio,
# so a tall par-5 portrait hole stays portrait and a short par-3 fits a
# squarer box. The page CSS uses object-fit: contain to slot any aspect
# into the 3:2 frame.
LONG_EDGE_PX = 800

# Breathing room around the hole bbox, in metres. ~45m on each side gives
# the impression of context (treelines, surrounding rough) without dragging
# in neighbouring fairways.
PAD_M = 45

# If the hole is genuinely short and thin (e.g. a 160m par-3), we still want
# a reasonable canvas. Floor the bbox at MIN_EXTENT_M in each dimension.
MIN_EXTENT_M = 200

# OSM fetch radius. We query around the hole midpoint, with the radius set
# from the bbox diagonal so we always cover the visible frame. Floored so
# we don't undershoot tiny holes.
MIN_QUERY_RADIUS_M = 220

# Visual style — yardage-book palette
COLORS = {
    "bg": "#143018",
    "rough": "#2b5a2a",
    "fairway_corridor": "#4e8b39",  # under-glow stroke along the hole-line
    "fairway": "#5a9540",
    "green": "#2f7825",
    "tee": "#4f8a3e",
    "bunker": "#e7d6a3",
    "water": "#2e5577",
    "tree": "#0f2810",
    "hole_line": "#ffd64a",
}

# Render order: lowest to highest in z (later = drawn on top of earlier).
# fairway_corridor sits under everything course-side so OSM fairway shapes,
# bunkers and greens still overlay it; trees and rough are below it because
# they're scenery.
LAYER_ORDER = [
    "tree",
    "rough",
    "fairway_corridor",
    "fairway",
    "water",
    "bunker",
    "tee",
    "green",
]


def fetch_features(lat: float, lng: float, radius_m: float) -> dict:
    """Raw OSM features within radius_m of (lat, lng)."""
    query = f"""[out:json][timeout:30];
(
  way(around:{radius_m},{lat},{lng})["golf"];
  way(around:{radius_m},{lat},{lng})["natural"="water"];
  way(around:{radius_m},{lat},{lng})["natural"="wood"];
);
out geom tags;"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        OVERPASS, data=data, headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def cached_fetch(
    course_id: str, lat: float, lng: float, radius_m: float
) -> dict:
    """Fetch + cache. Re-renders don't re-query Overpass (which rate-limits)."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{course_id}.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    print(f"  fetching features (radius {radius_m:.0f}m)...", flush=True)
    data = fetch_features(lat, lng, radius_m)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    time.sleep(0.7)
    return data


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


def classify(tags: dict) -> str | None:
    """OSM tags -> render layer keyword. Order matters here too — greens
    should be classified as 'green' even if they also have a generic golf
    tag, and water_hazard should win over fairway."""
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
    return None


def decode_polyline(s: str) -> list[tuple[float, float]]:
    """Google-encoded polyline -> (lat, lng) tuples."""
    coords: list[tuple[float, float]] = []
    i = 0
    lat = 0
    lng = 0
    while i < len(s):
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


def svg_path_from_points(points: list[tuple[float, float]]) -> str:
    if not points:
        return ""
    parts = [f"M{points[0][0]:.1f},{points[0][1]:.1f}"]
    for x, y in points[1:]:
        parts.append(f"L{x:.1f},{y:.1f}")
    parts.append("Z")
    return " ".join(parts)


def render_course(course_id: str, hole_record: dict) -> str | None:
    if not hole_record.get("path"):
        return None
    line_latlngs = decode_polyline(hole_record["path"])
    if len(line_latlngs) < 2:
        return None

    # Project the hole-line into metres using the green as origin.
    green_lat, green_lng = line_latlngs[-1]
    line_m = project_to_meters(line_latlngs, green_lat, green_lng)

    # Hole bbox in metres.
    xs = [p[0] for p in line_m]
    ys = [p[1] for p in line_m]
    min_x, max_x = min(xs) - PAD_M, max(xs) + PAD_M
    min_y, max_y = min(ys) - PAD_M, max(ys) + PAD_M

    # Floor each dimension so short par-3s still get a reasonable frame.
    if max_x - min_x < MIN_EXTENT_M:
        mid = (max_x + min_x) / 2
        min_x = mid - MIN_EXTENT_M / 2
        max_x = mid + MIN_EXTENT_M / 2
    if max_y - min_y < MIN_EXTENT_M:
        mid = (max_y + min_y) / 2
        min_y = mid - MIN_EXTENT_M / 2
        max_y = mid + MIN_EXTENT_M / 2

    bbox_w_m = max_x - min_x
    bbox_h_m = max_y - min_y

    # SVG dimensions: long edge fixed, short edge tracks aspect.
    if bbox_h_m >= bbox_w_m:
        height_px = LONG_EDGE_PX
        width_px = int(round(LONG_EDGE_PX * bbox_w_m / bbox_h_m))
    else:
        width_px = LONG_EDGE_PX
        height_px = int(round(LONG_EDGE_PX * bbox_h_m / bbox_w_m))
    scale_px_per_m = LONG_EDGE_PX / max(bbox_w_m, bbox_h_m)

    # Fetch features. Query is centred on the hole midpoint with radius
    # set to cover the bbox plus a small margin.
    hole_lats = [p[0] for p in line_latlngs]
    hole_lngs = [p[1] for p in line_latlngs]
    mid_lat = (min(hole_lats) + max(hole_lats)) / 2
    mid_lng = (min(hole_lngs) + max(hole_lngs)) / 2
    bbox_diag_m = math.hypot(bbox_w_m, bbox_h_m)
    query_radius_m = max(MIN_QUERY_RADIUS_M, bbox_diag_m / 2 + 40)
    try:
        features = cached_fetch(course_id, mid_lat, mid_lng, query_radius_m)
    except Exception as exc:
        print(f"  fetch error: {exc}", file=sys.stderr)
        return None

    def to_svg(x_m: float, y_m: float) -> tuple[float, float]:
        sx = (x_m - min_x) * scale_px_per_m
        sy = height_px - (y_m - min_y) * scale_px_per_m
        return sx, sy

    # Classify and project OSM features.
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
        meters = project_to_meters(latlngs, green_lat, green_lng)
        # Drop polygons whose entire bbox is well outside the visible frame.
        # 30m grace so a polygon clipping the edge still draws naturally.
        xs_p = [x for x, _ in meters]
        ys_p = [y for _, y in meters]
        if max(xs_p) < min_x - 30 or min(xs_p) > max_x + 30:
            continue
        if max(ys_p) < min_y - 30 or min(ys_p) > max_y + 30:
            continue
        svg_pts = [to_svg(x, y) for x, y in meters]
        by_layer[layer].append(svg_pts)

    # Build SVG
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {width_px} {height_px}" '
        f'preserveAspectRatio="xMidYMid meet">',
        f'<rect width="100%" height="100%" fill="{COLORS["bg"]}"/>',
    ]

    # Pre-build the hole-line path string — used both for the underglow
    # corridor and the gold hole-line on top.
    line_svg_pts = [to_svg(x, y) for x, y in line_m]
    d_line_parts = [f"M{line_svg_pts[0][0]:.1f},{line_svg_pts[0][1]:.1f}"]
    for sx, sy in line_svg_pts[1:]:
        d_line_parts.append(f"L{sx:.1f},{sy:.1f}")
    d_line = " ".join(d_line_parts)

    # Fairway corridor: thick rounded stroke along the hole-line, sitting
    # under everything course-side. 35m wide ~= a generous fairway corridor.
    # This way the hole reads as a single coherent shape even when OSM
    # tagging is patchy or fairway polygons are missing.
    corridor_px = 35 * scale_px_per_m

    # Render layers in z-order. fairway_corridor is rendered specially as a
    # stroked polyline rather than a list of polygons.
    for layer in LAYER_ORDER:
        if layer == "fairway_corridor":
            parts.append(
                f'<path d="{d_line}" fill="none" '
                f'stroke="{COLORS["fairway_corridor"]}" '
                f'stroke-width="{corridor_px:.1f}" '
                f'stroke-linecap="round" stroke-linejoin="round" '
                f'opacity="0.85"/>'
            )
            continue
        if not by_layer[layer]:
            continue
        fill = COLORS[layer]
        for poly in by_layer[layer]:
            d = svg_path_from_points(poly)
            if d:
                parts.append(f'<path d="{d}" fill="{fill}" stroke="none"/>')

    # Hole-line on top, in gold.
    hole_line_px = max(3.5, 4 * scale_px_per_m / 6)
    parts.append(
        f'<path d="{d_line}" fill="none" stroke="{COLORS["hole_line"]}" '
        f'stroke-width="{hole_line_px:.1f}" stroke-linecap="round" '
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
    targets = {k: v for k, v in coords.items() if v.get("path")}
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
