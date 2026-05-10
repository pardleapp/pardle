"""
Scrape golf course data (coordinates + infobox metadata) from Wikipedia and
emit a TypeScript file suitable for use as the live Pardle: Holes course
database.

Run from repo root:
    python scripts/scrape_courses.py

Output: lib/data/courses.ts
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from typing import Optional

# ---------------------------------------------------------------------------
# (Wikipedia page title, course type, tier). Tier guides daily difficulty:
#   S = household-name course (Mondays)
#   A = major-championship venue or iconic resort (Tue–Wed)
#   B = well-known tour course (Thu–Fri)
#   C = lesser-known but recognisable (Sat–Sun)
# ---------------------------------------------------------------------------
COURSES: list[tuple[str, str, str]] = [
    # ===== S — household names =====
    ("Augusta National Golf Club", "Parkland", "S"),
    ("Old Course at St Andrews", "Links", "S"),
    ("Pebble Beach Golf Links", "Links", "S"),
    ("TPC Sawgrass", "Stadium", "S"),
    ("Pinehurst Resort", "Sandbelt", "S"),
    ("Bethpage State Park", "Parkland", "S"),

    # ===== A — major venues + iconic resorts =====
    ("Royal Troon Golf Club", "Links", "A"),
    ("Carnoustie Golf Links", "Links", "A"),
    ("Muirfield", "Links", "A"),
    ("Royal Birkdale Golf Club", "Links", "A"),
    ("Whistling Straits", "Links", "A"),
    ("Cypress Point Club", "Links", "A"),
    ("Royal County Down Golf Club", "Links", "A"),
    ("Royal Portrush Golf Club", "Links", "A"),
    ("Oakmont Country Club", "Parkland", "A"),
    ("Royal St George's Golf Club", "Links", "A"),
    ("Royal Lytham & St Annes Golf Club", "Links", "A"),
    ("Trump Turnberry", "Links", "A"),
    ("Shinnecock Hills Golf Club", "Links", "A"),
    ("Winged Foot Golf Club", "Parkland", "A"),
    ("The Olympic Club", "Parkland", "A"),
    ("Riviera Country Club", "Parkland", "A"),
    ("Torrey Pines Golf Course", "Parkland", "A"),
    ("Hazeltine National Golf Club", "Parkland", "A"),
    ("Medinah Country Club", "Parkland", "A"),
    ("Valhalla Golf Club", "Parkland", "A"),
    ("East Lake Golf Club", "Parkland", "A"),
    ("Merion Golf Club", "Parkland", "A"),
    ("Baltusrol Golf Club", "Parkland", "A"),
    ("The Country Club", "Parkland", "A"),
    ("Southern Hills Country Club", "Parkland", "A"),
    ("Royal Liverpool Golf Club", "Links", "A"),
    ("Royal Aberdeen Golf Club", "Links", "A"),
    ("Lahinch Golf Club", "Links", "A"),
    ("Portmarnock Golf Club", "Links", "A"),
    ("Royal Dornoch Golf Club", "Links", "A"),
    ("Wentworth Club", "Parkland", "A"),
    ("Sunningdale Golf Club", "Parkland", "A"),
    ("Valderrama Golf Club", "Parkland", "A"),
    ("Royal Melbourne Golf Club", "Sandbelt", "A"),
    ("Kingston Heath Golf Club", "Sandbelt", "A"),
    ("Le Golf National", "Parkland", "A"),

    # ===== B — well-known tour courses / strong resorts =====
    ("Quail Hollow Club", "Parkland", "B"),
    ("Bay Hill Club and Lodge", "Parkland", "B"),
    ("Atlanta Athletic Club", "Parkland", "B"),
    ("Olympia Fields Country Club", "Parkland", "B"),
    ("Inverness Club", "Parkland", "B"),
    ("Erin Hills", "Links", "B"),
    ("Chambers Bay", "Links", "B"),
    ("Crooked Stick Golf Club", "Parkland", "B"),
    ("Trump National Doral Miami", "Stadium", "B"),
    ("PGA West", "Stadium", "B"),
    ("Spyglass Hill Golf Course", "Links", "B"),
    ("Pasatiempo Golf Club", "Parkland", "B"),
    ("Pacific Dunes", "Links", "B"),
    ("Bandon Dunes Golf Resort", "Links", "B"),
    ("Sand Hills Golf Club", "Links", "B"),
    ("Kiawah Island Golf Resort", "Links", "B"),
    ("Streamsong Resort", "Sandbelt", "B"),
    ("Cabot Links", "Links", "B"),
    ("National Golf Links of America", "Links", "B"),
    ("North Berwick Golf Club", "Links", "B"),
    ("The European Club", "Links", "B"),
    ("Old Head Golf Links", "Links", "B"),
    ("Kingsbarns Golf Links", "Links", "B"),
    ("Castle Stuart Golf Links", "Links", "B"),
    ("Loch Lomond Golf Club", "Parkland", "B"),
    ("Gleneagles Hotel", "Parkland", "B"),
    ("The K Club", "Parkland", "B"),
    ("Marco Simone Golf and Country Club", "Parkland", "B"),
    ("Cape Kidnappers", "Links", "B"),
    ("Tara Iti Golf Club", "Links", "B"),
    ("Barnbougle Dunes", "Links", "B"),

    # ===== C — recognisable to fans, tougher for casuals =====
    ("Royal Cinque Ports Golf Club", "Links", "C"),
    ("Walton Heath Golf Club", "Heathland", "C"),
    ("The Berkshire Golf Club", "Heathland", "C"),
    ("Royal Ashdown Forest Golf Club", "Heathland", "C"),
    ("Sebonack Golf Club", "Links", "C"),
    ("Garden City Golf Club", "Parkland", "C"),
    ("Plainfield Country Club", "Parkland", "C"),
    ("Quaker Ridge Golf Club", "Parkland", "C"),
    ("Forest Highlands Golf Club", "Parkland", "C"),
    ("Crans-sur-Sierre Golf Club", "Parkland", "C"),
    ("Sotogrande", "Parkland", "C"),
    ("Mission Hills Golf Club", "Parkland", "C"),
    ("New South Wales Golf Club", "Sandbelt", "C"),
    ("The Australian Golf Club", "Sandbelt", "C"),
    ("Cabo del Sol Golf Club", "Resort", "C"),
    ("Diamante Cabo San Lucas", "Resort", "C"),
    ("Streamsong Black", "Sandbelt", "C"),
    ("Cabot Cliffs", "Links", "C"),
    ("Old Macdonald", "Links", "C"),
    ("Sheep Ranch", "Links", "C"),
    ("Bandon Trails", "Links", "C"),
    ("Royal Adelaide Golf Club", "Sandbelt", "C"),
    ("Yas Links", "Links", "C"),
    ("Mission Hills Haikou", "Resort", "C"),
    ("Whistling Pines Golf Club", "Parkland", "C"),
]

# Verified course metadata that the Wikipedia infobox parser doesn't reliably
# extract. Year founded, par, and iconic-hole values come from widely-published
# course records (PGA Tour course pages, Open/Masters historical records, etc.).
# Override wins over auto-extraction.
COURSE_OVERRIDES: dict[str, dict] = {
    "Augusta National Golf Club": {
        "yearFounded": 1933, "par": 72,
        "iconicHole": 12, "iconicHoleNote": "Golden Bell — heart of Amen Corner",
    },
    "Old Course at St Andrews": {
        "yearFounded": 1552, "par": 72,
        "iconicHole": 17, "iconicHoleNote": "Road Hole",
    },
    "Pebble Beach Golf Links": {
        "yearFounded": 1919, "par": 72,
        "iconicHole": 7, "iconicHoleNote": "106 yards over the Pacific",
    },
    "TPC Sawgrass": {
        "yearFounded": 1980, "par": 72,
        "iconicHole": 17, "iconicHoleNote": "Island Green",
    },
    "Pinehurst Resort": {
        "yearFounded": 1907, "par": 72, "iconicHole": 16,
    },
    "Bethpage State Park": {
        "yearFounded": 1936, "par": 71,
        "iconicHole": 5, "iconicHoleNote": "long par 4, the strongest test on the Black",
    },
    "Royal Troon Golf Club": {
        "yearFounded": 1878, "par": 71,
        "iconicHole": 8, "iconicHoleNote": "Postage Stamp",
    },
    "Carnoustie Golf Links": {
        "yearFounded": 1850, "par": 71,
        "iconicHole": 18, "iconicHoleNote": "Home Hole, with the Barry Burn",
    },
    "Muirfield": {
        "yearFounded": 1891, "par": 70, "iconicHole": 18,
    },
    "Royal Birkdale Golf Club": {
        "yearFounded": 1889, "par": 70, "iconicHole": 18,
    },
    "Whistling Straits": {
        "yearFounded": 1998, "par": 72,
        "iconicHole": 17, "iconicHoleNote": "Pinched Nerve",
    },
    "Cypress Point Club": {
        "yearFounded": 1928, "par": 72,
        "iconicHole": 16, "iconicHoleNote": "Par 3 over the Pacific",
    },
    "Royal County Down Golf Club": {
        "yearFounded": 1889, "par": 71, "iconicHole": 9,
    },
    "Royal Portrush Golf Club": {
        "yearFounded": 1888, "par": 72,
        "iconicHole": 16, "iconicHoleNote": "Calamity Corner",
    },
    "Oakmont Country Club": {
        "yearFounded": 1903, "par": 70, "iconicHole": 1,
    },
    "Royal St George's Golf Club": {
        "yearFounded": 1887, "par": 70, "iconicHole": 4,
    },
    "Royal Lytham & St Annes Golf Club": {
        "yearFounded": 1886, "par": 71, "iconicHole": 18,
    },
    "Trump Turnberry": {
        "yearFounded": 1906, "par": 71,
        "iconicHole": 9, "iconicHoleNote": "Bruce's Castle, with the lighthouse",
    },
    "Shinnecock Hills Golf Club": {
        "yearFounded": 1891, "par": 70, "iconicHole": 18,
    },
    "Winged Foot Golf Club": {
        "yearFounded": 1923, "par": 72, "iconicHole": 18,
    },
    "The Olympic Club": {
        "yearFounded": 1860, "par": 72, "iconicHole": 16,
    },
    "Riviera Country Club": {
        "yearFounded": 1926, "par": 71,
        "iconicHole": 10, "iconicHoleNote": "drivable par 4",
    },
    "Torrey Pines Golf Course": {
        "yearFounded": 1957, "par": 72, "iconicHole": 18,
    },
    "Hazeltine National Golf Club": {
        "yearFounded": 1962, "par": 72, "iconicHole": 16,
    },
    "Medinah Country Club": {
        "yearFounded": 1925, "par": 72, "iconicHole": 17,
    },
    "Valhalla Golf Club": {
        "yearFounded": 1986, "par": 72, "iconicHole": 18,
    },
    "East Lake Golf Club": {
        "yearFounded": 1904, "par": 70, "iconicHole": 18,
    },
    "Merion Golf Club": {
        "yearFounded": 1896, "par": 70,
        "iconicHole": 18, "iconicHoleNote": "Hogan's 1-iron",
    },
    "Baltusrol Golf Club": {
        "yearFounded": 1895, "par": 72, "iconicHole": 17,
    },
    "The Country Club": {
        "yearFounded": 1882, "par": 71, "iconicHole": 17,
    },
    "Southern Hills Country Club": {
        "yearFounded": 1936, "par": 70, "iconicHole": 18,
    },
    "Royal Liverpool Golf Club": {
        "yearFounded": 1869, "par": 72, "iconicHole": 18,
    },
    "Royal Aberdeen Golf Club": {
        "yearFounded": 1780, "par": 71, "iconicHole": 8,
    },
    "Lahinch Golf Club": {
        "yearFounded": 1892, "par": 72, "iconicHole": 5,
    },
    "Portmarnock Golf Club": {
        "yearFounded": 1894, "par": 72, "iconicHole": 15,
    },
    "Royal Dornoch Golf Club": {
        "yearFounded": 1877, "par": 70, "iconicHole": 14,
    },
    "Wentworth Club": {
        "yearFounded": 1922, "par": 72, "iconicHole": 18,
    },
    "Sunningdale Golf Club": {
        "yearFounded": 1900, "par": 70, "iconicHole": 18,
    },
    "Valderrama Golf Club": {
        "yearFounded": 1974, "par": 71, "iconicHole": 17,
    },
    "Royal Melbourne Golf Club": {
        "yearFounded": 1891, "par": 72, "iconicHole": 6,
    },
    "Kingston Heath Golf Club": {
        "yearFounded": 1909, "par": 72, "iconicHole": 15,
    },
    "Le Golf National": {
        "yearFounded": 1990, "par": 72, "iconicHole": 18,
    },
    "Quail Hollow Club": {
        "yearFounded": 1961, "par": 71,
        "iconicHole": 18, "iconicHoleNote": "Green Mile finish",
    },
    "Bay Hill Club and Lodge": {
        "yearFounded": 1961, "par": 72, "iconicHole": 18,
    },
    "Trump National Doral Miami": {
        "yearFounded": 1962, "par": 72,
        "iconicHole": 18, "iconicHoleNote": "Blue Monster",
    },
    "Erin Hills": {
        "yearFounded": 2006, "par": 72, "iconicHole": 18,
    },
    "Chambers Bay": {
        "yearFounded": 2007, "par": 72, "iconicHole": 16,
    },
    "Spyglass Hill Golf Course": {
        "yearFounded": 1966, "par": 72, "iconicHole": 1,
    },
    "Pacific Dunes": {
        "yearFounded": 2001, "par": 71, "iconicHole": 13,
    },
    "Bandon Dunes Golf Resort": {
        "yearFounded": 1999, "par": 72, "iconicHole": 16,
    },
    "Kiawah Island Golf Resort": {
        "yearFounded": 1991, "par": 72,
        "iconicHole": 17, "iconicHoleNote": "Ocean Course par 3",
    },
    "National Golf Links of America": {
        "yearFounded": 1909, "par": 73, "iconicHole": 17,
    },
    "Cape Kidnappers": {
        "yearFounded": 2004, "par": 71, "iconicHole": 15,
    },
    "Tara Iti Golf Club": {
        "yearFounded": 2015, "par": 71, "iconicHole": 18,
    },
    "Barnbougle Dunes": {
        "yearFounded": 2004, "par": 71, "iconicHole": 7,
    },
    "Crooked Stick Golf Club": {
        "yearFounded": 1964, "par": 72, "iconicHole": 18,
    },
    "Sand Hills Golf Club": {
        "yearFounded": 1995, "par": 71, "iconicHole": 7,
    },
}


CONTINENT_BY_COUNTRY: dict[str, tuple[str, str]] = {
    "United States": ("US", "NA"),
    "USA": ("US", "NA"),
    "Scotland": ("GB-SCT", "EU"),
    "England": ("GB-ENG", "EU"),
    "Wales": ("GB-WLS", "EU"),
    "Northern Ireland": ("GB-NIR", "EU"),
    "Ireland": ("IE", "EU"),
    "Spain": ("ES", "EU"),
    "France": ("FR", "EU"),
    "Italy": ("IT", "EU"),
    "Germany": ("DE", "EU"),
    "Switzerland": ("CH", "EU"),
    "Portugal": ("PT", "EU"),
    "Netherlands": ("NL", "EU"),
    "Belgium": ("BE", "EU"),
    "Sweden": ("SE", "EU"),
    "Norway": ("NO", "EU"),
    "Denmark": ("DK", "EU"),
    "Australia": ("AU", "OC"),
    "New Zealand": ("NZ", "OC"),
    "Japan": ("JP", "AS"),
    "South Korea": ("KR", "AS"),
    "China": ("CN", "AS"),
    "United Arab Emirates": ("AE", "AS"),
    "Canada": ("CA", "NA"),
    "Mexico": ("MX", "NA"),
    "South Africa": ("ZA", "AF"),
    "Argentina": ("AR", "SA"),
    "Brazil": ("BR", "SA"),
    "Chile": ("CL", "SA"),
}

WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "PardleScraper/0.1 (https://pardle.app)"


def fetch_json(params: dict[str, str]) -> Optional[dict]:
    url = f"{WIKI_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except Exception as exc:
            if attempt == 2:
                print(f"  fetch error after retries: {exc}", file=sys.stderr)
                return None
            time.sleep(0.8 * (attempt + 1))
    return None


def fetch_coords(title: str) -> Optional[tuple[float, float]]:
    data = fetch_json(
        {
            "action": "query",
            "prop": "coordinates",
            "format": "json",
            "titles": title,
            "redirects": "1",
        }
    )
    if not data:
        return None
    for page in data.get("query", {}).get("pages", {}).values():
        coords = page.get("coordinates", [])
        if coords:
            return (coords[0]["lat"], coords[0]["lon"])
    return None


def fetch_wikitext(title: str) -> Optional[str]:
    data = fetch_json(
        {
            "action": "parse",
            "page": title,
            "format": "json",
            "prop": "wikitext",
            "redirects": "1",
        }
    )
    if not data:
        return None
    return data.get("parse", {}).get("wikitext", {}).get("*")


INFOBOX_RE = re.compile(r"\{\{Infobox golf (?:facility|course|club)\b", re.IGNORECASE)


def extract_infobox(wikitext: str) -> Optional[str]:
    m = INFOBOX_RE.search(wikitext)
    if not m:
        return None
    start = m.start()
    depth = 0
    i = start
    while i < len(wikitext) - 1:
        if wikitext[i:i + 2] == "{{":
            depth += 1
            i += 2
        elif wikitext[i:i + 2] == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return wikitext[start:i]
        else:
            i += 1
    return None


def parse_infobox_fields(infobox: str) -> dict[str, str]:
    body = infobox[2:-2]
    parts: list[str] = []
    template_depth = 0
    link_depth = 0
    buf = ""
    i = 0
    while i < len(body):
        if body[i:i + 2] == "{{":
            template_depth += 1
            buf += "{{"
            i += 2
        elif body[i:i + 2] == "}}":
            template_depth -= 1
            buf += "}}"
            i += 2
        elif body[i:i + 2] == "[[":
            link_depth += 1
            buf += "[["
            i += 2
        elif body[i:i + 2] == "]]":
            link_depth -= 1
            buf += "]]"
            i += 2
        elif body[i] == "|" and template_depth == 0 and link_depth == 0:
            parts.append(buf)
            buf = ""
            i += 1
        else:
            buf += body[i]
            i += 1
    parts.append(buf)
    fields: dict[str, str] = {}
    for raw in parts[1:]:
        if "=" not in raw:
            continue
        k, _, v = raw.partition("=")
        fields[k.strip().lower()] = v.strip()
    return fields


def parse_year(value: str) -> Optional[int]:
    cleaned = re.sub(r"<ref[^>]*>.*?</ref>", "", value, flags=re.DOTALL)
    cleaned = re.sub(r"<!--.*?-->", "", cleaned, flags=re.DOTALL)
    m = re.search(r"\b(1[5-9]\d{2}|20[0-2]\d)\b", cleaned)
    return int(m.group(0)) if m else None


def parse_par(value: str) -> Optional[int]:
    cleaned = re.sub(r"<ref[^>]*>.*?</ref>", "", value, flags=re.DOTALL)
    m = re.search(r"\b(6[5-9]|7[0-3])\b", cleaned)
    return int(m.group(0)) if m else None


def country_from_infobox(fields: dict[str, str]) -> Optional[tuple[str, str, str]]:
    candidates: list[str] = []
    for key in ("location", "country", "courselocation", "address"):
        v = fields.get(key, "")
        if v:
            candidates.append(v)
    blob = " ".join(candidates)
    for name, (code, cont) in CONTINENT_BY_COUNTRY.items():
        if re.search(rf"\b{re.escape(name)}\b", blob, re.IGNORECASE):
            return (name, code, cont)
    return None


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name.lower(), flags=re.UNICODE)
    s = re.sub(r"\s+", "-", s).strip("-")
    return s


def short_name(name: str) -> str:
    cleaned = re.sub(r"\s*\([^)]*\)\s*", "", name)
    drop = [
        " Golf Club", " Country Club", " Golf Course", " Golf Links",
        " Resort", " National", " Club",
    ]
    for d in drop:
        if cleaned.endswith(d):
            cleaned = cleaned[: -len(d)]
            break
    return cleaned.strip() or name


def scrape_one(title: str, course_type: str, tier: str) -> Optional[dict]:
    print(f"[{tier}] {title}", flush=True)
    coords = fetch_coords(title)
    if not coords:
        print("  no coordinates", file=sys.stderr)
        return None
    lat, lng = coords
    wikitext = fetch_wikitext(title) or ""
    infobox = extract_infobox(wikitext)
    fields = parse_infobox_fields(infobox) if infobox else {}

    year = None
    for k in ("established", "founded", "opened", "year_established", "year_founded"):
        if k in fields:
            year = parse_year(fields[k])
            if year:
                break

    par = None
    for k in ("course1par", "par", "course_par"):
        if k in fields:
            par = parse_par(fields[k])
            if par:
                break

    country_data = country_from_infobox(fields)
    if not country_data:
        # Fall back to text search across the whole infobox.
        blob = " ".join(fields.values())
        for name, (code, cont) in CONTINENT_BY_COUNTRY.items():
            if re.search(rf"\b{re.escape(name)}\b", blob, re.IGNORECASE):
                country_data = (name, code, cont)
                break

    if not country_data:
        print(f"  could not resolve country", file=sys.stderr)
        return None

    country, country_code, continent = country_data
    # Normalise the abbreviated form so "USA" doesn't show up alongside
    # "United States" in the UI / autocomplete.
    if country == "USA":
        country = "United States"

    record = {
        "id": slugify(title),
        "name": title,
        "shortName": short_name(title),
        "country": country,
        "countryCode": country_code,
        "continent": continent,
        "yearFounded": year or 1900,
        "courseType": course_type,
        "par": par or 72,
        "lat": round(lat, 5),
        "lng": round(lng, 5),
        "zoom": 15,
        "iconicHole": 18,
        "tier": tier,
    }

    overrides = COURSE_OVERRIDES.get(title)
    if overrides:
        record.update(overrides)

    return record


def main() -> int:
    out: list[dict] = []
    failures: list[str] = []
    for title, course_type, tier in COURSES:
        rec = scrape_one(title, course_type, tier)
        if rec:
            out.append(rec)
        else:
            failures.append(title)
        time.sleep(0.45)

    print(f"\nScraped {len(out)}/{len(COURSES)}")
    if failures:
        print(f"Failures: {len(failures)}")
        for f in failures:
            print(f"  - {f}")

    with open("lib/data/courses.ts", "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/scrape_courses.py — do not edit manually.\n")
        f.write("// Coordinates fetched via Wikipedia's prop=coordinates API; year/par\n")
        f.write("// extracted from each course's infobox where present, otherwise\n")
        f.write("// a sensible default. Re-run the script to refresh.\n\n")
        f.write('import type { Course } from "@/lib/game/holes-types";\n\n')
        f.write("export const COURSES: Course[] = ")
        f.write(json.dumps(out, indent=2, ensure_ascii=False))
        f.write(";\n")

    print(f"Wrote lib/data/courses.ts ({len(out)} courses)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
