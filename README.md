# Pardle

A social, interactive sports betting experience. Bettors record their picks, follow a real-time community feed, and watch their bets progress live as games unfold.

Inspired by [Real](https://real.video) — but for sports betting instead of sports highlights.

Live at [pardle.app](https://pardle.app).

---

## Vision

Bet tracking apps today are spreadsheets with an app skin. Sports-feed apps are passive. Pardle is the bit in between: **a place where bettors hang out**. You post your picks, react to other people's, watch the games together, and see your tickets move from pending → won / lost in real time.

The single thing we optimise for: when a meaningful event happens (a shot lands, a goal scores, a price moves), every user on the page sees it before they would have seen it anywhere else.

---

## Core features

### 1. Social-first feed

A fast, scrollable feed of bet activity from the community — picks, wins, losses, streaks, reactions. Twitter-paced cadence, sports-betting subject matter. Reactions, comments, emoji bursts, follow-other-bettors and per-tipster channels are all first-class, not bolted-on.

### 2. Multi-sport support

The platform is sport-agnostic by design. The feed, the bet tracker, the settlement engine, and the social layer all treat the sport as a parameter — not the foundation. We launch with professional golf (the most data-rich sport for a v0, and where we can run sub-15-second feed latency) but the architecture supports football, basketball, tennis, racing, and others as the next phase.

### 3. Bet tracking and real-time progress

Users log their bets — outright winner, top-finish, round-score, winning-score, and others as we add sports — and watch them update live. Live win-probability, live PnL, settled state when the event concludes, and a permanent history with charts that survive tournament rollovers.

### 4. Quick updates

The feed prioritises **speed** and **freshness**. The home page client refreshes every 3 seconds when visible (30 seconds in the background), the server polls upstream data faster than that, and the operator-side IMG Arena daemon ingests shots ~30-60 seconds ahead of the public data feed. New picks, results, and reactions surface immediately.

### 5. Tipster channels

A tipster (anyone who wants to build an audience) creates a public or invite-only page. Followers see the tipster's tips in their feed, get a push when a new tip lands, can one-click-track tips into their own bet tracker, and chat with the rest of the tipster's community alongside the global live feed.

---

## UX principles

- **Mobile-first.** 85% of users are on phones. Every visible change is tested in a phone-sized viewport before shipping. Touch targets ≥ 44px, thumb-reach prioritised, share-sheet integration over copy-buttons.
- **Real-time feel.** Live scores and bet status are baked into the feed, not a separate widget. Settled bets stop polling but stay visible with their final state.
- **Community engagement.** Following other bettors, leaderboards, reactions, and group chat are treated as core features, not afterthoughts.
- **Lightweight interactions.** Posting a pick, reacting to a tip, joining a tipster's chat — all single-tap. No multi-step modals where a one-tap action will do.
- **No half-finished UI in production.** Feature-flagged work-in-progress lives on branches; `main` is always playable.

---

## Tech notes

- **Framework:** Next.js 15 (App Router) + React 19, TypeScript strict mode
- **Auth + DB:** Supabase (magic-link auth + Postgres with RLS)
- **Real-time store + caches:** Upstash Redis (event log, rolling odds buffers, top-finish history, snapshot cache)
- **Hosting:** Vercel — auto-deploy from `main`
- **Push notifications:** web-push library + VAPID keys, service worker at `/sw.js`
- **External data sources:**
  - PGA Tour orchestrator GraphQL (leaderboard, scorecards, shot-by-shot play)
  - Polymarket (outright winner market prices)
  - DataGolf (skill ratings + in-play top-X calibration anchor)
  - The Odds API (DraftKings + FanDuel reference odds)
  - IMG Arena scoreboard (via an operator-local Chrome CDP scrape — the fast path; sub-15-second shot freshness)

---

## Repo layout

```
app/
  page.tsx                 Live feed homepage
  [slug]/                  Top-level tipster pages — /@golf-edge etc.
  tipster/                 Tipster hub + create flow
  history/                 Personal bet history with stats + graphs
  games/                   Daily-puzzle hub (heritage product)
  live/                    Bet tracker, bet detail, share, comment, auth
  api/
    feed/                  /api/feed and its supporting crons (poll,
                           notify-poll, img-ingest, img-heartbeat,
                           datagolf-poll, odds-api-poll)
    channels/              Tipster channel CRUD, follow, tips, chat
    bets/                  Bet CRUD, history, settlement, migrate, debug
    admin/                 Operator endpoints (settle-tournament)

lib/
  feed/                    Event store, snapshot diff engine, projections,
                           top-finish model, push notification helpers
  channels/                Tipster channel types + reserved slug validator
  golf-api/                PGA Tour orchestrator client
  notifications/           Web-push wrapper
  supabase/                Auth-aware server + client factories

supabase/
  migrations/              0001 init → latest schema changes

public/
  sw.js                    Service worker for push notifications

design/
  pardle-spec-v1.md        Original daily-puzzle design spec
```

---

## Heritage: the daily-puzzle game

The original Pardle was a six-guess daily golf-attribute game (identify the mystery pro from reveals on country / age / height / majors / wins / OWGR tier). That game still ships at [pardle.app/games](https://pardle.app/games) as a friction-free entry point for the broader audience. The live betting interface is the primary surface during tournament weeks; the daily game keeps users coming back between events.

---

## Local dev

Node is intentionally not the primary dev environment — most iteration happens via Vercel preview deploys against real Supabase + Redis.

```sh
npm install
npm run dev      # http://localhost:3000
npm run build    # full prod build (also catches TS errors)
npm test         # game-logic unit tests (Vitest)
```

Auth and the live feed both require Supabase + Upstash credentials in `.env.local`. Without them, the homepage runs in a degraded "schedule + countdown" mode.
