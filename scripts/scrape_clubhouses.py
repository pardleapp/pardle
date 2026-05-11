"""
Per-course clubhouse footprint, derived from OpenStreetMap's
building=clubhouse / amenity=clubhouse / "named clubhouse" buildings
near each course centroid.

For every course in lib/data/courses.ts we:
  1. Query OSM Overpass for buildings within ~250m of the centroid.
  2. Score each candidate building and pick the most-likely clubhouse:
       building=clubhouse                    -> +1000
       amenity=clubhouse                     -> +800
       name contains "clubhouse"/"club house"-> +500
       name matches a course-name token      -> +200
       size in m^2                           -> +(area / 10)
       distance to course centroid (m)       -> -distance
       (caps so a giant maintenance shed
        doesn't beat a small named clubhouse)
  3. Save the chosen building polygon (lat/lng tuples) to
     lib/data/clubhouses.ts keyed by course id.

The Clubs page reads this data, renders each building as a clean
silhouette SVG, and runs a Wordle-style puzzle to guess the course.
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

# Search radius around the course centroid. 250m comfortably covers any
# clubhouse on the property; bigger than that and we start to pick up
# halfway houses or maintenance buildings on adjoining land.
SEARCH_RADIUS_M = 250

# Caps so the "size" component can't drown out the "name/tag" component.
MAX_AREA_BONUS = 200
MAX_DISTANCE_PENALTY = 250


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def polygon_area_m2(geometry: list[tuple[float, float]]) -> float:
    """Shoelace area for a (lat, lng) polygon, in square metres.
    Uses an equirectangular projection at the polygon centroid which is
    fine for building-sized shapes (sub-100m error is well under our
    scoring precision)."""
    if len(geometry) < 3:
        return 0.0
    cy = sum(p[0] for p in geometry) / len(geometry)
    cos_lat = math.cos(math.radians(cy))
    xs = [(p[1]) * 111000.0 * cos_lat for p in geometry]
    ys = [(p[0]) * 111000.0 for p in geometry]
    n = len(geometry)
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(s) / 2.0


def polygon_centroid(
    geometry: list[tuple[float, float]],
) -> tuple[float, float]:
    """Arithmetic mean of polygon vertices — good enough for "is this
    building near the course centroid?" scoring."""
    lats = [p[0] for p in geometry]
    lngs = [p[1] for p in geometry]
    return (sum(lats) / len(lats), sum(lngs) / len(lngs))


def fetch_buildings(lat: float, lng: float) -> list[dict]:
    """Return raw OSM building ways within SEARCH_RADIUS_M of (lat, lng)."""
    query = f"""[out:json][timeout:30];
(
  way(around:{SEARCH_RADIUS_M},{lat},{lng})["building"];
  way(around:{SEARCH_RADIUS_M},{lat},{lng})["amenity"="clubhouse"];
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
        return []
    return result.get("elements", [])


def course_name_tokens(name: str) -> set[str]:
    """Tokens from the course name that we'd hope to see on a clubhouse.
    Drops generic words like 'Golf', 'Club', 'Country', 'Course'."""
    stop = {
        "golf",
        "club",
        "country",
        "course",
        "the",
        "links",
        "national",
        "international",
        "resort",
        "of",
        "and",
        "&",
    }
    tokens = re.findall(r"[a-zA-Z]+", name.lower())
    return {t for t in tokens if t not in stop and len(t) >= 3}


def score_candidate(
    el: dict,
    course_lat: float,
    course_lng: float,
    course_tokens: set[str],
) -> tuple[float, str]:
    """Score a candidate OSM way. Returns (score, picked_via_label)."""
    tags = el.get("tags") or {}
    name = (tags.get("name") or "").lower()
    geom = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
    if len(geom) < 3:
        return -1e9, "no_geom"

    score = 0.0
    reasons: list[str] = []

    if tags.get("building") == "clubhouse":
        score += 1000
        reasons.append("building=clubhouse")
    if tags.get("amenity") == "clubhouse":
        score += 800
        reasons.append("amenity=clubhouse")
    if "clubhouse" in name or "club house" in name:
        score += 500
        reasons.append("name~clubhouse")
    if name:
        toks = set(re.findall(r"[a-zA-Z]+", name))
        if course_tokens & toks:
            score += 200
            reasons.append("name~course")

    area = polygon_area_m2(geom)
    # Tiny buildings (<60m^2) are probably sheds. Massive (>1500m^2) are
    # often hotels/maintenance complexes. Bell curve via clamping.
    if area < 60:
        score -= 200
        reasons.append("too_small")
    elif area > 1500:
        score -= 100
        reasons.append("very_big")
    score += min(MAX_AREA_BONUS, area / 10)

    cx, cy = polygon_centroid(geom)
    dist = haversine_m(course_lat, course_lng, cx, cy)
    score -= min(MAX_DISTANCE_PENALTY, dist)
    reasons.append(f"d={dist:.0f}m,a={area:.0f}m²")

    return score, ",".join(reasons[:3])


def pick_clubhouse(
    course: dict, elements: list[dict]
) -> dict | None:
    """Pick the best clubhouse candidate (or None if nothing looks like one)."""
    if not elements:
        return None
    course_tokens = course_name_tokens(course["name"])
    course_lat, course_lng = course["lat"], course["lng"]

    best = None
    best_score = -1e9
    best_reason = ""
    for el in elements:
        if not el.get("geometry"):
            continue
        score, reason = score_candidate(el, course_lat, course_lng, course_tokens)
        if score > best_score:
            best_score = score
            best = el
            best_reason = reason

    # Reject if even the best candidate looks unconvincing. With no
    # building=clubhouse tag and no clubhouse-named name and a small
    # distant building, the score lands well below 0 → not worth showing.
    if best is None or best_score < -150:
        return None
    geom = [(p["lat"], p["lon"]) for p in best.get("geometry", [])]
    return {
        "polygon": geom,
        "score": best_score,
        "picked_via": best_reason,
        "tags": best.get("tags") or {},
    }


def load_courses() -> list[dict]:
    with open("lib/data/courses.ts", "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(
        r"export const COURSES: Course\[\] = (\[.*?\]);", text, re.DOTALL
    )
    if not m:
        raise RuntimeError("courses.ts not in expected format")
    return json.loads(m.group(1))


def main() -> int:
    courses = load_courses()
    print(f"Scraping clubhouse footprints for {len(courses)} courses...")
    records: dict[str, dict] = {}
    misses: list[str] = []
    for i, c in enumerate(courses):
        print(f"[{i+1:>3}/{len(courses)}] {c['name']}")
        elements = fetch_buildings(c["lat"], c["lng"])
        if not elements:
            misses.append(f"{c['name']} (no buildings within {SEARCH_RADIUS_M}m)")
            time.sleep(0.5)
            continue
        chosen = pick_clubhouse(c, elements)
        if not chosen:
            misses.append(f"{c['name']} (no candidate scored high enough)")
            time.sleep(0.5)
            continue
        polygon = [
            [round(lat, 6), round(lng, 6)] for lat, lng in chosen["polygon"]
        ]
        records[c["id"]] = {
            "polygon": polygon,
            "pickedVia": chosen["picked_via"],
        }
        print(f"  ok ({chosen['picked_via']})")
        time.sleep(0.5)

    print(f"\nGot {len(records)}/{len(courses)} clubhouse footprints")
    if misses:
        print(f"\nMisses ({len(misses)}):")
        for m in misses:
            print(f"  - {m}")

    out_path = "lib/data/clubhouses.ts"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/scrape_clubhouses.py.\n")
        f.write("// Per-course clubhouse building footprint from OSM:\n")
        f.write("//   polygon   — [lat, lng] vertices, closed implicitly\n")
        f.write("//   pickedVia — debug string showing why this building won\n\n")
        f.write("export interface Clubhouse {\n")
        f.write("  polygon: Array<[number, number]>;\n")
        f.write("  pickedVia: string;\n")
        f.write("}\n\n")
        f.write("export const CLUBHOUSES: Record<string, Clubhouse> = ")
        f.write(json.dumps(records, indent=2, ensure_ascii=False))
        f.write(";\n")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
