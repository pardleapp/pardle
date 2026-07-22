"""
scripts/analyze-pin-difficulty-v3.py

Same model as v2, but instead of letting the regression learn each
hole's wind axis from the data, we use the ACTUAL compass bearing of
each hole's APPROACH LEG (last segment of the OSM way from OpenStreetMap).
That's the direction of the birdie-determining shot.

Model per hole:

    birdie_rate = a + b_yards * yards + b_head * headwind

where headwind = wind_speed * cos(wind_dir_deg - hole_bearing_deg)
      (positive when wind blows into the player's face on the
       approach)

Advantages over v2:
  - one fewer parameter (b_head vs b_u + b_v)
  - hole bearing is a real-world fact, not a fitted quantity
  - doesn't waste 1 df fitting noise on weak-wind holes

Reports per-hole coefficients and side-by-side v1/v2/v3 residuals
for the 11 clusters featured in the article.
"""

import json
import math
import urllib.request
from pathlib import Path

import numpy as np

REPO_ROOT = Path("C:/Users/tombu/pardle")
BIRDIE_URL = "https://pardle.app/api/course-pin-birdies?tournamentId=R2026525"

# Hole bearings from OpenStreetMap way geometry — LAST-LEG bearing for
# doglegged holes (par-4 approach + par-5 second shot direction).
# Extracted from the OSM query above.
HOLE_BEARING = {
    # For par-3s: bearing = tee→green.
    # For par-4s: bearing = approach-leg direction (last segment of OSM way).
    # For par-5s: bearing = fairway-landing→green (skip the tee shot leg,
    #   since the birdie-determining shot is usually the go-for-it 2nd or
    #   the wedge from lay-up, both of which travel in the direction of
    #   the last long segment).
    1:  283,   # par-4 approach leg
    2:  354,   # par-4 straight
    3:  114,   # par-4 approach leg
    4:  73,    # par-3
    5:  74,    # par-4 approach leg
    6:  289,   # par-5 fairway→green
    7:  214,   # par-4 approach leg
    8:  310,   # par-3
    9:  149,   # par-4 approach leg
    10: 167,   # par-4 approach leg
    11: 175,   # par-4 approach leg
    12: 336,   # par-5 fairway→green (was 325 — last leg was too short a wedge)
    13: 140,   # par-3
    14: 54,    # par-4 approach leg
    15: 14,    # par-4 approach leg
    16: 204,   # par-4 approach leg
    17: 261,   # par-3
    18: 318,   # par-5 fairway→green (was 25 — that "last leg" was a 62yd wedge, not
               # the birdie-determining second shot which flies NW to the green)
}


def load_birdie_history():
    with urllib.request.urlopen(BIRDIE_URL, timeout=60) as r:
        return json.load(r)


def load_historical(year: int):
    p = REPO_ROOT / "data" / "historical" / f"3m-open-{year}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def build_context():
    ctx = {}
    for y in range(2019, 2026):
        h = load_historical(y)
        if not h:
            continue
        weather = h.get("weatherByRound") or {}
        yards_by_hole_round = {}
        for p in h.get("players", []):
            for rstr, r in (p.get("rounds") or {}).items():
                round_num = int(rstr)
                for hstr, hole in (r.get("holes") or {}).items():
                    if hole and isinstance(hole.get("yards"), (int, float)):
                        yards_by_hole_round.setdefault(round_num, {})[int(hstr)] = hole["yards"]
        for r in [1, 2, 3, 4]:
            wr = weather.get(str(r)) or {}
            w = wr.get("windAvgMph")
            wd = wr.get("windDirDeg")
            ctx.setdefault(y, {})[r] = {
                "wind": float(w) if isinstance(w, (int, float)) else None,
                "wind_dir_deg": float(wd) if isinstance(wd, (int, float)) else None,
                "yards_by_hole": yards_by_hole_round.get(r, {}),
            }
    return ctx


def cluster_letter(i: int) -> str:
    return chr(65 + i) if i < 26 else f"AA{i}"


def fit_v1(rows):
    X = np.array([[r["yards"], r["wind"], 1] for r in rows], dtype=float)
    Y = np.array([r["rate"] for r in rows])
    W = np.sqrt(np.array([r["total"] for r in rows], dtype=float))
    params, *_ = np.linalg.lstsq(X * W[:,None], Y * W, rcond=None)
    return params, X @ params, Y - (X @ params)


def fit_v2(rows):
    X = np.array([[r["yards"], r["u"], r["v"], 1] for r in rows], dtype=float)
    Y = np.array([r["rate"] for r in rows])
    W = np.sqrt(np.array([r["total"] for r in rows], dtype=float))
    params, *_ = np.linalg.lstsq(X * W[:,None], Y * W, rcond=None)
    return params, X @ params, Y - (X @ params)


def fit_v3(rows):
    """Use fixed hole bearing to compute a headwind feature.
       Wind convention: windDirDeg = direction wind is FROM.
       Player shooting in direction hole_bearing gets a headwind whenever
       wind is FROM that direction. So headwind = wind_speed * cos(wind_dir - hole_bearing).
       Positive value = into the player's face on the approach. """
    X = np.array([[r["yards"], r["headwind"], 1] for r in rows], dtype=float)
    Y = np.array([r["rate"] for r in rows])
    W = np.sqrt(np.array([r["total"] for r in rows], dtype=float))
    params, *_ = np.linalg.lstsq(X * W[:,None], Y * W, rcond=None)
    return params, X @ params, Y - (X @ params)


def wls_r2(rows, params, features_fn):
    """Weighted R^2 = 1 - SSR/SST where SST is around weighted mean."""
    X = features_fn(rows)
    Y = np.array([r["rate"] for r in rows])
    W = np.array([r["total"] for r in rows], dtype=float)
    pred = X @ params
    y_bar = float(np.sum(W * Y) / np.sum(W))
    ssr = float(np.sum(W * (Y - pred) ** 2))
    sst = float(np.sum(W * (Y - y_bar) ** 2))
    return 1 - ssr / sst if sst > 0 else 0


def analyze():
    bh = load_birdie_history()
    holes = bh["holes"]
    ctx = build_context()

    findings = {"v1": [], "v2": [], "v3": []}
    hole_r2 = {}

    for hole_str, data in holes.items():
        hole = int(hole_str)
        pins = data.get("pins", [])
        clusters = data.get("clusters", [])
        if not pins or not clusters:
            continue
        rows = []
        for i, p in enumerate(pins):
            y, r = int(p["year"]), int(p["round"])
            year_ctx = ctx.get(y, {}).get(r, {})
            yards = year_ctx.get("yards_by_hole", {}).get(hole)
            wind = year_ctx.get("wind")
            wd = year_ctx.get("wind_dir_deg")
            if yards is None or wind is None or wd is None: continue
            ci = None
            for j, c in enumerate(clusters):
                if i in c.get("memberIndices", []):
                    ci = j; break
            if ci is None: continue
            rad = wd * math.pi / 180
            hb_rad = HOLE_BEARING.get(hole, 0) * math.pi / 180
            headwind = wind * math.cos(rad - hb_rad)
            rows.append({
                "rate": p["rate"], "yards": yards, "wind": wind, "wind_dir": wd,
                "u": wind * math.cos(rad), "v": wind * math.sin(rad),
                "headwind": headwind, "cluster_idx": ci,
                "total": p["total"], "birdies": p["birdies"],
                "year": p["year"], "round": p["round"],
            })
        if len(rows) < 8: continue

        try:
            p1, _, r1 = fit_v1(rows)
            p2, _, r2 = fit_v2(rows)
            p3, _, r3 = fit_v3(rows)
        except np.linalg.LinAlgError:
            continue

        # Weighted R^2 for each
        R2 = {
            "v1": wls_r2(rows, p1, lambda rs: np.array([[r["yards"], r["wind"], 1] for r in rs], dtype=float)),
            "v2": wls_r2(rows, p2, lambda rs: np.array([[r["yards"], r["u"], r["v"], 1] for r in rs], dtype=float)),
            "v3": wls_r2(rows, p3, lambda rs: np.array([[r["yards"], r["headwind"], 1] for r in rs], dtype=float)),
        }
        hole_r2[hole] = {**R2, "b_head_v3": p3[1]}

        for label, resid in [("v1", r1), ("v2", r2), ("v3", r3)]:
            agg = {}
            for row, res in zip(rows, resid):
                ci = row["cluster_idx"]
                a = agg.setdefault(ci, {"birdies":0, "total":0, "r_sum":0, "r_w":0})
                a["birdies"] += row["birdies"]
                a["total"]   += row["total"]
                a["r_sum"]   += res * row["total"]
                a["r_w"]     += row["total"]
            for ci, a in agg.items():
                if a["r_w"] < 60: continue
                cluster = clusters[ci]
                mr = a["r_sum"] / a["r_w"]
                obs = a["birdies"] / a["total"]
                exp = obs - mr
                findings[label].append({
                    "hole": hole, "cluster": cluster_letter(ci),
                    "observed_rate": obs, "expected_rate": exp,
                    "residual": mr, "total": a["total"],
                    "pin_count": cluster.get("pinCount", 0),
                })

    return findings, hole_r2


def main():
    findings, hole_r2 = analyze()

    # R^2 comparison per hole
    print("=" * 84)
    print("MODEL FIT PER HOLE (weighted R^2)")
    print("=" * 84)
    print(f'{"Hole":>4}  {"v1":>6}  {"v2":>6}  {"v3":>6}  {"b_head_v3 (pp/5mph)":>22}')
    print("-" * 84)
    total = {"v1":0.0, "v2":0.0, "v3":0.0}
    n = 0
    for h in sorted(hole_r2):
        c = hole_r2[h]
        print(f'H{h:>3}  {c["v1"]:>5.3f}  {c["v2"]:>5.3f}  {c["v3"]:>5.3f}  {c["b_head_v3"]*5*100:>+15.2f}pp/5mph')
        for v in ["v1","v2","v3"]: total[v] += c[v]
        n += 1
    print("-" * 84)
    print(f'{"AVG":>4}  {total["v1"]/n:>5.3f}  {total["v2"]/n:>5.3f}  {total["v3"]/n:>5.3f}')

    # Side-by-side residuals for article clusters
    ARTICLE = [
        (12, "D"), (2, "C"), (18, "D"), (10, "B"), (9, "D"),
        (2, "D"), (12, "A"), (17, "D"), (10, "F"), (13, "D"), (18, "B"),
    ]
    print()
    print("=" * 96)
    print("ARTICLE CLUSTERS — v1 vs v2 vs v3 residuals (pp)")
    print("=" * 96)
    v1m = {(f["hole"], f["cluster"]): f["residual"] for f in findings["v1"]}
    v2m = {(f["hole"], f["cluster"]): f["residual"] for f in findings["v2"]}
    v3m = {(f["hole"], f["cluster"]): f["residual"] for f in findings["v3"]}
    print(f'{"Hole":>4}  {"Cluster":>7}  {"v1":>7}  {"v2":>7}  {"v3":>7}  {"v3-v2":>7}')
    print("-"*72)
    for hole, letter in ARTICLE:
        if (hole, letter) not in v3m: continue
        v1r = v1m.get((hole, letter), 0)*100
        v2r = v2m.get((hole, letter), 0)*100
        v3r = v3m.get((hole, letter), 0)*100
        print(f'H{hole:>3}  {letter:>7}  {v1r:>+6.1f}pp  {v2r:>+6.1f}pp  {v3r:>+6.1f}pp  {v3r-v2r:>+6.1f}pp')

    # New top-10 harder/easier under v3
    v3_sorted = sorted(findings["v3"], key=lambda f: f["residual"], reverse=True)
    print()
    print("=" * 84)
    print("V3 — EASIER-THAN-EXPECTED TOP 10")
    print("=" * 84)
    print(f'{"Hole":>4}  {"Cluster":>7}  {"Obs":>6}  {"Exp":>6}  {"Delta":>7}  {"Sample":>6}')
    print("-"*84)
    for f in v3_sorted[:10]:
        print(f'H{f["hole"]:>3}  {f["cluster"]:>7}  {f["observed_rate"]*100:>5.1f}%  {f["expected_rate"]*100:>5.1f}%  {f["residual"]*100:>+6.1f}pp  {f["total"]:>6d}')
    print()
    print("=" * 84)
    print("V3 — HARDER-THAN-EXPECTED TOP 10")
    print("=" * 84)
    print(f'{"Hole":>4}  {"Cluster":>7}  {"Obs":>6}  {"Exp":>6}  {"Delta":>7}  {"Sample":>6}')
    print("-"*84)
    for f in v3_sorted[-10:][::-1]:
        print(f'H{f["hole"]:>3}  {f["cluster"]:>7}  {f["observed_rate"]*100:>5.1f}%  {f["expected_rate"]*100:>5.1f}%  {f["residual"]*100:>+6.1f}pp  {f["total"]:>6d}')


if __name__ == "__main__":
    main()
