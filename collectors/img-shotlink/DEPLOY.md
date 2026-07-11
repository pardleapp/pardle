# IMG ShotLink collector — deployment runbook

## First-time setup

```bash
# Install Fly CLI once
curl -L https://fly.io/install.sh | sh

# Sign in
fly auth login

# From this directory:
cd collectors/img-shotlink

# Create the App (one-time). Says no to Postgres/Redis prompts.
fly launch --no-deploy --name pardle-img-collector

# Set the Upstash secrets (same ones Vercel uses)
fly secrets set \
  UPSTASH_REDIS_REST_URL="https://<your-upstash>.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="<token>"

# Build + push the Docker image (no Machines running yet — Machines
# are per-tournament and spun up in the next step)
fly deploy --no-cache
```

## Adding an IMG event id for a tournament

Every Thursday morning:

1. Open the DraftKings-hosted widget for this week's event to find its
   IMG `eventId` in the URL. Widget URL template:
   `https://draftkings.apps.imgarena.com/golf/6.x/full/?eventId=NNNN&operator=draftkings&…`

2. POST it to the map:

```bash
curl -X POST https://pardle.app/api/admin/img-event-map \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"tournamentId":"R2026034","imgEventId":"1427","tournamentName":"Genesis Scottish Open"}'
```

Verify:

```bash
curl https://pardle.app/api/admin/img-event-map | jq
```

## Starting a collector for the week

```bash
fly machine run . \
  --name scottish-2026 \
  --env TOURNAMENT_ID=R2026034 \
  --env IMG_EVENT_ID=1427 \
  --env TOURNAMENT_NAME="Genesis Scottish Open" \
  --env SHADOW_MODE=true \
  --region lhr
```

That spins up ONE Machine, LHR region, writes IMG events to
`feed:img-events:R2026034` (shadow key — safe, doesn't touch the
live feed).

## Watching it work

Log stream:

```bash
fly logs -a pardle-img-collector
```

Look for `"kind":"heartbeat"` every 10 s and `"kind":"published"`
for every shot event landing in Redis.

## Shadow → primary flip (Sunday evening after R4)

After ≥1 full tournament in shadow, compare the sources:

```bash
curl "https://pardle.app/api/admin/img-shadow-compare?tournamentId=R2026034" | jq
```

Look for:
- `counts.paired` — how many events landed in BOTH sources
- `headStart.medianAhead` — median ms IMG was ahead of orchestrator
- `imgOnlyRecent` — IMG events orchestrator hasn't seen yet

If the numbers justify it (median ahead >2 s and >90% match rate),
promote the running Machine to primary:

```bash
fly machine update <machine-id> \
  --env SHADOW_MODE=false
```

Now the same collector writes to `feed:events:R2026034` — the primary
feed. Users see IMG-sourced shots via the exact same code path.

Rollback: `--env SHADOW_MODE=true` and restart the Machine.

## Ending a tournament

Machines auto-stop 90 min after the last shot (`SHUTDOWN_ON_IDLE_MS`
env), so you rarely need to intervene. Manual stop:

```bash
fly machine stop <machine-id>
```

## When IMG updates the widget (~a couple times per year)

Symptom: `kind: "heartbeat"` shows `totalPublished: 0` for extended
periods during live play.

Fix:
1. Locally: `node inspect-dom.mjs` — dumps the current DOM tree
2. Compare `data-testid` attributes vs the ones in `collector.mjs`
3. Update selectors, `fly deploy --no-cache`, redeploy Machines
4. Historically a 15-minute turnaround.

## Cost

- Idle (no Machines running): $0
- Per running Machine (shared-cpu-1x, 1 GB): ~$2–3/mo
- Realistic: 1 Machine per week for ~40 weeks/yr = **~$80/yr total**
