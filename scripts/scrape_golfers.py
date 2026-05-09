"""
Scrape golfer biographical data from Wikipedia and emit a TypeScript file
suitable for use as the live Pardle player database.

Run from repo root:
    python scripts/scrape_golfers.py

Output: lib/data/golfers.ts
"""

from __future__ import annotations

import datetime
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from typing import Optional

# ---------------------------------------------------------------------------
# Player list (Wikipedia page title -> assigned tier).
# Tier guides the day-of-week difficulty curve:
#   S = household name (Mondays)
#   A = top star or recent major winner (Tue/Wed)
#   B = tour regular (Thu/Fri)
#   C = lesser-known tour pro (Sat/Sun)
# ---------------------------------------------------------------------------
PLAYERS: list[tuple[str, str]] = [
    # S tier — most recognizable men's golfers globally
    ("Scottie Scheffler", "S"),
    ("Rory McIlroy", "S"),
    ("Jon Rahm", "S"),
    ("Xander Schauffele", "S"),
    ("Bryson DeChambeau", "S"),
    ("Justin Thomas", "S"),
    ("Jordan Spieth", "S"),
    ("Brooks Koepka", "S"),
    ("Dustin Johnson", "S"),
    ("Hideki Matsuyama", "S"),
    ("Collin Morikawa", "S"),
    ("Tiger Woods", "S"),
    ("Phil Mickelson", "S"),
    ("Patrick Cantlay", "S"),

    # A tier — top 50 or recent major winners
    ("Viktor Hovland", "A"),
    ("Tommy Fleetwood", "A"),
    ("Tony Finau", "A"),
    ("Ludvig Åberg", "A"),
    ("Cameron Smith (golfer)", "A"),
    ("Cameron Young", "A"),
    ("Wyndham Clark", "A"),
    ("Tom Kim (golfer)", "A"),
    ("Shane Lowry (golfer)", "A"),
    ("Matt Fitzpatrick", "A"),
    ("Sahith Theegala", "A"),
    ("Sungjae Im", "A"),
    ("Min Woo Lee", "A"),
    ("Robert MacIntyre", "A"),
    ("Adam Scott (golfer)", "A"),
    ("Justin Rose", "A"),
    ("Sergio García", "A"),
    ("Joaquín Niemann", "A"),
    ("Russell Henley", "A"),
    ("Sepp Straka", "A"),
    ("Akshay Bhatia", "A"),
    ("Keegan Bradley", "A"),
    ("Patrick Reed", "A"),
    ("Bubba Watson", "A"),
    ("Webb Simpson", "A"),
    ("Sam Burns", "A"),
    ("Max Homa", "A"),
    ("Rickie Fowler", "A"),
    ("Tyrrell Hatton", "A"),
    ("Jason Day", "A"),
    ("Brian Harman", "A"),
    ("Cameron Davis (golfer)", "A"),

    # B tier — tour regulars, ryder/presidents cup level
    ("Si Woo Kim", "B"),
    ("Byeong-hun An", "B"),
    ("Daniel Berger", "B"),
    ("Will Zalatoris", "B"),
    ("Adam Hadwin", "B"),
    ("Mackenzie Hughes", "B"),
    ("Stephan Jaeger", "B"),
    ("Lucas Glover", "B"),
    ("Lee Westwood", "B"),
    ("Henrik Stenson", "B"),
    ("Kevin Kisner", "B"),
    ("Maverick McNealy", "B"),
    ("Taylor Pendrith", "B"),
    ("Nick Taylor (golfer)", "B"),
    ("J. T. Poston", "B"),
    ("Davis Thompson", "B"),
    ("Chris Kirk", "B"),
    ("Charley Hoffman", "B"),
    ("Lucas Herbert", "B"),
    ("Adam Schenk", "B"),
    ("Aaron Rai", "B"),
    ("Eric Cole", "B"),

    # C tier — recognizable to fans, less to casuals
    ("Joel Dahmen", "C"),
    ("Brendan Steele", "C"),
    ("Christiaan Bezuidenhout", "C"),
    ("Adrian Meronk", "C"),
    ("Thorbjørn Olesen", "C"),
    ("Matti Schmid", "C"),
    ("Pat Perez", "C"),
    ("Mark Hubbard", "C"),
    ("Andrew Putnam", "C"),
    ("Beau Hossler", "C"),
    ("Aaron Wise", "C"),
    ("Cam Davis", "C"),
    ("Cameron Champ", "C"),
    ("Doug Ghim", "C"),
    ("Hayden Springer", "C"),
    ("Davis Riley", "C"),
    ("Ben Griffin (golfer)", "C"),
    ("Nick Dunlap", "C"),
]

# Country -> (ISO code, continent)
COUNTRY_MAP: dict[str, tuple[str, str]] = {
    "United States": ("US", "NA"),
    "USA": ("US", "NA"),
    "Northern Ireland": ("GB-NIR", "EU"),
    "England": ("GB-ENG", "EU"),
    "Scotland": ("GB-SCT", "EU"),
    "Wales": ("GB-WLS", "EU"),
    "Ireland": ("IE", "EU"),
    "Spain": ("ES", "EU"),
    "Norway": ("NO", "EU"),
    "Sweden": ("SE", "EU"),
    "Germany": ("DE", "EU"),
    "France": ("FR", "EU"),
    "Italy": ("IT", "EU"),
    "Denmark": ("DK", "EU"),
    "Austria": ("AT", "EU"),
    "Poland": ("PL", "EU"),
    "Belgium": ("BE", "EU"),
    "Netherlands": ("NL", "EU"),
    "Finland": ("FI", "EU"),
    "Canada": ("CA", "NA"),
    "Mexico": ("MX", "NA"),
    "Australia": ("AU", "OC"),
    "New Zealand": ("NZ", "OC"),
    "Japan": ("JP", "AS"),
    "South Korea": ("KR", "AS"),
    "Korea, South": ("KR", "AS"),
    "Korea": ("KR", "AS"),
    "China": ("CN", "AS"),
    "Thailand": ("TH", "AS"),
    "Philippines": ("PH", "AS"),
    "India": ("IN", "AS"),
    "Taiwan": ("TW", "AS"),
    "South Africa": ("ZA", "AF"),
    "Zimbabwe": ("ZW", "AF"),
    "Argentina": ("AR", "SA"),
    "Chile": ("CL", "SA"),
    "Colombia": ("CO", "SA"),
    "Venezuela": ("VE", "SA"),
    "Brazil": ("BR", "SA"),
}

WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "PardleScraper/0.1 (https://pardle.app contact:pardle.app@gmail.com)"


def fetch_wikitext(page_title: str) -> Optional[str]:
    params = {
        "action": "parse",
        "page": page_title,
        "format": "json",
        "prop": "wikitext",
        "redirects": "1",
    }
    url = f"{WIKI_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
        return data.get("parse", {}).get("wikitext", {}).get("*")
    except Exception as exc:
        print(f"  fetch error for {page_title}: {exc}", file=sys.stderr)
        return None


INFOBOX_RE = re.compile(r"\{\{Infobox golfer\b", re.IGNORECASE)


def extract_infobox(wikitext: str) -> Optional[str]:
    match = INFOBOX_RE.search(wikitext)
    if not match:
        return None
    start = match.start()
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


def parse_fields(infobox: str) -> dict[str, str]:
    """
    Split a MediaWiki Infobox body on top-level `|` separators, respecting
    nested {{template}} and [[wikilink]] depth so internal pipes are not
    treated as field boundaries.
    """
    fields: dict[str, str] = {}
    body = infobox[2:-2]
    parts: list[str] = []
    template_depth = 0
    link_depth = 0
    buf = ""
    i = 0
    n = len(body)
    while i < n:
        if i + 1 < n and body[i:i + 2] == "{{":
            template_depth += 1
            buf += "{{"
            i += 2
            continue
        if i + 1 < n and body[i:i + 2] == "}}":
            template_depth -= 1
            buf += "}}"
            i += 2
            continue
        if i + 1 < n and body[i:i + 2] == "[[":
            link_depth += 1
            buf += "[["
            i += 2
            continue
        if i + 1 < n and body[i:i + 2] == "]]":
            link_depth -= 1
            buf += "]]"
            i += 2
            continue
        ch = body[i]
        if ch == "|" and template_depth == 0 and link_depth == 0:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
        i += 1
    parts.append(buf)
    for raw in parts[1:]:
        if "=" not in raw:
            continue
        key, _, value = raw.partition("=")
        fields[key.strip().lower()] = value.strip()
    return fields


def parse_birth_date(value: str) -> Optional[datetime.date]:
    # Allow optional flag args like df=yes, mf=yes between the template name
    # and the date triple, e.g. {{birth date and age|df=yes|1989|5|4}}.
    m = re.search(
        r"birth date(?:\s+and\s+age)?\s*\|\s*(?:[a-z]+\s*=\s*[a-z]+\s*\|\s*)*"
        r"(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})",
        value,
        re.IGNORECASE,
    )
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def calc_age(dob: datetime.date, today: Optional[datetime.date] = None) -> int:
    today = today or datetime.date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


HEIGHT_FT_IN_RE = re.compile(r"(\d+)\s*ft\s*(\d+)\s*in", re.IGNORECASE)
HEIGHT_CM_RE = re.compile(r"(\d{3})\s*cm", re.IGNORECASE)
HEIGHT_M_RE = re.compile(r"(\d)\.(\d{2})\s*m", re.IGNORECASE)


def parse_height_cm(value: str) -> Optional[int]:
    cleaned = re.sub(r"<ref[^>]*>.*?</ref>", "", value, flags=re.DOTALL)
    cleaned = re.sub(r"<ref[^/]*/>", "", cleaned)

    # {{height|ft=5|in=9}} or {{height|ft=6|in=1|frac=1/2}}
    m = re.search(
        r"\{\{\s*height\s*\|[^}]*?\bft\s*=\s*(\d+)\b[^}]*?\bin\s*=\s*(\d+)\b([^}]*)\}\}",
        cleaned,
        re.IGNORECASE,
    )
    if m:
        ft = int(m.group(1))
        inches = int(m.group(2))
        frac_match = re.search(r"frac\s*=\s*(\d+)\s*/\s*(\d+)", m.group(3))
        if frac_match:
            inches += int(frac_match.group(1)) / int(frac_match.group(2))
        return round((ft * 12 + inches) * 2.54)

    # {{height|cm=185}}
    m = re.search(r"\{\{\s*height\s*\|\s*cm\s*=\s*(\d+)\s*\}\}", cleaned, re.IGNORECASE)
    if m:
        return int(m.group(1))

    # {{height|m=1.85}}
    m = re.search(
        r"\{\{\s*height\s*\|\s*m\s*=\s*(\d)\.(\d{1,2})\s*\}\}",
        cleaned,
        re.IGNORECASE,
    )
    if m:
        cm_part = m.group(2)
        if len(cm_part) == 1:
            cm_part += "0"
        return int(m.group(1)) * 100 + int(cm_part)

    # Plain text "5 ft 9 in"
    m = HEIGHT_FT_IN_RE.search(cleaned)
    if m:
        ft = int(m.group(1))
        inches = int(m.group(2))
        return round((ft * 12 + inches) * 2.54)

    # Plain text "180 cm"
    m = HEIGHT_CM_RE.search(cleaned)
    if m:
        return int(m.group(1))

    # Plain text "1.85 m"
    m = HEIGHT_M_RE.search(cleaned)
    if m:
        return int(m.group(1)) * 100 + int(m.group(2))

    return None


def parse_int(value: str) -> Optional[int]:
    cleaned = re.sub(r"<ref[^>]*>.*?</ref>", "", value, flags=re.DOTALL)
    cleaned = re.sub(r"<!--.*?-->", "", cleaned, flags=re.DOTALL)
    m = re.search(r"\d+", cleaned)
    return int(m.group(0)) if m else None


def parse_country(fields: dict[str, str]) -> Optional[tuple[str, str, str]]:
    """Return (country_display, country_code, continent)."""
    raw = fields.get("sporting_nationality") or fields.get("nationality") or ""
    raw = raw.strip()
    template_match = re.match(r"\{\{([A-Za-z\s\-]+?)(?:\|[^\}]*)?\}\}", raw)
    if template_match:
        candidate = template_match.group(1).strip()
        if candidate.upper() == "USA":
            candidate = "United States"
        if candidate in COUNTRY_MAP:
            code, cont = COUNTRY_MAP[candidate]
            return candidate, code, cont
    for name, (code, cont) in COUNTRY_MAP.items():
        if re.search(rf"\b{re.escape(name)}\b", raw):
            return name, code, cont
    birth_place = fields.get("birth_place", "")
    for name, (code, cont) in COUNTRY_MAP.items():
        if re.search(rf"\b{re.escape(name)}\b", birth_place):
            return name, code, cont
    return None


def slugify(name: str) -> str:
    slug = name.lower()
    slug = re.sub(r"[^\w\s-]", "", slug, flags=re.UNICODE)
    slug = re.sub(r"\s+", "-", slug).strip("-")
    return slug


def display_name(page_title: str) -> str:
    name = re.sub(r"\s*\([^)]*\)\s*", "", page_title).strip()
    return name


def scrape_one(page_title: str, tier: str) -> Optional[dict]:
    name = display_name(page_title)
    print(f"[{tier}] {name}...", flush=True)
    wikitext = fetch_wikitext(page_title)
    if not wikitext:
        return None
    infobox = extract_infobox(wikitext)
    if not infobox:
        print("  no infobox", file=sys.stderr)
        return None
    fields = parse_fields(infobox)

    dob = parse_birth_date(fields.get("birth_date", ""))
    if not dob:
        print("  could not parse birth_date", file=sys.stderr)
        return None
    age = calc_age(dob)

    height_cm = parse_height_cm(fields.get("height", ""))
    if not height_cm:
        print("  could not parse height", file=sys.stderr)
        return None

    country = parse_country(fields)
    if not country:
        print(f"  could not resolve country (raw='{fields.get('sporting_nationality', '')}')", file=sys.stderr)
        return None
    country_display, country_code, continent = country

    pga_wins = parse_int(fields.get("pgawins", "")) or 0
    majors = parse_int(fields.get("majorwins", "")) or 0
    yearpro = parse_int(fields.get("yearpro", ""))
    if not yearpro:
        print("  could not parse yearpro", file=sys.stderr)
        return None

    return {
        "id": slugify(name),
        "name": name,
        "country": country_display,
        "countryCode": country_code,
        "continent": continent,
        "age": age,
        "heightCm": height_cm,
        "majors": majors,
        "pgaTourWins": pga_wins,
        "turnedProYear": yearpro,
        "tier": tier,
    }


def main() -> int:
    results: list[dict] = []
    failures: list[tuple[str, str]] = []
    for page_title, tier in PLAYERS:
        record = scrape_one(page_title, tier)
        if record:
            results.append(record)
        else:
            failures.append((page_title, tier))
        time.sleep(0.4)

    print()
    print(f"Scraped {len(results)}/{len(PLAYERS)} players")
    if failures:
        print(f"Failures: {len(failures)}")
        for page_title, tier in failures:
            print(f"  - {page_title} ({tier})")

    out_path = "lib/data/golfers.ts"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/scrape_golfers.py — do not edit manually.\n")
        f.write("// Run `python scripts/scrape_golfers.py` from the repo root to refresh.\n\n")
        f.write('import type { Golfer } from "@/lib/game/types";\n\n')
        f.write("export const GOLFERS: Golfer[] = ")
        f.write(json.dumps(results, indent=2, ensure_ascii=False))
        f.write(";\n")
    print(f"Wrote {out_path}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
