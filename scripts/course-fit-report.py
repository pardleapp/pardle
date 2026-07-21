"""
scripts/course-fit-report.py

Two-part report:
  A. Which courses have the strongest shape-fit signal? (from sweep-course-fit.py output)
  B. For the 3M Open, which of the actual 144-player field is projected
     to over/under-perform their driving baseline at TPC Twin Cities?

Assumes both upstream artifacts exist:
  - scratchpad/course-sweep.csv          (from scripts/sweep-course-fit.py)
  - scratchpad/course-fit-3m-open.csv    (from scripts/predict-course-fit.py)
  - scratchpad/3m-field.json             (from orchestrator leaderboardV2 curl)
"""
import json
import re
import unicodedata
import pandas as pd

SCRATCH = "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad"

def norm(s):
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[̀-ͯ]", "", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return s

# ── A. Strongest-signal courses ─────────────────────────────────────
sweep = pd.read_csv(f"{SCRATCH}/course-sweep.csv")
top = sweep.sort_values("r2_cv", ascending=False).head(10).copy()

def label(row):
    parts = []
    b = row["β_ballSpeed"]
    a = row["β_apexHeight"]
    c = row["β_curve"]
    if b >= 0.10:
        parts.append("rewards bombers")
    elif b <= -0.07:
        parts.append("rewards short/positional")
    if a >= 0.06:
        parts.append("rewards high launch")
    elif a <= -0.06:
        parts.append("rewards low/flat trajectory")
    if c >= 0.05:
        parts.append("rewards fade bias")
    elif c <= -0.05:
        parts.append("rewards draw bias")
    return ", ".join(parts) if parts else "weak/mixed"

top["reads_as"] = top.apply(label, axis=1)

print("=" * 84)
print("A. STRONGEST SHAPE-FIT COURSES (out-of-sample CV R²)")
print("=" * 84)
print(f"{'course':<44}{'R²_cv':>8}{'β_bspd':>9}{'β_apex':>8}{'β_curv':>8}  reads_as")
print("-" * 96)
for _, r in top.iterrows():
    print(
        f"  {r['tournament'][:42]:<42}"
        f"{r['r2_cv']:>+8.3f}{r['β_ballSpeed']:>+9.3f}"
        f"{r['β_apexHeight']:>+8.3f}{r['β_curve']:>+8.3f}"
        f"  {r['reads_as']}"
    )

# ── B. 3M Open picks — filtered to actual field ─────────────────────
field_raw = json.load(open(f"{SCRATCH}/3m-field.json"))
field_names = [
    p["player"]["displayName"]
    for p in field_raw["data"]["leaderboardV2"]["players"]
    if p and p.get("player")
]
field_norm = set(norm(n) for n in field_names)

pred = pd.read_csv(f"{SCRATCH}/course-fit-3m-open.csv")
pred["normName"] = pred["name"].apply(norm)
pred_field = pred[pred["normName"].isin(field_norm)].copy()
missing = field_norm - set(pred["normName"])

print(f"\n\n" + "=" * 84)
print(f"B. 3M OPEN — 4-round course-fit projection (144-player field)")
print("=" * 84)
print(
    f"Field size: {len(field_names)}   ·   In our radar-profile dataset: "
    f"{len(pred_field)}   ·   Missing: {len(missing)}"
)
print(
    "\nNote: model reads TPC Twin Cities as a mild positional course "
    "(β_bspd = −0.11); overall CV R² at this course is only ~0.005, "
    "so these picks carry LOW conviction. Historical actuals shown "
    "where available (`n` = rounds, `actual` = residual)."
)

ranked = pred_field.sort_values("pred_residual_per_round", ascending=False)

def fmt(row):
    hist = ""
    if pd.notna(row.get("n_hist_rounds")):
        hist = f"  ({int(row['n_hist_rounds'])} rd, act {row['actual_resid_at_course']:+.2f})"
    return (
        f"  {row['name']:<26}"
        f"{row['pred_residual_per_round']:+7.2f}"
        f"{row['pred_residual_4rd']:+7.2f}"
        f"{hist}"
    )

print(f"\nTOP 20 in-field — projected to OVER-PERFORM their driving baseline")
print(f"{'player':<28}{'per rd':>7}{'4-rd':>7}   (history)")
for _, r in ranked.head(20).iterrows():
    print(fmt(r))

print(f"\nBOTTOM 20 in-field — projected to UNDER-PERFORM their driving baseline")
print(f"{'player':<28}{'per rd':>7}{'4-rd':>7}   (history)")
for _, r in ranked.tail(20).iloc[::-1].iterrows():
    print(fmt(r))

OUT = f"{SCRATCH}/3m-open-picks.csv"
ranked[["name", "pred_residual_per_round", "pred_residual_4rd",
        "n_hist_rounds", "actual_resid_at_course"]].to_csv(OUT, index=False)
print(f"\nFull ranked table for the 144-player field → {OUT}")
