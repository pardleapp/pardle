# Pardle

## What Pardle is now

Pardle is a **live bettor's interface for pro golf tournaments**. A bettor opens it during a round, tracks the bets they've placed elsewhere (DraftKings, Polymarket, friends' books), sees the model's current view of each bet's fair value updating in near-real-time, and watches/reacts to the tournament alongside other bettors.

Three things have to be world-class for that to work — every prioritisation call should be weighed against these:

1. **Speed of the feed.** When McIlroy holes out from the fairway, the user must see it on Pardle before they'd have seen it on TV or Twitter. Sub-15-second freshness on shot-level events is the bar. That means tight orchestrator polling, mid-hole `playByPlay` shot detection (not just hole-completion events), no needless caching on the surfacing path. We prioritise "fresh" over "complete" when there's a trade-off.

2. **Speed of the bet tracker.** When a player's odds shift, the user's bet PnL on screen has to move within seconds. This applies to every market we surface — outright (Polymarket), round-score (our model), winning-score (our model), top-X (DraftKings). The bet detail chart must show *today's* trajectory, not just from the moment they entered the bet, so a user who arrives mid-round still gets context.

3. **Social interaction with the feed.** Likes, threaded chat, reactions, polls, communal wins/losses. Without this Pardle is a feed reader; with it, it's a place bettors hang out. Treat betting-adjacent talk ("I need three birdies", "if Scheffler bogeys 17 my parlay's dead") as a first-class use case for comments and threads, not an afterthought.

The Real app is the comparison point — the engagement loop it captures for general sports is what we're building for golf specifically.

## Heritage: the daily Wordle-style game

The original Pardle was a daily golf-attribute guessing game (6 guesses to identify a mystery PGA/LIV/LPGA pro, reveals on country / age / height / majors / wins / decade / OWGR tier). That game still ships at the root and serves as a friction-free entry point — viral on share-card text, draws bettors into the live feed during tournament weeks. Don't tear it out; do let the live interface be the primary surface during live play.

## Audience: mobile-first

**85% of users are on mobile.** Always optimise UI/UX for phone screens first — touch targets (≥44px), thumb reach, portrait layouts, iOS Safari quirks, share-sheet integration. Desktop is a fallback view, not the primary design target. Test every visible change in a phone-sized viewport before declaring it done.

## Current phase: web MVP, iOS deferred

Web-first launch at **pardle.app**. Validate the game is fun with the user + 20+ friends for at least a week before spending $99 on Apple Developer enrollment. Web version stays permanent post-iOS as a friction-free viral entry point.

**Validation gate before any iOS work:**
- 20+ friends play daily for a week
- Solve rate sits between 50–80%
- Share-card text gets posted to group chats organically

## Stack

- **Language:** TypeScript (strict mode)
- **Framework:** Expo (React Native + react-native-web) — same codebase will ship to iOS later via EAS Build without rewrites
- **Hosting:** Vercel (free tier) at pardle.app
- **State:** local only (localStorage / AsyncStorage). No backend in v0.
- **Backend (later):** Supabase (Postgres + Auth) only when we genuinely need cross-device sync, leaderboards, or push.
- **Data:** golfer DB lives as a static JSON in the repo. Sourced from PGA Tour API + Wikipedia.

## Working with the user

The user (Tom) is **non-technical** — does not write code, doesn't know TypeScript/React/Swift/JS. Claude writes all code, designs, and configuration. User's role:
- Approves designs (mocks via screenshots before any styling work)
- Tests builds in iPhone Safari
- Recruits beta testers
- Clicks through external account signups (GitHub, Vercel, Supabase, Apple, Namecheap)

**Never ask the user to "send" credentials via chat.** Secrets live in `.env.local` (gitignored) where Claude Code can read them. User logs into services via browser.

**Avoid unexplained jargon.** When introducing a tool/concept, give a one-line plain-English explanation the first time it appears.

## Coding rules for this project

- **Game logic must be tested.** The attribute-reveal logic is the heart of the game; bugs there break trust. Write unit tests for it.
- **Minimize dependencies.** Every package added is maintenance debt. Default to the platform/standard library. Justify every dependency.
- **No half-finished UI in main branch.** Use feature flags or branches for in-progress work. The deployed pardle.app must always be playable.
- **No comments explaining what code does.** Only comment when the *why* is non-obvious (workarounds, hidden constraints, surprising behavior).
- **No emojis in code or commits** unless the user explicitly asks. (Game share cards are a separate thing — those use emojis by design.)
- **Same-day puzzle determinism.** Today's puzzle must be the same for every user worldwide on the same UTC date. Never random; always derived from `daysSinceEpoch % puzzleCount`.
- **Never mention feed latency, refresh cadence, or "how fast" the feed is in user-facing copy.** No "sub-15s", no "refreshes every 3s", no "within X seconds of the course", no "near real-time" with a number attached. A professional product doesn't advertise its delay budget — exposing seconds to users invites them to find a tournament moment that arrived "too slowly" and lose trust. The speed pillar in this file is for internal prioritisation only. User-facing copy says "Live" / "Live shot-by-shot" / "Real-time" and nothing more specific. Comments and internal docs are fine.
- **Never name third-party data sources in user-facing copy.** No "Polymarket odds", "DataGolf record", "PGA Tour orchestrator", "DraftKings", "FanDuel" anywhere a customer can see them — not in chart placeholders, empty states, footnotes, error messages, tooltips, or share cards. Use generic, customer-friendly language instead: "odds", "historical record", "PGA Tour event archive", "the bookmaker", etc. Pardle is the product; data partners are an implementation detail. Comments / commit messages / CLAUDE.md / dashboards: fine.

## What NOT to do (until validation gate passes)

- Don't add Apple/iOS-specific code paths.
- Don't add a backend (Supabase tables, edge functions, auth) — pure client-side until we need cross-device features.
- Don't add analytics that require a paid tier. PostHog free tier or nothing.
- Don't add ads, IAP, or paywalls.
- Don't add features beyond the core loop (today's puzzle, 6 guesses, reveals, win/lose state, share card, streak counter).

## Domain + deployment

- Domain `pardle.app` registered on Namecheap (purchased 2026-05-09).
- Production deploys from `main` branch on GitHub → Vercel auto-deploy.
- Preview deploys from any other branch → Vercel preview URL (use these for sharing builds with the user).

## Daily commands (once project is initialized)

```bash
npm install         # first time
npm run dev         # local dev server, then connect to it from iPhone via local network
npm run web         # web-only build preview
npm run test        # run game-logic tests
git push            # triggers Vercel deploy
```

## Open questions / decisions to revisit

- Whether to split mens/womens golfer pools or unify them. (TBD post-launch based on player feedback.)
- Whether to use Expo Router or Next.js for web. (Leaning Expo for codebase reuse with future iOS — confirm before scaffolding.)
- Whether the streak system needs server-side enforcement to prevent cheating. (Probably not for v0; trust localStorage.)

## /live feed — design lens

When designing or pruning live-feed and bet-tracker features, weigh them against the three pillars above (feed speed, bet-tracker speed, social interaction). Features that don't pull on at least one should be deprioritised; features that pull on multiple are the highest signal.

External integrations the bet tracker depends on:
- **PGA Tour orchestrator** (`orchestrator.pgatour.com/graphql`) — leaderboard, scorecards, playByPlay. Source of truth for the feed and for round-score / winning-score model inputs.
- **Polymarket** (`gamma-api.polymarket.com`) — outright winner market prices.
- **DraftKings** (`sportsbook-nash.draftkings.com/.../api/v5/`) — top-X market prices (top-5, top-10, top-20). Public-readable JSON. ToS-grey; treat as best-effort and fall back gracefully when markets don't exist for a given tournament.
- **DataGolf** (`feeds.datagolf.com`) — pre-tournament SG decompositions, live SG breakdown for player pages. Note: their `/preds/in-play` lags real events by ~2 min, so we don't use it for bet pricing.

When a market is thin or missing, fall back to our own model (per-player N(mean, variance) over final 4-round strokes) rather than going blank.

## Related files

- Auto-memory project context: `C:\Users\tombu\.claude\projects\C--Users-tombu\memory\project_pardle.md`
- Reference golf model project (separate, for data extraction patterns): `C:\Users\tombu\golf-model\`
