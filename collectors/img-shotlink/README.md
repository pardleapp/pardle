# IMG ShotLink Collector

Headless-Chromium tap on the IMG Arena golf widget (delivered via
DraftKings-hosted iframe, powered by Sportradar's WebSocket feed).
Streams every player's shot lifecycle to Redis so the main Pardle
`/api/feed` pipeline can serve them faster than PGA Tour orchestrator.

## Architecture

```
PGA Tour ShotLink lasers
        │
Sportradar's real-time feed
        │
wss://btec-websocket.services.srarena.io/
        │
   IMG Arena widget (JS + proprietary UTF-16 compression)
        │
   Rendered leaderboard DOM
        │
Headless Chromium (this collector)
        │
  Redis LPUSH feed:events:{tournamentId}
        │
   Pardle /api/feed → users
```

## Data quality

Per-shot data captured from the widget:

- Player name (canonical PGA Tour name from `data-testid="translated-name"`)
- Current hole
- Shot number in hole
- Shot distance (yds)
- Landing surface (Fairway / Rough / Green / Native Area / Bunker / etc.)
- Distance to pin (yds or ft/in on the green)
- Shot phase — **Addressing Ball** (pre-shot) → **Hit Ball** (in-flight) →
  landed → precise distance
- Hole completion (`Ball Holed`)
- Round completion (`Round Complete`)

The **Addressing Ball** state fires _before_ the swing — earlier than
anything TV shows. Powers our "will it drop?" putt polls with a real
head-start.

## Latency (vs orchestrator baseline)

Widget-observed shot → Pardle collector emit: **~200–500 ms**
(DOM render lag inside headless Chromium is the dominant term).
Orchestrator-observed shot → Pardle: **~5–10 s**.

Net gain: **5–9 s per shot**.

## Running locally

```bash
node prototype.mjs --event=1427 --run-ms=120000 --verbose
```

- `--event` — IMG Arena event id for the tournament you want to tap.
  Maintain a mapping to our tournament ids in `tournament-map.json`.
- `--run-ms` — how long to run. `0` (default) means forever.
- `--verbose` — include `ws-frame` timing on every WS message (for
  latency accounting; noisy).

Output is one JSON object per line to stdout — perfect for `| jq` or
piping to a downstream Redis publisher.

## Deployment

Production runs on Fly.io — one Machine per active tournament, spun
up on Thursday morning, auto-stopped after the final round. See
`Dockerfile` and `fly.toml`.

## Selector maintenance

The DOM selectors are validated against the widget's current markup.
If IMG ships a widget update and shots stop flowing, run
`inspect-dom.mjs` to snapshot the new DOM tree and update the
`data-testid` selectors in `prototype.mjs`. Historically a couple of
these per year.

Current selectors (Scottish Open 2026):

| Element | Selector |
|---|---|
| Player row | `[data-testid="leaderboard-entry-v2"]` |
| Player name | `[data-testid="translated-name"]` |
| Current hole | `[data-testid="player-hole"]` |
| Play-by-play | `[data-testid="play-by-play-row"]` |

## Ethics + risk

This is a scraper of a licensed sportsbook widget. See CLAUDE.md
for the ethical position. Path: prove viability → grow to justify
buying the Sportradar / IMG / DataGolf license → swap for the
licensed feed with zero downstream churn (Redis contract stays
identical).
