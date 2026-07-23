"""
scripts/r1-residuals.py

Compute the v3 (yardage + directional wind) residual for every
cluster on every hole, using the current LIVE birdie-history data
(cluster letters match the modal), then look up:
  - the 8 R1 pins the API has served → residual of the nearest cluster
  - the 9 R1 pins Tom read from the sheet by cluster letter → residual
    of THAT cluster directly
  - the still-missing hole (H13)

Output: per-hole verdict — EASIER / HARDER / neutral — anchored to
the same regression that produced the article's tables.
"""

import json
import math
import urllib.request
from pathlib import Path

import numpy as np

REPO_ROOT = Path("C:/Users/tombu/pardle")
SCRATCH = Path(
    "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/"
    "5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad"
)

# Hole bearings from OSM way geometry — same values used by v3
HOLE_BEARING = {
    1: 283, 2: 354, 3: 114, 4: 73, 5: 74, 6: 289, 7: 214, 8: 310,
    9: 149, 10: 167, 11: 175, 12: 336, 13: 140, 14: 54, 15: 14,
    16: 204, 17: 261, 18: 318,
}

R1_INPUTS = json.load(open(SCRATCH / "r1-inputs.json"))
YARDS = {int(k): v for k, v in R1_INPUTS["yards"].items()}
API_PINS = {int(k): tuple(v) for k, v in R1_INPUTS["api_pins"].items()}
TOM_CLUSTERS = {int(k): v for k, v in R1_INPUTS["tom_clusters"].items()}


def load_context():
    """Historical yardage + wind per (year, round) for the fit."""
    ctx = {}
    for y in range(2019, 2026):
        p = REPO_ROOT / "data" / "historical" / f"3m-open-{y}.json"
        if not p.exists():
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        weather = d.get("weatherByRound") or {}
        yards_by_round = {}
        for player in d.get("players", []):
            for rstr, rd in (player.get("rounds") or {}).items():
                r = int(rstr)
                for hstr, hole in (rd.get("holes") or {}).items():
                    if hole and isinstance(hole.get("yards"), (int, float)):
                        yards_by_round.setdefault(r, {}).setdefault(int(hstr), []).append(hole["yards"])
        for r in [1, 2, 3, 4]:
            wr = weather.get(str(r)) or {}
            w = wr.get("windAvgMph")
            wd = wr.get("windDirDeg")
            if w is None or wd is None:
                continue
            yh = yards_by_round.get(r, {})
            per_hole = {h: sum(vs) / len(vs) for h, vs in yh.items()}
            ctx[(y, r)] = {"wind": float(w), "wind_dir_deg": float(wd),
                           "yards_by_hole": per_hole}
    return ctx


def fit_v3_per_hole(bh, ctx):
    """Fit v3 (yards + headwind) per hole and return per-cluster residual."""
    residuals = {}  # {hole: {cluster_letter: residual_pp}}
    coeffs = {}    # {hole: (b_yards, b_head, intercept)}
    for hole_str, hd in bh["holes"].items():
        hole = int(hole_str)
        clusters = hd["clusters"]
        pins = hd["pins"]
        hb_rad = HOLE_BEARING.get(hole, 0) * math.pi / 180
        rows = []
        for i, p in enumerate(pins):
            y, r = int(p["year"]), int(p["round"])
            key = (y, r)
            if key not in ctx:
                continue
            yards = ctx[key]["yards_by_hole"].get(hole)
            if yards is None:
                continue
            wind = ctx[key]["wind"]
            wd = ctx[key]["wind_dir_deg"]
            rad = wd * math.pi / 180
            headwind = wind * math.cos(rad - hb_rad)
            ci = None
            for j, c in enumerate(clusters):
                if i in c.get("memberIndices", []):
                    ci = j
                    break
            if ci is None:
                continue
            rows.append({"rate": p["rate"], "yards": yards, "wind": wind,
                         "headwind": headwind, "cluster_idx": ci,
                         "total": p["total"]})
        if len(rows) < 8:
            continue
        X = np.array([[r["yards"], r["headwind"], 1] for r in rows], dtype=float)
        Y = np.array([r["rate"] for r in rows])
        W = np.sqrt(np.array([r["total"] for r in rows], dtype=float))
        params, *_ = np.linalg.lstsq(X * W[:, None], Y * W, rcond=None)
        pred = X @ params
        res = Y - pred
        b_yards, b_head, intercept = params
        coeffs[hole] = (b_yards, b_head, intercept)
        # Aggregate residual per cluster (weighted by putts)
        agg = {}
        for row, r_val in zip(rows, res):
            a = agg.setdefault(row["cluster_idx"], {"rw": 0, "rs": 0})
            a["rs"] += r_val * row["total"]
            a["rw"] += row["total"]
        residuals[hole] = {chr(65 + ci): agg[ci]["rs"] / agg[ci]["rw"] * 100
                           for ci in agg}
    return residuals, coeffs


def main():
    bh = json.load(open(SCRATCH / "birdies-current.json"))
    ctx = load_context()
    residuals, coeffs = fit_v3_per_hole(bh, ctx)

    def verdict(r):
        if r is None:
            return "?"
        if r >= 3:
            return "EASIER"
        if r <= -3:
            return "HARDER"
        if abs(r) < 1.5:
            return "neutral"
        return "mild " + ("+" if r > 0 else "-")

    def nearest_letter(hole, x, y):
        clusters = bh["holes"][str(hole)]["clusters"]
        best = None
        for i, c in enumerate(clusters):
            d = math.hypot(x - c["centroid"]["x"], y - c["centroid"]["y"])
            if best is None or d < best[0]:
                best = (d, chr(65 + i))
        return best[1] if best else "?"

    print(f"{'Hole':>4}  {'Par':>3}  {'Yds':>4}  {'Source':>8}  {'Cluster':>7}  {'Residual':>9}  {'Verdict':>10}")
    print("-" * 60)
    for hole in range(1, 19):
        par = None
        for h in bh["holes"][str(hole)].get("clusters", []):
            pass
        par = "?"
        for h in bh["holes"][str(hole)].get("pins", [])[:1]:
            pass
        # Reuse the pins API par
        try:
            pins_api = json.load(open(SCRATCH / "pins-2026-live.json"))
            for hh in pins_api["pins"]["holes"]:
                if hh["holeNumber"] == hole:
                    par = hh.get("par", "?")
                    break
        except Exception:
            pass
        yds = YARDS.get(hole, "?")
        if hole in API_PINS:
            x, y = API_PINS[hole]
            letter = nearest_letter(hole, x, y)
            src = "API"
        elif hole in TOM_CLUSTERS:
            letter = TOM_CLUSTERS[hole]
            src = "Tom"
        else:
            letter = "—"
            src = "MISSING"
        r = residuals.get(hole, {}).get(letter)
        r_txt = f"{r:+.1f}pp" if r is not None else "n/a"
        print(f"H{hole:>3}  {str(par):>3}  {yds:>4}  {src:>8}  {letter:>7}  {r_txt:>9}  {verdict(r):>10}")

    # Also print per-hole coefficients so we can sanity-check them
    print()
    print("Per-hole v3 model coefficients (for reference):")
    print(f"{'Hole':>4}  {'b_yards (pp/10yd)':>18}  {'b_head (pp/5mph)':>18}")
    for hole in sorted(coeffs):
        by, bh_, _ = coeffs[hole]
        print(f"H{hole:>3}  {by * 10 * 100:>+14.2f}pp/10yd  {bh_ * 5 * 100:>+14.2f}pp/5mph")


if __name__ == "__main__":
    main()
