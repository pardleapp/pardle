# Pardle

## What Pardle is now

Pardle is a **social app for following pro golf and tracking your bets** — a place where fans and bettors follow tournaments shot-by-shot, react and chat with their crew, track the bets they've placed elsewhere, and see each bet's live win-probability move with every shot.

The **social live feed is the primary surface.** Bets, shots, results, tips and prediction polls all flow through one stream where every item is a social object (react, comment, share). The original daily guessing game still ships as a **friction-free viral entry point**, now one tab among several.

The product is organised around five things, and every prioritisation call should be weighed against the three pillars below:

**Surfaces:** Sweats (the live feed) · My bets (the tracker) · Leaders (leaderboard) · Groups (private crews + P&L race) · Sharp (free predictions) — plus Games (daily puzzles), player pages, notifications, and tipster channels.

### The three pillars (priority order for trade-offs)

1. **Speed of the feed.** When a player holes out, the user should see it on Pardle before TV or social. That means tight orchestrator polling, mid-hole `playByPlay` shot detection (not just hole-completion), and no needless caching on the surfacing path. Prioritise "fresh" over "complete" when they conflict.

2. **Speed of the bet tracker.** When odds shift, the user's on-screen bet PnL must move within seconds — across every market we surface (outright, round-score, winning-score, top-X). Bet detail charts show *today's* full trajectory, not just from entry, so a user arriving mid-round still gets context.

3. **Social interaction with the feed.** Reactions, threaded comments, prediction polls, group P&L races, communal wins/losses, share cards. Betting-adjacent talk ("I need three birdies", "if Scheffler bogeys 17 my parlay's dead") is a first-class use case, not an afterthought. Without this Pardle is a feed reader; with it, it's where bettors hang out.

## Two product principles that must never blur

1. **Bets vs. Calls.** **Bets** are real money the user placed elsewhere — Pardle *tracks* them, it is not a bookmaker and never accepts stakes. **Calls** (Sharp / Putt-IQ — make-or-miss, head-to-head, over/under, hold-the-lead) are **free, skill-scored predictions** that build a Sharp Score; no stake, ever. Keep these visually and conceptually distinct: bets show stake/odds/PnL; calls show accuracy/streak/rank.

2. **Every bet and shot is a social object.** Bets render as feed posts you can react to, comment on, tail, and share; notable shots can be reacted to and shared. The social layer is woven through the betting product, not bolted beside it.

## Design source of truth

The redesign's canonical visual spec lives in the repo at **`design-handoff/Pardle Social v2.html`** (with `pardle/social-v2.css`) plus **`design-handoff/Pardle Handoff.md`** (surface → data-source map).

- Before building or editing any UI surface, **open the prototype, find the matching component** (`BetPost`, `ShotPost`, `PlayerPage`, `Scorecard`, `Leaderboard`, `GamesHub`, `Notifications`, reaction cluster, etc.) and reproduce its layout, structure, class names, spacing and tokens **exactly** — don't approximate from memory or invent new patterns.
- Use the v2 **light "broadcast" theme** tokens from `social-v2.css` (the `.pv` custom properties — warm-paper `--bg`, white cards, `--emerald`/`--tang` accents; Archivo for UI, IBM Plex Mono for numbers). **Never reintroduce the old dark pre-redesign theme in any state** — including empty, error, loading, and off-week/between-events screens.
- After completing a surface, state which prototype component you matched against so it can be verified.
- If the prototype and a request conflict, pause and ask rather than guessing.

## Audience: mobile-first

**85% of users are on mobile.** Always optimise for phone first — touch targets ≥44px, thumb reach, portrait layouts, iOS Safari quirks, share-sheet and add-to-home-screen (PWA) flows. Desktop is a fallback view with hover affordances, not the primary target. Test every visible change in a phone-sized viewport before declaring it done.

## Stack

- **Language:** TypeScript (strict mode)
- **Framework:** Expo (React Native + react-native-web) — same codebase ships to iOS later via EAS Build without rewrites
- **Hosting:** Vercel at pardle.app
- **State:** local (localStorage / AsyncStorage) for device-only prefs; **Supabase (Postgres + Auth)** for cross-device/social features — groups, group membership, P&L, notifications/push subscriptions, channels.
- **Data:** golfer DB as static JSON in the repo (sourced from PGA Tour API + Wikipedia); live data from the integrations below.

### External integrations the live product depends on
- **PGA Tour orchestrator** (`orchestrator.pgatour.com/graphql`) — leaderboard, scorecards, playByPlay. Source of truth for the feed and for round-score / winning-score model inputs.
- **Polymarket** (`gamma-api.polymarket.com`) — outright winner market prices.
- **DraftKings** (`sportsbook-nash.draftkings.com/.../api/v5/`) — top-X market prices. Public-readable JSON, ToS-grey; treat as best-effort, fall back gracefully.
- **DataGolf** (`feeds.datagolf.com`) — pre-tournament + live SG decompositions for player pages. Their `/preds/in-play` lags ~2 min, so don't use it for bet pricing.

When a market is thin or missing, fall back to our own model (per-player N(mean, variance) over final-4-round strokes) rather than going blank.

## Working with the user

The user (Tom) is **non-technical** — does not write code. Claude writes all code, designs and config. Tom's role: approves designs (screenshots before styling), tests builds in iPhone Safari, recruits testers, clicks through external signups (GitHub, Vercel, Supabase, Apple, Namecheap).

- **Never ask Tom to "send" credentials via chat.** Secrets live in `.env.local` (gitignored) where Claude Code reads them. Tom logs into services via browser.
- **Avoid unexplained jargon.** First time a tool/concept appears, give a one-line plain-English explanation.

## Copy guardrails (enforce everywhere user-facing)

1. **Never name third-party data sources in user-facing copy** — no "Polymarket / DraftKings / FanDuel / DataGolf / PGA Tour orchestrator" in charts, empty states, tooltips, footnotes, errors, or share cards. Use "odds", "the bookmaker", "historical record", "PGA Tour event archive". Code/comments/docs/dashboards: fine.
2. **Never expose feed latency or refresh cadence** — no "sub-15s", "every 3s", "within X seconds", "near real-time" with a number. User-facing copy says only "Live" / "Live shot-by-shot" / "Real-time". The speed pillar is internal prioritisation only.
3. **Tracker, not a bookmaker.** Keep the "Pardle is a tracker, not a bookmaker — we don't accept bets. 18+." line on bet surfaces. Calls/predictions are free, no stake.
4. **Same-day puzzle determinism.** Today's puzzle is identical for every user worldwide on the same UTC date, derived from `daysSinceEpoch % puzzleCount`. Never random.

## Coding rules

- **Game logic must be tested.** The attribute-reveal logic is the heart of the daily game; bugs there break trust. Unit-test it.
- **Minimize dependencies.** Every package is maintenance debt. Default to the platform/standard library; justify every dependency.
- **No half-finished UI in main.** Use feature flags or branches for in-progress work. Deployed pardle.app must always be usable. (A `?demo=1` stub-feed mode exists for previewing live-feed UI between tournaments — keep it dev-gated, never shipped to real users as default.)
- **Comment only the non-obvious *why*** (workarounds, hidden constraints), not what the code does.
- **No emojis in code or commits** unless asked. (Game and share cards use emojis by design — that's a product exception.)
- **Parse Unicode minus.** Data/copy uses the Unicode minus `−` (U+2212); use a normaliser, not raw `parseFloat`, or negatives become `NaN`.
- **Player photos:** use real PGA Tour headshots via the headshot source (keyed by orchestrator playerId); the Avatar component falls back to initials. Group-member avatars stay as initials.

## Heritage: the daily game

The original Pardle is a daily golf-attribute guessing game (6 guesses to identify a mystery pro; reveals on country / age / height / majors / wins / decade / OWGR tier). It ships in the **Games** hub as a friction-free, viral entry point — strong on share-card text, draws people in during tournament weeks. Keep it; let the social/live surfaces be primary during live play. Crew challenges (`app/c/[token]/`) let people challenge mates.

## Domain + deployment

- Domain `pardle.app` (Namecheap).
- Production deploys from `main` → Vercel auto-deploy. Preview deploys from other branches → Vercel preview URL (use for sharing builds with Tom).

## Daily commands

```bash
npm install      # first time
npm run dev      # local dev server (connect from iPhone over local network)
npm run web      # web-only build preview
npm run test     # game-logic tests
git push         # triggers Vercel deploy
```

## Cut / deprioritised

- **Course map** is removed from the primary nav. The `/course` page (and `/api/course/geo`) remain routable for old bookmarks but get no further investment unless explicitly asked.

## Open questions / revisit

- Split vs. unify mens/womens golfer pools (TBD post-launch on feedback).
- Whether streak/Sharp-Score enforcement needs server-side anti-cheat (probably not for v0; trust the client).

## Related files

- Design source of truth: `design-handoff/Pardle Social v2.html`, `pardle/social-v2.css`, `design-handoff/Pardle Handoff.md`
- Auto-memory project context: `C:\Users\tombu\.claude\projects\C--Users-tombu\memory\project_pardle.md`
- Reference golf model project: `C:\Users\tombu\golf-model\`
