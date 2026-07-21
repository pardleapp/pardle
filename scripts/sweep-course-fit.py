"""
scripts/sweep-course-fit.py

Fit the per-course radar → SG:OTT-residual regression on EVERY course
with meaningful sample, then rank courses by out-of-sample CV R².

If the model form works, "high signal" venues (Quail Hollow, tough
courses) should self-rank to the top; short/positional bombers'-veto
courses should show the OPPOSITE-signed β on ballSpeed but still get
positive CV R². Low-R² courses = flat weeks where course-fit doesn't
help; high-R² courses = weeks where it does.
"""
import json
import re
import unicodedata
import numpy as np
import pandas as pd

PROFILES_PATH = "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad/tee-profiles.json"
ROUNDS_PATH = "C:/Users/tombu/golf-model/data/rounds_cache.parquet"

DIMS = ["ballSpeed", "apexHeight", "curve"]

MIN_ROUNDS_PER_PLAYER_COURSE = 3
MIN_COURSE_ROUNDS_TOTAL = 1000     # back to full-history minimum
MIN_TRAINING_ROWS = 30
# Time-local baseline: for each event in season S, baseline = mean
# SG:OTT of that player's rounds in seasons [S - WINDOW, S + WINDOW]
# EXCLUDING this event. Handles mid-career driving drift.
BASELINE_WINDOW = 1                # ±1 season
BASELINE_MIN_ROUNDS = 8            # need ≥8 rounds outside event in window


def norm_name(s):
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[̀-ͯ]", "", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return s

def flip_name(s):
    if "," not in s:
        return s
    last, first = [p.strip() for p in s.split(",", 1)]
    return f"{first} {last}"

def wls(X, y, w, add_const=True):
    if add_const:
        X = np.column_stack([np.ones(len(X)), X])
    Xw = X * w[:, None]
    yw = y * w
    beta, *_ = np.linalg.lstsq(Xw, yw, rcond=None)
    yhat = X @ beta
    w2 = w ** 2
    ss_res = ((y - yhat) ** 2 * w2).sum()
    y_mean_w = (y * w2).sum() / w2.sum()
    ss_tot = ((y - y_mean_w) ** 2 * w2).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return beta, r2

# ── Load profiles ────────────────────────────────────────────────
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

# ── Load rounds cache + build (course × player) residual table ──
rc = pd.read_parquet(ROUNDS_PATH)
rc = rc[rc["sg_off_tee"].notna()].copy()
rc["normName"] = rc["player_name"].apply(lambda s: norm_name(flip_name(s)))
print(f"[sweep] all-time rounds with SG:OTT: {len(rc):,}")

# Per (player, season): sum + count. Used to compute rolling ±N-season baseline.
ps = rc.groupby(["normName", "season"])["sg_off_tee"].agg(["sum", "count"]).reset_index()
ps.columns = ["normName", "season", "season_sum", "season_n"]
ps_idx = ps.set_index(["normName", "season"])

# Per (player, tournament) event — this is the atomic unit we residualize.
pt = (
    rc.groupby(
        ["normName", "tournament_id", "tournament_name", "course_num", "season"]
    )["sg_off_tee"]
    .agg(["sum", "count", "mean"])
    .reset_index()
)
pt.columns = [
    "normName", "tournament_id", "tournament_name", "course_num", "season",
    "event_sum", "event_n", "event_mean",
]

# Vectorised time-local baseline. Build a wide per-player table where
# each row is a season and columns are season_sum / season_n. Then a
# rolling ±W-season window becomes a simple pandas rolling().sum().
print(f"[sweep] computing ±{BASELINE_WINDOW}-season time-local baselines "
      f"for {len(pt):,} (player, event) rows…")

W = BASELINE_WINDOW
# Reindex per player to a continuous season range so rolling() sees gaps
# as zeros (not skipped). We iterate players once — fast.
window_rows = []
for name, g in ps.groupby("normName"):
    smin, smax = int(g["season"].min()), int(g["season"].max())
    idx = pd.RangeIndex(smin - W, smax + W + 1, name="season")
    gg = g.set_index("season").reindex(idx).fillna(0.0)
    # window sum/count = sum over [S-W..S+W] inclusive → window size 2W+1
    win_sum = gg["season_sum"].rolling(2 * W + 1, center=True, min_periods=1).sum()
    win_n = gg["season_n"].rolling(2 * W + 1, center=True, min_periods=1).sum()
    for s in idx:
        window_rows.append((name, int(s), float(win_sum.loc[s]), int(win_n.loc[s])))
win_df = pd.DataFrame(
    window_rows, columns=["normName", "season", "win_sum", "win_n"]
).set_index(["normName", "season"])

pt = pt.merge(
    win_df.reset_index(), on=["normName", "season"], how="left"
)
# Subtract this event from the window (leave-one-tournament-out) and
# guard the denominator.
pt["baseline_n"] = pt["win_n"] - pt["event_n"]
pt["baseline_sum"] = pt["win_sum"] - pt["event_sum"]
pt["baseline_local"] = np.where(
    pt["baseline_n"] >= BASELINE_MIN_ROUNDS,
    pt["baseline_sum"] / pt["baseline_n"].where(pt["baseline_n"] > 0, 1),
    np.nan,
)
pt = pt.dropna(subset=["baseline_local"]).copy()
pt["event_residual"] = pt["event_mean"] - pt["baseline_local"]

# Aggregate to (player, course): weighted mean residual across every
# time they played the course; weights are round counts per visit.
pt["resid_x_n"] = pt["event_residual"] * pt["event_n"]
pc = (
    pt.groupby(["course_num", "tournament_name", "normName"])
    .agg(n_rounds=("event_n", "sum"),
         resid_num=("resid_x_n", "sum"))
    .reset_index()
)
pc["residual"] = pc["resid_num"] / pc["n_rounds"]
pc = pc[pc["n_rounds"] >= MIN_ROUNDS_PER_PLAYER_COURSE].copy()
print(f"[sweep] {len(pc):,} (player,course) cells after time-local residualization")

# Course totals for filter
course_totals = rc.groupby("course_num").size()
big_courses = course_totals[course_totals >= MIN_COURSE_ROUNDS_TOTAL].index
pc = pc[pc["course_num"].isin(big_courses)]

# ── Sweep ────────────────────────────────────────────────────────
rng = np.random.default_rng(42)
results = []
for cn, sub in pc.groupby("course_num"):
    tname = sub["tournament_name"].mode().iloc[0]
    j = sub.set_index("normName").join(prof_df[z_cols], how="inner")
    if len(j) < MIN_TRAINING_ROWS:
        continue
    X = j[z_cols].values
    y = j["residual"].values
    w = np.sqrt(j["n_rounds"].values)
    beta_full, r2_in = wls(X, y, w)
    # 5-fold CV
    idx = np.arange(len(y))
    rng.shuffle(idx)
    folds = np.array_split(idx, 5)
    oof = np.full(len(y), np.nan)
    for k in range(5):
        val = folds[k]
        tr = np.concatenate([folds[j2] for j2 in range(5) if j2 != k])
        beta_k, _ = wls(X[tr], y[tr], w[tr])
        oof[val] = np.column_stack([np.ones(len(val)), X[val]]) @ beta_k
    w2 = w ** 2
    ss_res = ((y - oof) ** 2 * w2).sum()
    y_mean_w = (y * w2).sum() / w2.sum()
    ss_tot = ((y - y_mean_w) ** 2 * w2).sum()
    r2_cv = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    rec = {
        "course_num": cn,
        "tournament": tname,
        "n_train": len(j),
        "r2_in": r2_in,
        "r2_cv": r2_cv,
    }
    for i, d in enumerate(DIMS):
        rec[f"β_{d}"] = beta_full[i + 1]
    results.append(rec)

res = pd.DataFrame(results).sort_values("r2_cv", ascending=False)
print(f"Swept {len(res)} courses. Ranked by out-of-sample CV R²:\n")
print(f"{'course':<48}{'n':>5}{'R²_in':>9}{'R²_cv':>9}   "
      f"{'β_bspd':>8}{'β_apex':>8}{'β_curv':>8}")
print("-" * 96)
for _, r in res.iterrows():
    print(
        f"  {r['tournament'][:46]:<46}{int(r['n_train']):>5}"
        f"{r['r2_in']:>+9.3f}{r['r2_cv']:>+9.3f}   "
        f"{r['β_ballSpeed']:>+8.3f}{r['β_apexHeight']:>+8.3f}"
        f"{r['β_curve']:>+8.3f}"
    )

OUT = "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad/course-sweep.csv"
res.to_csv(OUT, index=False)
print(f"\nSaved to {OUT}")

# Summary numbers
n_positive_cv = (res["r2_cv"] > 0).sum()
n_strong = (res["r2_cv"] > 0.05).sum()
n_very_strong = (res["r2_cv"] > 0.10).sum()
print(f"\nCourses with CV R² > 0     : {n_positive_cv} / {len(res)}")
print(f"Courses with CV R² > 0.05  : {n_strong} / {len(res)}")
print(f"Courses with CV R² > 0.10  : {n_very_strong} / {len(res)}")
