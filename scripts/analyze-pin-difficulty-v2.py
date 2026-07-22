"""
scripts/analyze-pin-difficulty-v2.py

Same premise as analyze-pin-difficulty.py but the model now accounts
for WIND DIRECTION as well as speed. Instead of

    birdie_rate = a + b_yards * yards + b_wind * wind_mph

we fit

    birdie_rate = a + b_yards * yards + b_u * u + b_v * v

where u = wind_speed * cos(wind_dir_deg * pi/180)
      v = wind_speed * sin(wind_dir_deg * pi/180)

The linear combination (b_u * u + b_v * v) is mathematically
equivalent to a headwind term along an arbitrary direction, i.e.
the regression FINDS the hole's effective wind axis without us
having to look up its compass bearing. The magnitude
sqrt(b_u^2 + b_v^2) then measures how strongly *directional* wind
affects that hole, and atan2(-b_v, -b_u) points at the direction
into which a headwind hurts most (i.e. the play direction).

Reports:
  - per-hole coefficients (yards, headwind axis, headwind magnitude)
  - top harder / easier clusters after refit
  - side-by-side vs v1 (speed-only) for the 11 clusters referenced
    in the article
"""

import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np

REPO_ROOT = Path("C:/Users/tombu/pardle")
BIRDIE_URL = "https://pardle.app/api/course-pin-birdies?tournamentId=R2026525"


def load_birdie_history():
    with urllib.request.urlopen(BIRDIE_URL, timeout=60) as r:
        return json.load(r)


def load_historical(year: int):
    p = REPO_ROOT / "data" / "historical" / f"3m-open-{year}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def build_context():
    """context[year][round] = { yards_by_hole, wind_mph, wind_dir_deg }."""
    ctx: dict = {}
    for y in range(2019, 2026):
        h = load_historical(y)
        if not h:
            continue
        weather = h.get("weatherByRound") or {}
        yards_by_hole_round: dict = {}
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


def fit_hole_model(rows, use_direction=True):
    """Return (params, pred, residuals) for the weighted least-squares fit.
    If use_direction, features are [yards, u, v, 1]; else [yards, wind, 1]."""
    if use_direction:
        X = np.array([
            [row["yards"], row["u"], row["v"], 1]
            for row in rows
        ], dtype=float)
    else:
        X = np.array([
            [row["yards"], row["wind"], 1]
            for row in rows
        ], dtype=float)
    Y = np.array([row["rate"] for row in rows], dtype=float)
    W = np.sqrt(np.array([row["total"] for row in rows], dtype=float))
    Xw = X * W[:, None]
    Yw = Y * W
    params, *_ = np.linalg.lstsq(Xw, Yw, rcond=None)
    pred = X @ params
    residuals = Y - pred
    return params, pred, residuals


def analyze():
    bh = load_birdie_history()
    holes = bh.get("holes", {})
    ctx = build_context()
    findings_v2 = []
    findings_v1 = []
    per_hole_coeffs = {}

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
            wind_dir = year_ctx.get("wind_dir_deg")
            if yards is None or wind is None or wind_dir is None:
                continue
            cluster_idx = None
            for ci, c in enumerate(clusters):
                if i in c.get("memberIndices", []):
                    cluster_idx = ci
                    break
            if cluster_idx is None:
                continue
            rad = wind_dir * math.pi / 180
            rows.append({
                "rate": p["rate"],
                "yards": yards,
                "wind": wind,
                "wind_dir": wind_dir,
                "u": wind * math.cos(rad),
                "v": wind * math.sin(rad),
                "cluster_idx": cluster_idx,
                "total": p["total"],
                "year": y, "round": r,
                "birdies": p["birdies"],
            })
        if len(rows) < 8:
            continue

        # v1: speed-only
        try:
            params_v1, _, resid_v1 = fit_hole_model(rows, use_direction=False)
        except np.linalg.LinAlgError:
            continue
        # v2: with u,v
        try:
            params_v2, _, resid_v2 = fit_hole_model(rows, use_direction=True)
        except np.linalg.LinAlgError:
            continue

        b_y_v2, b_u, b_v, intercept_v2 = params_v2
        b_y_v1, b_w, intercept_v1 = params_v1
        per_hole_coeffs[hole] = {
            "v1": {"b_y": b_y_v1, "b_w": b_w},
            "v2": {"b_y": b_y_v2, "b_u": b_u, "b_v": b_v,
                   "b_head_mag": math.hypot(b_u, b_v),
                   "play_dir_deg": (math.degrees(math.atan2(-b_v, -b_u)) + 360) % 360},
        }

        # Aggregate residuals per cluster for v2 AND v1
        for label, resid in [("v1", resid_v1), ("v2", resid_v2)]:
            cluster_agg = {}
            for row, res in zip(rows, resid):
                ci = row["cluster_idx"]
                entry = cluster_agg.setdefault(ci, {
                    "birdies": 0, "total": 0, "r_sum": 0, "r_w": 0,
                })
                entry["birdies"] += row["birdies"]
                entry["total"]   += row["total"]
                entry["r_sum"]   += res * row["total"]
                entry["r_w"]     += row["total"]
            for ci, agg in cluster_agg.items():
                if agg["r_w"] < 60:
                    continue
                cluster = clusters[ci]
                mean_resid = agg["r_sum"] / agg["r_w"]
                observed = agg["birdies"] / agg["total"]
                expected = observed - mean_resid
                item = {
                    "hole": hole, "cluster": cluster_letter(ci),
                    "observed_rate": observed, "expected_rate": expected,
                    "residual": mean_resid, "total": agg["total"],
                    "pin_count": cluster.get("pinCount", 0),
                }
                if label == "v1":
                    findings_v1.append(item)
                else:
                    findings_v2.append(item)

    return findings_v1, findings_v2, per_hole_coeffs


def main():
    v1, v2, coeffs = analyze()
    if not v2:
        print("No findings")
        return

    v2.sort(key=lambda f: f["residual"], reverse=True)
    v1_map = {(f["hole"], f["cluster"]): f for f in v1}

    print("=" * 96)
    print("V2 MODEL (yards + wind direction) — HARDER-THAN-EXPECTED CLUSTERS")
    print("=" * 96)
    print(f'{"Hole":>4}  {"Clust":>5}  {"Obs":>6}  {"Exp":>6}  {"v2 D":>7}  {"v1 D":>7}  {"Sample":>6}  {"Pins":>4}')
    print("-" * 96)
    for f in v2[-10:][::-1]:
        v1f = v1_map.get((f["hole"], f["cluster"]))
        v1d = f'{v1f["residual"]*100:+.1f}pp' if v1f else "n/a"
        print(f"{f['hole']:>4}  {f['cluster']:>5}  {f['observed_rate']*100:>5.1f}%  {f['expected_rate']*100:>5.1f}%  {f['residual']*100:>+6.1f}pp  {v1d:>7}  {f['total']:>6d}  {f['pin_count']:>4d}")

    print()
    print("=" * 96)
    print("V2 MODEL — EASIER-THAN-EXPECTED CLUSTERS")
    print("=" * 96)
    print(f'{"Hole":>4}  {"Clust":>5}  {"Obs":>6}  {"Exp":>6}  {"v2 D":>7}  {"v1 D":>7}  {"Sample":>6}  {"Pins":>4}')
    print("-" * 96)
    for f in v2[:10]:
        v1f = v1_map.get((f["hole"], f["cluster"]))
        v1d = f'{v1f["residual"]*100:+.1f}pp' if v1f else "n/a"
        print(f"{f['hole']:>4}  {f['cluster']:>5}  {f['observed_rate']*100:>5.1f}%  {f['expected_rate']*100:>5.1f}%  {f['residual']*100:>+6.1f}pp  {v1d:>7}  {f['total']:>6d}  {f['pin_count']:>4d}")

    # For each referenced cluster in the article, show v1 vs v2 side by side
    ARTICLE_CLUSTERS = [
        (12, "D"), (2, "C"), (18, "D"), (10, "B"), (9, "D"),
        (2, "D"), (12, "A"), (17, "D"), (10, "F"), (13, "D"), (18, "B"),
    ]
    print()
    print("=" * 96)
    print("SIDE-BY-SIDE — CLUSTERS FEATURED IN THE ARTICLE")
    print("=" * 96)
    v2_map = {(f["hole"], f["cluster"]): f for f in v2}
    print(f'{"Hole":>4}  {"Clust":>5}  {"v1 D":>7}  {"v2 D":>7}  {"shift":>7}  {"note":>26}')
    print("-" * 96)
    for hole, letter in ARTICLE_CLUSTERS:
        v1f = v1_map.get((hole, letter))
        v2f = v2_map.get((hole, letter))
        if not v1f or not v2f:
            continue
        v1d = v1f["residual"] * 100
        v2d = v2f["residual"] * 100
        shift = v2d - v1d
        # Sign change?
        note = ""
        if abs(v2d) < 1.5 and abs(v1d) >= 1.5:
            note = "signal weakened to noise"
        elif v1d * v2d < 0 and abs(v2d) >= 1.5:
            note = "sign FLIPPED"
        elif abs(shift) >= 2:
            note = "material shift"
        print(f'H{hole:>3}  {letter:>5}  {v1d:>+6.1f}pp  {v2d:>+6.1f}pp  {shift:>+6.1f}pp  {note:>26}')

    # Per-hole coefficient summary — how strong is the directional effect?
    print()
    print("=" * 96)
    print("PER-HOLE COEFFICIENTS (v2)")
    print("=" * 96)
    print(f'{"Hole":>4}  {"b_yards (pp/10yd)":>18}  {"b_head (pp/5mph)":>18}  {"headwind axis (bearing°)":>25}')
    print("-" * 96)
    for h in sorted(coeffs):
        c = coeffs[h]["v2"]
        by = c["b_y"] * 10 * 100
        # Convert headwind-magnitude to pp per 5mph "on the axis"
        bh = c["b_head_mag"] * 5 * 100
        play_dir = c["play_dir_deg"]
        print(f'H{h:>3}  {by:>+13.2f}pp/10yd  {bh:>+13.2f}pp/5mph  {play_dir:>18.0f}°')


if __name__ == "__main__":
    main()
