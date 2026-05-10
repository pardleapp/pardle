"""
Per-course "hard mode" coordinates derived from OpenStreetMap's
golf=green features.

For each course in lib/data/courses.ts we query Overpass for greens
inside the course area. We then prefer:
  1. The course's iconic hole if a green with that ref tag exists.
  2. Any other ref-tagged green within 200-900m of the centroid
     (real numbered holes — sized to skip practice areas / mis-tags).
  3. Any unrefed green in the same distance band — a real-looking
     putting surface even if OSM didn't number it.

Greens further than 1km from the centroid are treated as mis-tags
(neighbouring property, satellite practice complex, etc.) and skipped.

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

MIN_DISTANCE_M = 200
MAX_DISTANCE_M = 900


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def fetch_greens(course_name: str) -> list[dict]:
    """Return a list of {lat, lng, ref} dicts for golf=green features
    inside the named course area."""
    query = f"""[out:json][timeout:30];
area["name"~"{course_name}"];
way(area)["golf"="green"];
out center tags;"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        OVERPASS, data=data, headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            result = json.load(r)
    except Exception as exc:
        print(f"  overpass error: {exc}", file=sys.stderr)
        return []

    out: list[dict] = []
    for el in result.get("elements", []):
        c = el.get("center") or {}
        if "lat" not in c or "lon" not in c:
            continue
        ref_str = ((el.get("tags") or {}).get("ref") or "").strip()
        ref_int: int | None = None
        if ref_str:
            try:
                ref_int = int(ref_str)
            except ValueError:
                pass
        out.append({"lat": c["lat"], "lng": c["lon"], "ref": ref_int})
    return out


def pick_green(
    greens: list[dict], centroid_lat: float, centroid_lng: float, iconic_hole: int
) -> dict | None:
    """Return the chosen green dict or None if nothing reasonable found."""
    # Annotate each green with its distance from centroid.
    for g in greens:
        g["distance_m"] = haversine_m(centroid_lat, centroid_lng, g["lat"], g["lng"])

    in_band = [
        g
        for g in greens
        if MIN_DISTANCE_M <= g["distance_m"] <= MAX_DISTANCE_M
    ]

    # 1. Iconic hole exact match if its green is in the sensible distance band.
    iconic_match = next(
        (g for g in in_band if g["ref"] == iconic_hole), None
    )
    if iconic_match:
        iconic_match["picked_via"] = "iconic_ref"
        return iconic_match

    # 2. Any other ref-tagged hole in the band.
    refed = [g for g in in_band if g["ref"] is not None]
    if refed:
        # Stable choice: smallest ref number (so the same course always shows
        # the same hole, not a different one between scrapes).
        chosen = min(refed, key=lambda g: g["ref"])
        chosen["picked_via"] = f"ref_{chosen['ref']}"
        return chosen

    # 3. Any unrefed green in the band — closest to centroid for stability.
    if in_band:
        chosen = min(in_band, key=lambda g: g["distance_m"])
        chosen["picked_via"] = "unrefed"
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
    coords: dict[str, dict] = {}
    misses: list[str] = []

    for i, c in enumerate(courses):
        name = c["name"]
        print(f"[{i + 1:>3}/{len(courses)}] {name}")
        greens = fetch_greens(name)
        if not greens:
            misses.append(f"{name} (no greens in OSM)")
            time.sleep(0.6)
            continue
        chosen = pick_green(greens, c["lat"], c["lng"], c["iconicHole"])
        if not chosen:
            misses.append(f"{name} (no greens within {MIN_DISTANCE_M}-{MAX_DISTANCE_M}m of centroid)")
            time.sleep(0.6)
            continue
        coords[c["id"]] = {
            "lat": round(chosen["lat"], 5),
            "lng": round(chosen["lng"], 5),
            "zoom": 18,
            "holeShown": chosen["ref"] if chosen["ref"] is not None else None,
        }
        print(
            f"  ok via {chosen['picked_via']}: hole {chosen['ref']} at "
            f"{chosen['lat']:.5f}, {chosen['lng']:.5f} ({chosen['distance_m']:.0f}m from centroid)"
        )
        time.sleep(0.6)

    print(f"\nGot coords for {len(coords)}/{len(courses)} courses")
    if misses:
        print(f"\nMisses ({len(misses)}):")
        for m in misses:
            print(f"  - {m}")

    out_path = "lib/data/hole-coords.ts"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/scrape_hole_coords.py.\n")
        f.write("// For each course, the lat/lng of an actual hole green from OSM,\n")
        f.write("// preferring the course's iconic hole if OSM has it tagged with a\n")
        f.write("// ref number, otherwise any other numbered hole in the 200-900m\n")
        f.write("// band from the course centroid.\n\n")
        f.write("export interface HoleCoords {\n")
        f.write("  lat: number;\n")
        f.write("  lng: number;\n")
        f.write("  zoom: number;\n")
        f.write("  /** OSM-tagged hole number actually shown, when known. */\n")
        f.write("  holeShown: number | null;\n")
        f.write("}\n\n")
        f.write("export const HOLE_COORDS: Record<string, HoleCoords> = ")
        f.write(json.dumps(coords, indent=2, ensure_ascii=False))
        f.write(";\n")

    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
