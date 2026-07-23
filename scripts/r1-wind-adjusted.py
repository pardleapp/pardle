"""
scripts/r1-wind-adjusted.py

Combine three signals into a per-hole R1 verdict:
  1. Pin residual — the cluster's intrinsic under/over-performance vs
     the yardage-and-directional-wind regression (already computed in
     r1-residuals.py).
  2. Wind delta — today's actual headwind on each hole, weighted by
     the hole's b_head coefficient from v3, minus an "average" wind
     baseline (approx 0 since headwind averages ~0 across the
     historical sample of varied wind directions).
  3. Yardage delta — today's R1 yardage vs the historical mean for
     that hole, weighted by b_yards.

Wind snapshot: mean over 7am-7pm local (round-1 play window), pulled
from Open-Meteo for TPC Twin Cities coords.

Output: per-hole net delta (pp above/below the field's normal birdie
rate), plus a ranked "watch list" of holes that are meaningfully
easier or harder today.
"""

import json
import math
from pathlib import Path

REPO_ROOT = Path("C:/Users/tombu/pardle")
SCRATCH = Path(
    "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/"
    "5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad"
)

HOLE_BEARING = {
    1: 283, 2: 354, 3: 114, 4: 73, 5: 74, 6: 289, 7: 214, 8: 310,
    9: 149, 10: 167, 11: 175, 12: 336, 13: 140, 14: 54, 15: 14,
    16: 204, 17: 261, 18: 318,
}

# Per-hole v3 coefficients (from r1-residuals.py fit — b_yards in
# pp per yard, b_head in pp per mph of headwind).
COEFFS = {
    1:  (-0.058, -0.300),  2:  (+0.012, -0.588),  3:  (-0.174, -0.370),
    4:  (-0.281, +0.114),  5:  (-0.111, +0.088),  6:  (-0.139, -0.848),
    7:  (-0.302, -0.592),  8:  (-0.198, -0.476),  9:  (-0.157, -0.406),
    10: (-0.213, -0.164),  11: (-0.005, -0.368),  12: (-0.212, -0.828),
    13: (-0.025, -0.212),  14: (-0.102, -0.118),  15: (+0.145, -0.408),
    16: (-0.399, -0.496),  17: (-0.053, -0.194),  18: (+0.263, -0.570),
}

# Pin residuals per hole (from r1-residuals.py output — anchored to
# the cluster the R1 pin sits on).
PIN_RESIDUALS = {
    1: -0.5, 2: -0.7, 3: +2.0, 4: +1.0, 5: +6.0,
    6: -2.6, 7: -1.4, 8: -1.4, 9: +3.2, 10: +1.9,
    11: +2.0, 12: +5.5, 13: None, 14: +0.8, 15: +1.5,
    16: +0.9, 17: -1.2, 18: -1.4,
}

R1_INPUTS = json.load(open(SCRATCH / "r1-inputs.json"))
YARDS_TODAY = {int(k): v for k, v in R1_INPUTS["yards"].items()}


def load_wind_avg():
    """Return vector-averaged wind for 7am-7pm local."""
    d = json.load(open(SCRATCH / "wind-2026-r1.json"))
    h = d["hourly"]
    times = h["time"]
    ws = h["wind_speed_10m"]
    wd = h["wind_direction_10m"]
    # Grab hours 7..19 inclusive (index by hour in the local time string)
    u_sum = 0.0
    v_sum = 0.0
    n = 0
    for i, t in enumerate(times):
        hour = int(t.split("T")[1].split(":")[0])
        if 7 <= hour <= 19:
            rad = wd[i] * math.pi / 180
            u_sum += ws[i] * math.cos(rad)
            v_sum += ws[i] * math.sin(rad)
            n += 1
    u = u_sum / n
    v = v_sum / n
    speed = math.hypot(u, v)
    dir_deg = (math.degrees(math.atan2(v, u)) + 360) % 360
    return speed, dir_deg


def load_historical_yardage_mean():
    """Mean yardage per hole across 2019-2025 R1-R4 for the yardage
    delta baseline."""
    means = {}
    for y in range(2019, 2026):
        p = REPO_ROOT / "data" / "historical" / f"3m-open-{y}.json"
        if not p.exists():
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        by_hole = {}
        for player in d.get("players", []):
            for rstr, rd in (player.get("rounds") or {}).items():
                for hstr, hole in (rd.get("holes") or {}).items():
                    if hole and isinstance(hole.get("yards"), (int, float)):
                        by_hole.setdefault(int(hstr), []).append(hole["yards"])
        for h, vs in by_hole.items():
            means.setdefault(h, []).extend(vs)
    return {h: sum(vs) / len(vs) for h, vs in means.items()}


def main():
    speed, dir_deg = load_wind_avg()
    print(f"R1 wind (avg 7am-7pm local): {speed:.1f} mph from {dir_deg:.0f}°")
    yards_mean = load_historical_yardage_mean()

    print()
    print(f"{'Hole':>4}  {'Par':>3}  {'Yds':>4}  {'Bear':>5}  {'Headwd':>7}  "
          f"{'Pin':>7}  {'Wind D':>7}  {'Yds D':>7}  {'Total':>7}  {'Verdict':>10}")
    print("-" * 82)
    verdicts = []
    for hole in range(1, 19):
        yards = YARDS_TODAY[hole]
        bear = HOLE_BEARING[hole]
        headwind = speed * math.cos((dir_deg - bear) * math.pi / 180)
        b_y, b_h = COEFFS[hole]
        # b_h is already pp per mph (converted from earlier pp/5mph)
        pin_res = PIN_RESIDUALS.get(hole)
        # Wind D = today's headwind × b_head, in pp. Assume historical
        # avg headwind ≈ 0 (crosswinds average out over many rounds).
        wind_delta = b_h * headwind
        # Yardage D vs historical mean, weighted by b_yards.
        y_delta = b_y * (yards - yards_mean.get(hole, yards))
        if pin_res is None:
            total = None
            verdict = "H13 pin?"
        else:
            total = pin_res + wind_delta + y_delta
            if total >= 3:
                verdict = "EASIER"
            elif total <= -3:
                verdict = "HARDER"
            elif abs(total) < 1.5:
                verdict = "neutral"
            else:
                verdict = ("mild +" if total > 0 else "mild -")
        pin_txt = f"{pin_res:+.1f}pp" if pin_res is not None else "  ?"
        total_txt = f"{total:+.1f}pp" if total is not None else "  ?"
        print(f"H{hole:>3}  {bear:>5.0f}°  {headwind:+6.1f}mph  {pin_txt:>7}  "
              f"{wind_delta:+6.1f}pp  {y_delta:+6.1f}pp  {total_txt:>7}  {verdict:>10}"
              .replace(f"{bear:>5.0f}°", f"{bear:>4.0f}°", 1))
        verdicts.append((hole, total, verdict))

    print()
    print("EASIER (rank order):")
    for h, t, v in sorted(
        [x for x in verdicts if x[1] is not None and x[1] > 0],
        key=lambda x: -x[1],
    )[:6]:
        print(f"  H{h}: {t:+.1f}pp  {v}")
    print()
    print("HARDER (rank order):")
    for h, t, v in sorted(
        [x for x in verdicts if x[1] is not None and x[1] < 0],
        key=lambda x: x[1],
    )[:6]:
        print(f"  H{h}: {t:+.1f}pp  {v}")


if __name__ == "__main__":
    main()
