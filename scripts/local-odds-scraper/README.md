# pardle-local-odds-scraper

Home Playwright runner. Scrapes **FanDuel / Caesars / BetMGM** round-score O/U markets from a residential IP (your machine, your home internet) and POSTs them into `pardle.app/api/odds-compare/ingest`. Pardle merges them alongside the direct DraftKings / Kalshi / DFS fetchers.

**Why here and not on the server:** those three books use Datadome anti-bot which blocks datacentre IPs. Your home IP + a real Chrome browser is the workaround.

## One-time setup (~15 min)

```powershell
cd C:\Users\tombu\pardle\scripts\local-odds-scraper
npm install
npm run install-browsers
copy .env.example .env
notepad .env         # fill in INGEST_SECRET (see 'Getting the secret' below)
```

### Getting the secret

The scraper needs `INGEST_SECRET` to match `ODDS_INGEST_SECRET` on Vercel. Claude will paste the value when the aggregator ships; you drop it into `.env`.

## Running

```powershell
npm start
```

Terminal shows one line per book per poll, like:

```
[fanduel] scrape ok — 12 quotes (2843ms)
  [ingest] fanduel → accepted=12 rejected=0
[caesars] scrape ok — 8 quotes (3120ms)
  [ingest] caesars → accepted=8 rejected=0
```

Leave it running while you want live prices. Close the terminal to stop.

## Debugging when a book returns 0 quotes

Sportsbook UIs change every couple of months. When a book stops returning quotes, run **headed** so you can see what Chrome sees:

```powershell
$env:HEADLESS="false"; npm start
```

A visible Chrome window opens for each book. Watch for:

* "Region not supported" walls → BetMGM/Caesars are geoblocking your home state; swap the hub URL for a state you're in
* Datadome CAPTCHA → book detected automation; slow the poll (`POLL_INTERVAL_MS=60000`) or accept it's broken until we adjust the fingerprint
* Page loads fine but no round-score section → book hasn't posted markets yet (common before R1 tees off), OR their DOM selectors changed and the parser needs updating in `books/<book>.mjs`

## Auto-start on Windows boot (optional)

Use Task Scheduler:

1. Win + R → `taskschd.msc`
2. Create Basic Task, "Pardle odds scraper"
3. Trigger: "When I log on"
4. Action: Start a program
   * Program: `C:\Program Files\nodejs\node.exe`
   * Arguments: `run.mjs`
   * Start in: `C:\Users\tombu\pardle\scripts\local-odds-scraper`
5. Under Properties → Settings, tick "If the task fails, restart every 1 minute, up to 3 times"

## Turning individual books on/off

Edit `.env`:

```
BOOKS=fanduel                    # only FanDuel
BOOKS=caesars,betmgm             # skip FanDuel
```

## Cost

**Zero ongoing.** Uses your existing hardware + internet. ~2-5% CPU on one core when polling, idle otherwise.

## ToS and personal-account risk

Direct scraping of sportsbook APIs is against every book's ToS. Realistic risk from your home IP with a real Chrome session is low (looks like a normal browsing session at your polling cadence), but not zero.

**Warning:** if you personally bet on any of these books from this same home IP, the book *might* flag your personal account for "unusual API traffic" and limit your bets. If you're a serious personal customer on any of the three, run this from a friend's house, a coffee shop, or don't run that specific book.
