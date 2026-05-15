# Pardle

Daily Wordle-style golf game. Players get 6 guesses to identify a mystery PGA/LIV/LPGA pro. Each guess reveals match-state on attributes (country, age bracket, height, majors won, career wins, turned-pro decade, OWGR tier) with directional arrows for numeric ones.

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

## /live feed — product targets (model: the Real app)

The `/live` golf feed is being built to deliver the same engagement loop the Real app captures for general sports (Real is a real-time sports social app). When designing or pruning live-feed features, weigh them against these three drivers — they are what Real's team called out as the reasons users keep showing up:

1. **Betting talk is the magnet.** Bettors come in to discuss their picks and strategies — "I need three birdies", "if Scheffler bogeys 17 my parlay's dead". Treat betting-adjacent talk (props, live odds, "what I need") as a first-class use case for comments/threads, not an afterthought. Polls and prediction markets feed this directly.
2. **Communal wins/losses are the glue.** Users celebrate hits and commiserate misses together. Reactions, threads, follow-a-player, and shareable "moment" cards should all make those emotional spikes social. A bogey on the wrong hole should be as fun to talk about as a birdie.
3. **Speed beats TV and social.** Real's pitch: "usually faster than TV, faster than social media." Our live feed must consistently surface what's happening on the course before users see it on Twitter or a broadcast cut. That means: tight orchestrator polling cadence, no needless caching on event surfacing, and aggressively prioritising "fresh" over "complete" when there's a trade-off.

Use these as the lens for prioritisation calls on `/live`. Features that don't pull on at least one of these three levers should be deprioritised; features that pull on multiple are the highest signal.

## Related files

- Auto-memory project context: `C:\Users\tombu\.claude\projects\C--Users-tombu\memory\project_pardle.md`
- Reference golf model project (separate, for data extraction patterns): `C:\Users\tombu\golf-model\`
