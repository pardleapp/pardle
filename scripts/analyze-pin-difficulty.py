"""
scripts/analyze-pin-difficulty.py

For every pin position at the 3M Open (2019-2025), compare its
observed birdie rate against what we'd expect given the round's
yardage and wind. Cluster residuals — pins that share a location
across years — surface locations that are systematically harder or
easier than conditions can explain.

Model per hole:
    birdie_rate  =  intercept + β_yards · yards + β_wind · windAvgMph

Fit via ordinary least squares on the pin observations that also
have (year, round) yardage + wind data on file. Ridge if the OLS is
degenerate. Compute residual per pin. Aggregate residuals by
cluster (from the birdie-history endpoint). Report top clusters by
absolute residual weighted by putt count.

Inputs:
  - https://pardle.app/api/course-pin-birdies?tournamentId=R2026525
  - data/historical/3m-open-{year}.json  (weatherByRound + yards)

Output:
  - stdout report of top-N surprisingly-easy and surprisingly-hard
    pin clusters, per hole
"""
import json
import re
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
    """Return context[year][round] = { yards_by_hole, wind_mph }.
    Yards keyed by hole → per-round yardage from every player who has
    a value on file; wind is the round-level windAvgMph."""
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
            w = (weather.get(str(r)) or {}).get("windAvgMph")
            ctx.setdefault(y, {})[r] = {
                "wind": float(w) if isinstance(w, (int, float)) else None,
                "yards_by_hole": yards_by_hole_round.get(r, {}),
            }
    return ctx


def cluster_letter(i: int) -> str:
    return chr(65 + i) if i < 26 else f"AA{i}"


def analyze():
    bh = load_birdie_history()
    holes = bh.get("holes", {})
    ctx = build_context()
    findings = []
    for hole_str, data in holes.items():
        hole = int(hole_str)
        pins = data.get("pins", [])
        clusters = data.get("clusters", [])
        if not pins or not clusters:
            continue

        # Assemble (rate, yards, wind, cluster_idx, weight) per pin
        rows = []
        for i, p in enumerate(pins):
            y, r = int(p["year"]), int(p["round"])
            year_ctx = ctx.get(y, {}).get(r, {})
            yards = year_ctx.get("yards_by_hole", {}).get(hole)
            wind = year_ctx.get("wind")
            if yards is None or wind is None:
                continue
            # Which cluster does this pin belong to?
            cluster_idx = None
            for ci, c in enumerate(clusters):
                if i in c.get("memberIndices", []):
                    cluster_idx = ci
                    break
            if cluster_idx is None:
                continue
            rows.append({
                "rate": p["rate"],
                "yards": yards,
                "wind": wind,
                "cluster_idx": cluster_idx,
                "total": p["total"],
                "year": y,
                "round": r,
                "birdies": p["birdies"],
            })
        if len(rows) < 6:
            continue

        # Fit OLS on birdie_rate ~ yards + wind (weighted by sqrt(total))
        X = np.array([[row["yards"], row["wind"], 1] for row in rows], dtype=float)
        Y = np.array([row["rate"] for row in rows], dtype=float)
        W = np.sqrt(np.array([row["total"] for row in rows], dtype=float))
        # Weighted regression via scaled OLS
        Xw = X * W[:, None]
        Yw = Y * W
        try:
            params, *_ = np.linalg.lstsq(Xw, Yw, rcond=None)
        except np.linalg.LinAlgError:
            continue
        beta_yards, beta_wind, intercept = params
        pred = X @ params
        residuals = Y - pred

        # Aggregate by cluster
        cluster_agg = {}
        for row, resid in zip(rows, residuals):
            ci = row["cluster_idx"]
            entry = cluster_agg.setdefault(ci, {"birdies": 0, "total": 0, "residual_sum": 0, "residual_weight": 0, "rows": []})
            entry["birdies"] += row["birdies"]
            entry["total"] += row["total"]
            entry["residual_sum"] += resid * row["total"]
            entry["residual_weight"] += row["total"]
            entry["rows"].append((row, resid))

        for ci, agg in cluster_agg.items():
            if agg["residual_weight"] < 60:  # need at least 60 putts of exposure
                continue
            cluster = clusters[ci]
            mean_resid = agg["residual_sum"] / agg["residual_weight"]
            observed_rate = agg["birdies"] / agg["total"]
            expected_rate = observed_rate - mean_resid
            findings.append({
                "hole": hole,
                "cluster": cluster_letter(ci),
                "cluster_id": cluster.get("clusterId"),
                "observed_rate": observed_rate,
                "expected_rate": expected_rate,
                "residual": mean_resid,
                "pin_count": cluster.get("pinCount", 0),
                "total": agg["total"],
                "birdies": agg["birdies"],
                "beta_yards": beta_yards,
                "beta_wind": beta_wind,
                "sample_rows": agg["rows"][:4],
            })
    return findings


def main():
    findings = analyze()
    if not findings:
        print("No findings — no clusters had enough sample.")
        sys.exit(0)

    # Rank by absolute residual weighted by exposure so tiny-sample
    # extremes don't dominate.
    findings.sort(key=lambda f: f["residual"], reverse=True)

    print("=" * 84)
    print("HARDER-THAN-EXPECTED PIN CLUSTERS (after adjusting for hole length + wind)")
    print("=" * 84)
    print(f'{"Hole":>4}  {"Cluster":>7}  {"Observed":>8}  {"Expected":>8}  {"Delta":>7}  {"Sample":>6}  {"Pins":>4}')
    print("-" * 84)
    for f in findings[-10:][::-1]:
        print(
            f"{f['hole']:>4}  {f['cluster']:>7}  "
            f"{f['observed_rate']*100:>7.1f}%  "
            f"{f['expected_rate']*100:>7.1f}%  "
            f"{f['residual']*100:>+6.1f}pp  "
            f"{f['total']:>6d}  "
            f"{f['pin_count']:>4d}"
        )

    print()
    print("=" * 84)
    print("EASIER-THAN-EXPECTED PIN CLUSTERS (after adjusting for hole length + wind)")
    print("=" * 84)
    print(f'{"Hole":>4}  {"Cluster":>7}  {"Observed":>8}  {"Expected":>8}  {"Delta":>7}  {"Sample":>6}  {"Pins":>4}')
    print("-" * 84)
    for f in findings[:10]:
        print(
            f"{f['hole']:>4}  {f['cluster']:>7}  "
            f"{f['observed_rate']*100:>7.1f}%  "
            f"{f['expected_rate']*100:>7.1f}%  "
            f"{f['residual']*100:>+6.1f}pp  "
            f"{f['total']:>6d}  "
            f"{f['pin_count']:>4d}"
        )

    # Also print regression coefficients per hole so we can sanity-check
    # which effects were strongest.
    print()
    print("=" * 84)
    print("REGRESSION COEFFICIENTS (per hole, per unit)")
    print("=" * 84)
    per_hole = {}
    for f in findings:
        per_hole.setdefault(f["hole"], (f["beta_yards"], f["beta_wind"]))
    print(f'{"Hole":>4}  {"b_yards":>12}  {"b_wind":>12}  ')
    print("-" * 40)
    for h in sorted(per_hole):
        by, bw = per_hole[h]
        # Per +10 yd / per +5 mph swings for interpretability
        print(
            f"{h:>4}  {by*10*100:>+11.2f}pp/10yd  {bw*5*100:>+11.2f}pp/5mph"
        )


if __name__ == "__main__":
    main()
