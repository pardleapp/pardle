"""
Per-course "hard mode" data derived from OpenStreetMap's golf=hole
features (which trace each hole as a line from tee through fairway
to green).

For each course we:
  1. Query OSM Overpass for golf=hole + golf=green features inside
     the named course area.
  2. Pick the course's iconic hole if OSM has a ref-tagged hole or
     green that matches, else any sensible numbered hole, else any
     unrefed green.
  3. If we picked a `golf=hole` line, encode its full geometry as a
     Google polyline so Mapbox can overlay it on the satellite.
  4. Compute a bbox around the geometry so the satellite zooms to fit.

Output: lib/data/hole-coords.ts — keyed by course id.
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "PardleScraper/0.1 (https://pardle.app)"

MIN_DISTANCE_M = 150
MAX_DISTANCE_M = 1000


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _encode_signed(value: int) -> str:
    """Google polyline algorithm for a single signed integer."""
    shifted = (value << 1) & 0xFFFFFFFF
    if value < 0:
        shifted = ~shifted & 0xFFFFFFFF
    chunks: list[str] = []
    while shifted >= 0x20:
        chunks.append(chr((0x20 | (shifted & 0x1F)) + 63))
        shifted >>= 5
    chunks.append(chr(shifted + 63))
    return "".join(chunks)


def encode_polyline(points: list[tuple[float, float]]) -> str:
    """Google polyline encoding for a sequence of (lat, lng) tuples."""
    out: list[str] = []
    prev_lat = 0
    prev_lng = 0
    for lat, lng in points:
        lat_e5 = int(round(lat * 1e5))
        lng_e5 = int(round(lng * 1e5))
        out.append(_encode_signed(lat_e5 - prev_lat))
        out.append(_encode_signed(lng_e5 - prev_lng))
        prev_lat = lat_e5
        prev_lng = lng_e5
    return "".join(out)


def fetch_features(course_name: str) -> tuple[list[dict], list[dict]]:
    """Return (holes, greens) for the named course.
    holes: list of {ref, geometry: [(lat,lng), ...]} dicts
    greens: list of {ref, lat, lng} dicts
    """
    query = f"""[out:json][timeout:30];
area["name"~"{course_name}"];
(
  way(area)["golf"="hole"];
  way(area)["golf"="green"];
);
out geom tags;"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        OVERPASS, data=data, headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            result = json.load(r)
    except Exception as exc:
        print(f"  overpass error: {exc}", file=sys.stderr)
        return [], []

    holes: list[dict] = []
    greens: list[dict] = []
    for el in result.get("elements", []):
        tags = el.get("tags") or {}
        kind = tags.get("golf")
        ref_str = (tags.get("ref") or "").strip()
        ref: int | None = None
        if ref_str:
            try:
                ref = int(ref_str)
            except ValueError:
                pass
        if kind == "hole":
            geometry = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
            if not geometry:
                continue
            holes.append({"ref": ref, "geometry": geometry, "tags": tags})
        elif kind == "green":
            c = el.get("center") or {}
            if "lat" not in c or "lon" not in c:
                continue
            greens.append({"ref": ref, "lat": c["lat"], "lng": c["lon"]})
    return holes, greens


def hole_centroid(geometry: list[tuple[float, float]]) -> tuple[float, float]:
    lats = [p[0] for p in geometry]
    lngs = [p[1] for p in geometry]
    return (sum(lats) / len(lats), sum(lngs) / len(lngs))


def hole_bbox(geometry: list[tuple[float, float]], pad_factor: float = 0.18) -> list[float]:
    """Return [minLng, minLat, maxLng, maxLat] padded outward by pad_factor of each span."""
    lats = [p[0] for p in geometry]
    lngs = [p[1] for p in geometry]
    minLat, maxLat = min(lats), max(lats)
    minLng, maxLng = min(lngs), max(lngs)
    lat_pad = max((maxLat - minLat) * pad_factor, 0.0003)
    lng_pad = max((maxLng - minLng) * pad_factor, 0.0003)
    return [
        round(minLng - lng_pad, 6),
        round(minLat - lat_pad, 6),
        round(maxLng + lng_pad, 6),
        round(maxLat + lat_pad, 6),
    ]


def pick_hole_or_green(
    course: dict,
    holes: list[dict],
    greens: list[dict],
) -> dict | None:
    """Return a chosen feature with keys: kind, ref, geometry, lat, lng, distance_m."""
    cx, cy = course["lat"], course["lng"]
    iconic = course["iconicHole"]

    # Compute centroid + distance for each candidate.
    hole_candidates: list[dict] = []
    for h in holes:
        clat, clng = hole_centroid(h["geometry"])
        d = haversine_m(cx, cy, clat, clng)
        if d > MAX_DISTANCE_M:
            continue
        hole_candidates.append({
            "kind": "hole",
            "ref": h["ref"],
            "geometry": h["geometry"],
            "lat": clat,
            "lng": clng,
            "distance_m": d,
        })

    green_candidates: list[dict] = []
    for g in greens:
        d = haversine_m(cx, cy, g["lat"], g["lng"])
        if not (MIN_DISTANCE_M <= d <= MAX_DISTANCE_M):
            continue
        green_candidates.append({
            "kind": "green",
            "ref": g["ref"],
            "geometry": None,
            "lat": g["lat"],
            "lng": g["lng"],
            "distance_m": d,
        })

    # 1. Iconic hole with line geometry — best outcome (outline visible)
    iconic_hole = next((c for c in hole_candidates if c["ref"] == iconic), None)
    if iconic_hole:
        iconic_hole["picked_via"] = "iconic_hole_line"
        return iconic_hole

    # 2. Any numbered hole line
    refed_holes = [c for c in hole_candidates if c["ref"] is not None]
    if refed_holes:
        chosen = min(refed_holes, key=lambda c: c["ref"])
        chosen["picked_via"] = f"hole_line_ref_{chosen['ref']}"
        return chosen

    # 3. Iconic green (lat/lng only, no line)
    iconic_green = next((c for c in green_candidates if c["ref"] == iconic), None)
    if iconic_green:
        iconic_green["picked_via"] = "iconic_green_point"
        return iconic_green

    # 4. Any numbered green
    refed_greens = [c for c in green_candidates if c["ref"] is not None]
    if refed_greens:
        chosen = min(refed_greens, key=lambda c: c["ref"])
        chosen["picked_via"] = f"green_point_ref_{chosen['ref']}"
        return chosen

    # 5. Closest unrefed green
    if green_candidates:
        chosen = min(green_candidates, key=lambda c: c["distance_m"])
        chosen["picked_via"] = "green_point_unrefed"
        return chosen

    return None


def load_courses() -> list[dict]:
    with open("lib/data/courses.ts", "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"export const COURSES: Course\[\] = (\[.*?\]);", text, re.DOTALL)
    if not m:
        raise RuntimeError("courses.ts not in expected format")
    return json.loads(m.group(1))


def main() -> int:
    courses = load_courses()
    print(f"Querying OSM for {len(courses)} courses...")
    out_records: dict[str, dict] = {}
    misses: list[str] = []

    for i, c in enumerate(courses):
        name = c["name"]
        print(f"[{i + 1:>3}/{len(courses)}] {name}")
        holes, greens = fetch_features(name)
        if not holes and not greens:
            misses.append(f"{name} (no OSM features)")
            time.sleep(0.6)
            continue
        chosen = pick_hole_or_green(c, holes, greens)
        if not chosen:
            misses.append(f"{name} (no in-band features found)")
            time.sleep(0.6)
            continue

        record: dict = {
            "lat": round(chosen["lat"], 5),
            "lng": round(chosen["lng"], 5),
            "zoom": 18,
            "holeShown": chosen["ref"] if chosen["ref"] is not None else None,
        }
        if chosen["geometry"]:
            record["bbox"] = hole_bbox(chosen["geometry"])
            record["path"] = encode_polyline(chosen["geometry"])

        out_records[c["id"]] = record
        gtag = "line" if chosen["geometry"] else "point"
        print(
            f"  ok via {chosen['picked_via']} ({gtag}): ref={chosen['ref']} "
            f"({chosen['distance_m']:.0f}m from centroid)"
        )
        time.sleep(0.6)

    print(f"\nGot data for {len(out_records)}/{len(courses)} courses")
    with_line = sum(1 for r in out_records.values() if r.get("path"))
    print(f"  ...of which {with_line} have a hole-line geometry to overlay")
    if misses:
        print(f"\nMisses ({len(misses)}):")
        for m in misses:
            print(f"  - {m}")

    out_path = "lib/data/hole-coords.ts"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/scrape_hole_coords.py.\n")
        f.write("// Per-course data for Hard mode in Holes:\n")
        f.write("//   lat/lng  — centroid for the fallback (no bbox) case\n")
        f.write("//   zoom     — fallback zoom level\n")
        f.write("//   bbox     — when present, Mapbox auto-fits the image to this rectangle\n")
        f.write("//   path     — polyline-encoded geometry tracing the hole tee->green,\n")
        f.write("//              overlaid in yellow on top of the satellite\n")
        f.write("//   holeShown — OSM-tagged hole number actually shown, when known\n\n")
        f.write("export interface HoleCoords {\n")
        f.write("  lat: number;\n")
        f.write("  lng: number;\n")
        f.write("  zoom: number;\n")
        f.write("  bbox?: [number, number, number, number];\n")
        f.write("  path?: string;\n")
        f.write("  holeShown: number | null;\n")
        f.write("}\n\n")
        f.write("export const HOLE_COORDS: Record<string, HoleCoords> = ")
        f.write(json.dumps(out_records, indent=2, ensure_ascii=False))
        f.write(";\n")

    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
