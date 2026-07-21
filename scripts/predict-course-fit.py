"""
scripts/predict-course-fit.py

Fit a per-course regression of SG:OTT-residual on radar shape and
rank all profiled players by predicted course-fit at a target course.

Similarity dims (signed curve — a big draw is NOT similar to a big fade):
  ballSpeed, apexHeight, curve, launchSpin, verticalLaunchAngle

Model per target course:
    residual ~ β0 + Σ β_dim · z_dim
    OLS, weighted by sqrt(n_rounds_at_course).
Also runs 5-fold CV so out-of-sample R² is reported honestly.

Default target: TPC Twin Cities (course_num=883) — this week's 3M Open.
"""
import json
import re
import unicodedata
import numpy as np
import pandas as pd

PROFILES_PATH = "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad/tee-profiles.json"
ROUNDS_PATH = "C:/Users/tombu/golf-model/data/rounds_cache.parquet"

# Signed curve now — draw and fade are distinct profiles, not the same
# "curvy" cluster. Positive curve = fade (right-bending for a righty),
# negative = draw (left-bending).
DIMS = ["ballSpeed", "apexHeight", "curve"]

MIN_ROUNDS_PER_PLAYER_COURSE = 3
BASELINE_WINDOW = 1                    # ±1 season time-local baseline
BASELINE_MIN_ROUNDS = 8
TARGET_COURSE = 883                    # TPC Twin Cities · 3M Open
TARGET_LABEL = "TPC Twin Cities · 3M Open"


def norm_name(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[̀-ͯ]", "", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def flip_name(s: str) -> str:
    if "," not in s:
        return s
    last, first = [p.strip() for p in s.split(",", 1)]
    return f"{first} {last}"


# ── Profiles ────────────────────────────────────────────────────────
with open(PROFILES_PATH) as f:
    profiles_raw = json.load(f)
rows = []
for p in profiles_raw:
    r = {"normName": p["normName"], "name": p["name"]}
    for d in DIMS:
        r[d] = p["stats"][d]
    rows.append(r)
prof_df = pd.DataFrame(rows).set_index("normName")

pop_mean = prof_df[DIMS].mean()
pop_std = prof_df[DIMS].std()
z_cols = [f"z_{d}" for d in DIMS]
prof_df[z_cols] = (prof_df[DIMS] - pop_mean) / pop_std

print(f"[predict-course-fit] target: {TARGET_LABEL}  (course_num={TARGET_COURSE})")
print(f"[predict-course-fit] similarity dims: {DIMS}")

# ── Rounds cache ────────────────────────────────────────────────────
rc = pd.read_parquet(ROUNDS_PATH)
rc = rc[rc["sg_off_tee"].notna()].copy()
rc["normName"] = rc["player_name"].apply(lambda s: norm_name(flip_name(s)))

# Per (player, season): sum + count. Feeds the ±W-season rolling window.
ps = rc.groupby(["normName", "season"])["sg_off_tee"].agg(["sum", "count"]).reset_index()
ps.columns = ["normName", "season", "season_sum", "season_n"]

# Per (player, tournament) event — atomic unit we residualize.
pt = (
    rc.groupby(
        ["normName", "tournament_id", "tournament_name", "course_num", "season"]
    )["sg_off_tee"]
    .agg(["sum", "count", "mean"])
    .reset_index()
)
pt.columns = ["normName", "tournament_id", "tournament_name", "course_num",
              "season", "event_sum", "event_n", "event_mean"]

W = BASELINE_WINDOW
window_rows = []
for name, g in ps.groupby("normName"):
    smin, smax = int(g["season"].min()), int(g["season"].max())
    idx = pd.RangeIndex(smin - W, smax + W + 1, name="season")
    gg = g.set_index("season").reindex(idx).fillna(0.0)
    win_sum = gg["season_sum"].rolling(2 * W + 1, center=True, min_periods=1).sum()
    win_n = gg["season_n"].rolling(2 * W + 1, center=True, min_periods=1).sum()
    for s in idx:
        window_rows.append((name, int(s), float(win_sum.loc[s]), int(win_n.loc[s])))
win_df = pd.DataFrame(window_rows, columns=["normName", "season", "win_sum", "win_n"])
pt = pt.merge(win_df, on=["normName", "season"], how="left")
pt["baseline_n"] = pt["win_n"] - pt["event_n"]
pt["baseline_sum"] = pt["win_sum"] - pt["event_sum"]
pt["baseline_local"] = np.where(
    pt["baseline_n"] >= BASELINE_MIN_ROUNDS,
    pt["baseline_sum"] / pt["baseline_n"].where(pt["baseline_n"] > 0, 1),
    np.nan,
)
pt = pt.dropna(subset=["baseline_local"]).copy()
pt["event_residual"] = pt["event_mean"] - pt["baseline_local"]
pt["resid_x_n"] = pt["event_residual"] * pt["event_n"]
pt["sg_x_n"] = pt["event_mean"] * pt["event_n"]

pc = (
    pt.groupby(["course_num", "tournament_name", "normName"])
    .agg(n_rounds=("event_n", "sum"),
         resid_num=("resid_x_n", "sum"),
         sg_num=("sg_x_n", "sum"))
    .reset_index()
)
pc["residual"] = pc["resid_num"] / pc["n_rounds"]
pc["mean_sg"] = pc["sg_num"] / pc["n_rounds"]
pc = pc[pc["n_rounds"] >= MIN_ROUNDS_PER_PLAYER_COURSE].copy()

# ── Fit target course ───────────────────────────────────────────────
tgt = pc[pc["course_num"] == TARGET_COURSE].copy()
if tgt.empty:
    raise SystemExit(f"no rounds for course_num={TARGET_COURSE}")
print(f"[predict-course-fit] {len(tgt)} player-cells at target course "
      f"({tgt['n_rounds'].sum():,} rounds)")

# Join to profiles — only qualifying players with a radar profile
fit_df = tgt.set_index("normName").join(prof_df[z_cols + DIMS + ["name"]], how="inner")
print(f"[predict-course-fit] {len(fit_df)} training rows (players with profile AND history)")

X = fit_df[z_cols].values
y = fit_df["residual"].values
w = np.sqrt(fit_df["n_rounds"].values)  # sqrt-n weighting

# Weighted OLS via numpy.linalg.lstsq on rescaled equations
def wls(X, y, w, add_const=True):
    if add_const:
        X = np.column_stack([np.ones(len(X)), X])
    Xw = X * w[:, None]
    yw = y * w
    beta, *_ = np.linalg.lstsq(Xw, yw, rcond=None)
    yhat = X @ beta
    ss_res = ((y - yhat) ** 2 * (w ** 2)).sum()
    ss_tot = ((y - (y * w**2).sum() / (w**2).sum()) ** 2 * (w**2)).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return beta, r2

beta_full, r2_in = wls(X, y, w)
print(f"\nIn-sample weighted R² : {r2_in:.3f}")
print(f"Intercept              : {beta_full[0]:+.3f}")
for i, d in enumerate(DIMS):
    coef = beta_full[i + 1]
    direction = "REWARDS higher" if coef > 0 else "PUNISHES higher"
    print(f"  β({d:>22}) = {coef:+.3f}   →  {direction} {d}")

# 5-fold CV (unweighted split, weighted fit + eval)
rng = np.random.default_rng(42)
idx = np.arange(len(y))
rng.shuffle(idx)
folds = np.array_split(idx, 5)
oof_pred = np.full(len(y), np.nan)
for k in range(5):
    val = folds[k]
    tr = np.concatenate([folds[j] for j in range(5) if j != k])
    beta_k, _ = wls(X[tr], y[tr], w[tr])
    oof_pred[val] = np.column_stack([np.ones(len(val)), X[val]]) @ beta_k
ss_res_oof = ((y - oof_pred) ** 2 * w**2).sum()
ss_tot_oof = ((y - (y * w**2).sum() / (w**2).sum()) ** 2 * w**2).sum()
r2_cv = 1 - ss_res_oof / ss_tot_oof
mae_cv = np.average(np.abs(y - oof_pred), weights=w)
print(f"\n5-fold CV weighted R²  : {r2_cv:.3f}")
print(f"5-fold CV weighted MAE : {mae_cv:.3f} strokes / round")

# ── Predict for every profiled player ───────────────────────────────
all_z = prof_df[z_cols].values
pred = np.column_stack([np.ones(len(all_z)), all_z]) @ beta_full
prof_df["pred_residual_per_round"] = pred
prof_df["pred_residual_4rd"] = pred * 4  # 4-round tournament total

ranked = prof_df.sort_values("pred_residual_per_round", ascending=False)
ranked = ranked[["name"] + DIMS + ["pred_residual_per_round", "pred_residual_4rd"]]

# Also join actual course history so we can flag whether the top-20
# includes players who ALREADY show a positive residual at this course
tgt_hist = tgt.set_index("normName")[["mean_sg", "residual", "n_rounds"]]
ranked = ranked.join(tgt_hist.rename(columns={
    "mean_sg": "actual_sg_at_course",
    "residual": "actual_resid_at_course",
    "n_rounds": "n_hist_rounds",
}))

print("\n" + "=" * 84)
print(f"WHO FITS {TARGET_LABEL}?")
print("=" * 84)
print(f"\nTOP 20 — expected to over-perform their driving baseline:")
print(f"{'player':<26}{'per rd':>8}{'4-rd':>7}   hist: n   actual")
for _, r in ranked.head(20).iterrows():
    hist = ""
    if pd.notna(r["actual_resid_at_course"]):
        hist = f"  {int(r['n_hist_rounds']):>3d}  {r['actual_resid_at_course']:+.2f}"
    print(f"  {r['name']:<24}{r['pred_residual_per_round']:+7.2f}{r['pred_residual_4rd']:+6.2f}{hist}")

print(f"\nBOTTOM 20 — expected to under-perform their driving baseline:")
print(f"{'player':<26}{'per rd':>8}{'4-rd':>7}   hist: n   actual")
for _, r in ranked.tail(20).iloc[::-1].iterrows():
    hist = ""
    if pd.notna(r["actual_resid_at_course"]):
        hist = f"  {int(r['n_hist_rounds']):>3d}  {r['actual_resid_at_course']:+.2f}"
    print(f"  {r['name']:<24}{r['pred_residual_per_round']:+7.2f}{r['pred_residual_4rd']:+6.2f}{hist}")

# Save the ranked table for downstream use
OUT = "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad/course-fit-3m-open.csv"
ranked.to_csv(OUT)
print(f"\nSaved full ranked table to {OUT}")
