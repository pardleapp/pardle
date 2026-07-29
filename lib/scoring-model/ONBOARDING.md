# Onboarding a new tournament to the round-score forecast

The scoring model runs off whatever is in `data/historical/`. Adding a tour
week is one command + one commit.

## 1. Run the fetch script

```
node scripts/fetch-tournament-historical.mjs \
  --slug rocket-classic \
  --name "rocket" \
  --venue-name "Detroit Golf Club" \
  --venue-lat 42.4363 \
  --venue-lon -83.1245 \
  --venue-tz "America/Detroit" \
  --live-tournament-id R2026524 \
  --live-round-dates 2026-06-25:1,2026-06-26:2,2026-06-27:3,2026-06-28:4
```

Requires `DATAGOLF_API_KEY` (or `DATAGOLF`) set in `.env.local` or the
shell. Emits:

- `data/historical/{slug}-{year}.json` for every past year on DataGolf
- `data/historical/{slug}-meta.json` with derived `courseHolePars` and
  `coursePar`. `holeBearings` starts empty — add manually below.
- `data/historical/_live-tournaments.json` merged with this slug's
  live-year tournamentId + round dates.

`--years` defaults to every year DataGolf published for the event.
Override with `--years 2019,2020,2021,2022,2023,2024,2025` if you want
to cap the fit.

## 2. Fill in hole bearings

Open `data/historical/{slug}-meta.json`. The `holeBearings` field is
`{}`. Fill it in with the compass direction each hole plays (0-360°,
tee → green). Use OSM to eyeball the fairway line — bearings can't be
derived from pin coords because the pin frame is per-hole rotated.

Example for TPC Twin Cities:

```
"holeBearings": {
  "1": 283, "2": 354, "3": 114, "4": 73, "5": 74, "6": 289, "7": 214,
  "8": 310, "9": 149, "10": 167, "11": 175, "12": 336, "13": 140,
  "14": 54, "15": 14, "16": 204, "17": 261, "18": 318
}
```

The runtime treats missing bearings as no wind correction — the model
still produces round-score forecasts, they just won't reflect
that day's wind. Add bearings when accuracy matters.

## 3. Commit + push

The generated files are the state — no runtime config to bump. Once
the JSONs are in `main`, the forecast route auto-picks them up.

```
git add data/historical/{slug}-*.json data/historical/_live-tournaments.json
git commit -m "Scoring model: onboard {name}"
git push
```

## 4. Verify

Hit `/analysis/score-forecast` and confirm the tool renders the
forecast panel (not the "New venue this week" state) for the live-year
`tournamentId` the field endpoint reports.

## When can we not run the model?

If a venue has never been on the PGA Tour orchestrator (brand-new
host), the fetch script will get zero matches. In that case the
runtime will return `{ ok: false, newVenue: true }` and the UI
renders a "New venue this week — no round-score predictions yet"
panel. The other tools (course-fit, ballstriking) still work.
