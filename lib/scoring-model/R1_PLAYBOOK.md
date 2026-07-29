# Round 1 forecast playbook

R1 is the round with the least information: no in-tournament data
(no prior-round observations), so the forecast leans entirely on
historical patterns from previous years at the venue, adjusted for
today's conditions (weather, pin sheet, yardage).

## What R1 uses

- **`historicalRoundMean[1]`** — average R1 score across every past
  edition of the tournament at this course. This is the anchor.
  For Detroit GC / Rocket Classic across 2019-2025 it's 70.18.

- **Per-hole pin-cluster fit** — a WLS regression on
  `avgVsPar ~ yards + headwind + intercept` fit against every pin
  position × round × year of history at the venue. This tells you
  which parts of each green scored what, adjusted for how long the
  hole was playing and what the wind was doing.

- **Today's inputs the model applies on top:**
  - **Yardage per hole** — today's tee positions if the pin sheet
    is available; otherwise the historical mean yardage per hole.
  - **Pin position** — today's actual pin (if we have it) is matched
    to a historical cluster and that cluster's residual is added.
    Missing → uses the auto-matched historical average residual.
  - **Wind** — HRRR hourly wind (fine grid, next-24h), Open-Meteo
    daily average, or a manual override. Applied through the fit's
    `bHead` coefficient. Requires hole bearings; missing bearings
    → wind term is neutralised and a warning is added.

- **Level shift** — attenuates the field mean using the actual
  prior rounds' scoring. For R1 this is 0 (no priors exist yet).

## Steps before the round

1. **Confirm the tournament is onboarded.** Hit
   `/api/scoring-model/forecast` with `{tournamentId, targetRound: 1}`.
   If you get `newVenue: true`, run the fetch script (see
   `ONBOARDING.md`).

2. **Populate the live round-dates.** In `data/historical/
   _live-tournaments.json`, add or update this week's entry with
   the actual R1-R4 dates:

   ```json
   "rocket-classic": {
     "tournamentId": "R2026524",
     "roundDates": {
       "1": "2026-07-30",
       "2": "2026-07-31",
       "3": "2026-08-01",
       "4": "2026-08-02"
     }
   }
   ```

   The dates drive the wind archive lookup — without them the model
   uses today's UTC date as an approximation. Fine for R1 tomorrow,
   drifts over the week.

3. **Verify the model is fitting.** Response should show
   `ok: true`, `holes: [18 entries]`, `historicalRoundMean` between
   ~68 and ~72, and `fieldForecast` within ~1 stroke of the
   historical mean when there's no unusual wind or pin adjustment.

4. **Read the diagnostic fields:**

   | Field | Meaning |
   |---|---|
   | `historicalRoundMean` | The pre-adjustment R1 baseline. |
   | `modelDelta` | Sum of per-hole (avgVsPar − historical avgVsPar). Wind + pin + yardage effects rolled up. |
   | `fieldForecast` | Final field-mean R1 score. |
   | `fieldForecastVsPar` | Same, vs course par. |
   | `fieldForecastSigma` | One-σ spread of the field-round distribution. |
   | `warnings` | E.g. "Wind adjustment is off — bearings not populated". Fill in bearings when present. |

## Interpretation shortcuts

- **`fieldForecast ≈ historicalMean`** → conditions look average.
  Expect the field to score in line with past R1s.

- **`fieldForecast < historicalMean − 1.0`** → easier day. Weak
  wind, benign pins, and/or shorter yardage. Expect a low-scoring
  first round; skew toward under bets on winning-score markets.

- **`fieldForecast > historicalMean + 1.0`** → harder day. Strong
  wind or nasty pin locations. Expect a scattered first round;
  skew toward over bets on round-score markets and short players
  who scramble well.

## Common gotchas

- **Wind off = flat forecast.** When `holeBearings` is `{}`, the
  wind term collapses and the forecast is just yardage + pin +
  historical mean. Still runs — just less accurate on windy days.
  Fill in bearings to fix.

- **Pin sheet unavailable.** If today's pins aren't in the
  orchestrator yet (usually the case before the pro-am wraps),
  the projector matches against historical cluster centroids
  instead. Slightly less accurate; usually within 0.5 strokes.

- **`levelShiftPerRound` empty on R1.** Expected. No prior rounds
  exist. The `levelShiftMode` defaults to `"average"` which is
  a no-op with an empty priorRounds map.

## Per-player R1 projection

When you supply `players[]` in the POST body, each player gets an
individual R1 forecast that layers:

1. Their **DataGolf skill baseline** (pre-tournament) → converts to
   an expected mean SG total.
2. Their **recent-week SG breakdown** (`weekRoundsSg`) → weighted
   by category (SG:OTT persists more than SG:PUTT), controlled by
   the `formWeight` slider.
3. **Compression factor** — regresses the projection toward the
   field mean. Higher = more regression, more chalk. Default 0.7.
4. **Skew adjustment** — nudges the mean based on recent form
   direction (surging vs cooling).

Output per player:
- `expectedRoundScore` — median R1 forecast
- `winProbability` — probability of shooting under a threshold
- `topFinishProbabilities` — top-5 / top-10 / top-20 tail probs

For R1, tee-time-hourly wind (`useHrrr: true` + player's known tee
time) shifts the wind each player sees along their round — early
tee times face different weather than late ones. Non-trivial in
the Rocket Classic case because Detroit summers can build gust
through the afternoon.

## Where to look when something's off

| Symptom | Likely cause | Fix |
|---|---|---|
| `newVenue: true` | No historicals on disk | Run fetch script |
| `holes: []` in response | Model can't fit — usually a headwind/yards multicollinearity | Should auto-fall-back to yards-only fit. If not, check historical file weather completeness. |
| `fieldForecast == par` (very round number) | Fit degenerate | Same as above |
| `wind.source: "default-zero"` | No round-date match, no HRRR | Add `roundDates` to `_live-tournaments.json` |
| Wind adjustment warning | `holeBearings: {}` in meta | Fill in bearings from OSM |
