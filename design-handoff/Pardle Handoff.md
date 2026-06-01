# Pardle Social — Claude Code Handoff

This package is a **design prototype** of the redesigned Pardle live/social experience ("Version B — Sweat Feed"). Everything here is a faithful, interactive mock built to define **UI + the data contract for each surface**. Implementation is a **wiring job, not a redesign**: rebuild these screens in the real Expo/React-Native-web app and point each surface at the live data source listed below.

---

## 1. Files in this package

| File | What it is |
|---|---|
| **`Pardle Social v2.html`** | ✅ **The build to implement.** Single-file React (inline Babel) prototype of the whole app. |
| **`pardle/social-v2.css`** | Stylesheet for the above (light "broadcast" theme — warm paper, emerald, tangerine; IBM Plex Mono for numbers). |
| `Pardle Social.html` + `pardle/social.css` | Alternate **dark "Live Wire"** skin of the same architecture (kept for reference / future A-B of the look). |
| `Pardle Social — Compare.html` | Side-by-side of the two social directions. |
| `Pardle Redesign.html` + `pardle/clubhouse/livewire/groupchat.html` | The original 3-direction visual exploration (Clubhouse / Live Wire / Group Chat). Reference only. |
| `Design Brief.html` | The opening direction brief. |

> The prototype uses React 18 via inline `<script type="text/babel">` purely so it runs as a static file. In the real app, rebuild as normal Expo/RN-web components — **the JSX maps almost 1:1**; treat the prototype as the spec, not code to lift.

---

## 2. Visual system (design tokens)

All defined as CSS custom properties at the top of `social-v2.css` under `.pv`:

- **Surfaces:** `--bg` warm paper, `--card` white, `--soft` tint, `--line` hairline.
- **Ink/text:** `--ink`, `--muted`, `--dim`.
- **Brand:** `--emerald` / `--emerald-d` (primary, positive), `--tang` tangerine (live/energy accent), `--blue` (calls/tips), `--down` red (loss), `--up` green (gain), `--follow` orange (following dot).
- **Type:** `Archivo` (UI), `IBM Plex Mono` (all numbers/odds/scores).
- Negative numbers use the Unicode minus `−` (U+2212) in copy; **parse with a normaliser** (see `pf()` in the prototype) — plain `parseFloat` breaks on it.

Real PGA player photos: the `Avatar` component already accepts a `photo` URL and falls back to a silhouette placeholder. **Wire `photo` to the PGA Tour headshot source** (the one the old site used, keyed by orchestrator playerId). Group-member avatars stay as initials by design.

---

## 3. Surface → data source map

External integrations (names are fine in code/comments/docs — **never in user-facing copy**, see §5):

| Surface (prototype) | Real component(s) in your repo | Live data source |
|---|---|---|
| **Sweat Feed** (bets-as-posts, shots, results, tips) | `app/live/FeedClient.tsx` | `/api/feed` (orchestrator leaderboard / scorecards / **playByPlay** for mid-hole shot detection) |
| **Shot events / BIRDIE-EAGLE tags / "Shots of the day"** | `FeedClient` rows, `ReelGroup.tsx` | `/api/feed` `rows` / `bestReel` / `worstReel` |
| **£-impact chips** ("🚀 +£42 on your outright") | `bet-impact.ts` (`headlineImpactForEvent`) | computed from `currentOdds` + leaderboard deltas vs tracked bets |
| **Bet tracker / bet detail / add-bet / odds toggle** | `app/bets/BetsClient.tsx`, `app/live/BetTracker.tsx`, `bet-shared.ts`, `bet/[id]/BetChartFull.tsx` | local bet store; live prob from model N(mean,var); outright = **Polymarket**, top-X = **DraftKings**, round/winning-score = our model |
| **Player page — This week** (live SG vs field, scorecard, advanced) | `app/live/PlayerStats.tsx` | `/api/feed` `playerRoundStates` + internal SG; advanced from **DataGolf** `event_avg` |
| **Scorecard (score vs field-average colouring + SG row)** | new — derive from scorecard + per-hole field scoring avg | orchestrator scorecards + computed hole averages |
| **Player page — Season / recent-form drill-down** | `PlayerRecentForm.tsx`, `RecentFormSparkline.tsx` | DataGolf recent-form / event archive |
| **Leaderboard** | `LeaderboardPanel.tsx` | `/api/feed` `leaderboard` |
| **Groups (P&L race, members, profiles, invite)** | *new private-group layer* (alongside existing tipster channels) | **new** — Supabase tables: groups, group_members, derive P&L from members' tracked bets |
| **Tipster channels / tips / "Track" / channel chat** | `app/api/channels/[slug]/*`, `app/[slug]/TipsterPageClient.tsx` | existing channels endpoints (tips/messages/follow) |
| **Per-shot comment threads** | `app/live/CommentThread.tsx` | `/api/feed/comment` (+ `/api/sharp/bulk` for commenter Sharp chips) |
| **Reactions / emoji bursts** | `FeedClient` react + burst | `/api/feed/react`, `/api/feed/burst` |
| **Prediction "calls" (Putt-IQ make/miss, H2H, over/under)** | `PuttPollWidget.tsx`, `PredictionPollDeck.tsx`, `PredictionPollCard.tsx` | `/api/polls/[id]/vote`, `/api/predictions/vote`; state via `/api/feed` `puttPolls` / `predictionPolls` |
| **Sharp Score / Putt-IQ standings** | `mySharp` / `myPuttIq` in `/api/feed` | existing |
| **Settlement win/loss moment + share card** | new moment UI; settlement engine exists | `/api/bets/[id]` settle + `bets/[id]/share` for share card |
| **Notifications center + push prompt** | `notifications/NotificationPrompt.tsx`, `useNotifications.ts`, `web-push` | existing push fanout (new-tip, bet-swing, settle, group activity) |
| **Daily games hub (Pros/Holes/Clubhouses/Connections) + crew challenge** | `app/games/`, `app/pros|holes|clubs|connections/`, `app/c/[token]/` | existing daily-puzzle engine (same-day deterministic) |

---

## 4. Mock data to replace (in `Pardle Social v2.html`)

Each is a top-level `const` driving the mock; swap for live data of the same shape:

- `initPosts` / `EVENTS` → live `/api/feed` rows + the polling loop (`REFRESH_MS` 3s visible / 30s hidden). The prototype's `setInterval` "live engine" simulates ingest — replace with the real poll.
- `LEADERBOARD` → `leaderboard`. `RACE` (today/season/all-time) + `MEMBERS` + `MOST_POPULAR` + `MEMBER_INFO` → group P&L from members' bets.
- `PLAYER_DATA` (pos/SG/advanced/form/holes) + `SCORECARD`/`HOLE_AVG` → orchestrator + DataGolf.
- `PLAYERS` / `MARKETS` (add-bet) → player index + supported markets.
- `GAMES` / `GAME_CHALLENGE` → puzzle state + crew results.
- `NOTIFS` → notification feed. `BET_COMMENTS` → comment threads. Poll posts (`pq1`/`pq2`) → live poll rows.

**Behaviours to preserve:** odds-format toggle (+250 / 5/2 / 3.5, persisted), Live/Settled split, bet detail shows **today's** probability trajectory (not just from entry), smart-feed filter (relevance to tracked bets), settled card flips + books into P&L race, "track a tip" → adds to bet tracker, member→player drill-through closes the member overlay first.

---

## 5. Copy guardrails (from CLAUDE.md — enforce in implementation)

1. **Never name third-party data sources in user-facing copy** — no "Polymarket / DraftKings / DataGolf / PGA Tour orchestrator / FanDuel" in any chart, empty state, tooltip, footnote, error or share card. Use "odds", "the bookmaker", "historical record", "PGA Tour event archive". (Code/comments/this doc are fine.)
2. **Never expose latency / refresh cadence** in user copy — no "sub-15s", "every 3s", "within X seconds". Say only "Live" / "Live shot-by-shot" / "Real-time".
3. **Same-day puzzle determinism** — today's puzzle identical for every user worldwide, derived from `daysSinceEpoch % puzzleCount`. Never random.
4. **Tracker, not a bookmaker** — keep the "Pardle is a tracker, not a bookmaker — we don't accept bets. 18+." line on bet surfaces; predictions/"calls" are free, no stake.
5. **Mobile-first** — 85% mobile; ≥44px touch targets, thumb reach, portrait. Desktop is a fallback (the prototype includes desktop hover affordances for the feed).
6. No emojis in code/commits; share cards & games may use emoji by design.

---

## 6. Suggested build order

1. **Feed shell + poll loop** (`/api/feed`) → render bet-posts, shot-posts, result-posts, tip-posts, poll-posts. Smart-feed filter.
2. **Bet tracker** (add-bet w/ odds, Live/Settled, bet detail chart) — the wedge.
3. **Player page** (This-week SG/scorecard, Season/recent-form drill-down).
4. **Groups** (private-group tables + P&L race + member profiles) — new backend.
5. **Settlement moments + share card**, **notifications**, **leaderboard**, **calls/Sharp**, **games hub** — mostly existing endpoints.

Everything visual is specced in the prototype; treat this doc as the data-contract layer over it.
