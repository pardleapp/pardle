# Pardle — Game Design Spec v1

**Status:** Approved 2026-05-09. All 6 open questions answered: men's only, both cm + ft/in, flag emojis yes, name = Pardle, daily drop at midday LOCAL time, ~500 player pool. Brand name to live in a single constants file for future-safe renaming.

## 1. Core mechanic

Player has **6 guesses** to identify a mystery professional golfer. Each guess is a player name typed into an autocomplete box. After submission, six attribute cells reveal under that guess, color-coded by closeness to the mystery player. Numeric attributes also show a directional arrow (⬆️ mystery is higher / ⬇️ mystery is lower).

Same puzzle for every player worldwide on the same UTC date. New puzzle drops at 00:00 UTC.

## 2. Attributes (6 per guess)

In display order, left to right:

| # | Attribute | Display | Reveal logic |
|---|-----------|---------|--------------|
| 1 | **Country** | 🇺🇸 USA | 🟩 exact match · 🟨 same continent · ⬛ otherwise. No arrow. |
| 2 | **Age** | 28 | 🟩 exact year · 🟨 within 3 years · ⬛ otherwise. ⬆️/⬇️ if not exact. |
| 3 | **Height** | 6'1" / 185 cm | 🟩 within 2 cm · 🟨 within 6 cm · ⬛ otherwise. ⬆️/⬇️ if not exact. |
| 4 | **Majors won** | 2 | 🟩 exact · 🟨 within 1 · ⬛ otherwise. ⬆️/⬇️ if not exact. |
| 5 | **PGA Tour wins** | 12 | 🟩 exact · 🟨 within 3 · ⬛ otherwise. ⬆️/⬇️ if not exact. |
| 6 | **Turn-pro year** | 2014 | 🟩 same year · 🟨 within 3 years · ⬛ otherwise. ⬆️/⬇️ if not exact. |

**Why these six:**
- Country is a strong narrowing filter casual fans always know.
- Age + Height + Turn-pro are demographic — partially guessable, partially educational.
- Majors + PGA Tour wins are career markers — what makes someone a "great" golfer.
- Six fits a clean grid (6 columns × 6 guesses), parallel to Wordle's 5×6.

**Attributes I considered and dropped:**
- *Tour* (PGA / DP / LIV): redundant once we restrict the pool to men's professional golf with PGA Tour history. Add later if we expand.
- *Handedness*: too few lefties (~3% of pool); attribute is dead 97% of the time.
- *Career earnings*: not commonly known by fans; correlates with Tour wins.
- *Ryder Cup appearances*: distinguishing for top players, dead for non-Europeans/non-Americans.

## 3. Reveal mechanics in detail

**Country.** Each player has a single ISO country (where they represent in international team events). Continents grouped as: NA, SA, EU, AS, AF, OC. Same-continent rule means USA → Canada is yellow, USA → Australia is grey.

**Numeric attributes (Age, Height, Majors, Wins, Turn-pro).** Arrow shown ONLY when not an exact match. Arrow direction is always from guess → mystery (i.e., "mystery is older" = ⬆️ on guess that's younger).

**Tied attributes.** If a player has 0 majors and 0 PGA Tour wins, those cells just show 🟩 against any player with the same. This is fine — the game still narrows on other attributes.

**Missing data.** If we lack height or turn-pro year for a player (rare for our pool), they're excluded from the daily rotation. Not "unknown" cells — that's a bad UX.

## 4. Player pool

Target: **~500 men's professional golfers** across PGA Tour, DP World Tour, and LIV.

**Inclusion rules:**
- Currently active on PGA / DP / LIV, OR
- Retired post-2000 with at least one major OR ≥10 PGA Tour wins OR Hall of Fame, OR
- Currently inside top 300 OWGR
- Must have all 6 attributes publicly verifiable (otherwise excluded)

**Frozen attributes for retired players:** use career-final values. Tom Watson's wins = his retirement total, not updated.

**Mid-season updates:** if a player wins a major Sunday, their attribute is updated by the next 00:00 UTC drop. Past puzzles are not retroactively changed (the puzzle for May 5 used May 5's data forever).

## 5. Difficulty curve (day-of-week)

Following the NYT crossword model:

| Day | Tier | Description | Examples (current as of 2026-05-09) |
|-----|------|-------------|-------------------------------------|
| Mon | **S** (very easy) | Household names, casual fans know | Tiger, Rory, Scottie Scheffler, Phil, Rahm |
| Tue | **S/A** | Top stars + LIV defectors | DJ, Brooks, Bryson, Spieth |
| Wed | **A** | Top 50 + recent major winners | Wyndham Clark, Cam Smith, Schauffele |
| Thu | **A/B** | Top 100 + Ryder Cup pros | Tony Finau, Patrick Cantlay, Tom Kim |
| Fri | **B** | Tour regulars | Sungjae Im, Sepp Straka, Adam Hadwin |
| Sat | **B/C** | Journeymen + DP/LIV mid-tier | Mackenzie Hughes, Lucas Herbert |
| Sun | **C** (hardest) | Lesser-known but legitimately on tour | Tier-3 LIV players, DP World rank-and-file |

Tiering is hand-curated, not algorithmic. Future versions could weight by Wikipedia page views or OWGR career-high.

**Distribution targets across 365 days:**
- ~50 S-tier (Mondays)
- ~50 A-tier (Tue/Wed)
- ~100 B-tier (Thu/Fri)
- ~165 C-tier (Sat/Sun)

We need ~365 unique pros per year. With a 500-player pool, each player appears on average 0.7 times/year. Easy tiers (50 players covering ~100 puzzles/year) means S-tier players repeat ~2x/year — fine, no one will remember a specific Monday.

## 6. Share card format

Pure colors only — **no arrows, no attribute icons**. This keeps the share card from spoiling the answer for friends.

```
Pardle #142 4/6
⬛🟩⬛⬛🟨⬛
🟨🟩🟨⬛⬛🟩
🟩🟩⬛🟨🟩🟩
🟩🟩🟩🟩🟩🟩
pardle.app
```

- Title line: `Pardle #{day_number} {guesses_used}/6`
- 4 rows of 6 emoji squares (one row per guess made)
- Footer: `pardle.app`
- Failed game: `Pardle #142 X/6` with all 6 rows shown

Copy-to-clipboard button on win/lose screen. Mobile share sheet on iOS Safari.

**Why no arrows in share card:** if a friend sees `🟨⬇️🟨🟩🟩🟩` they learn the mystery is younger than guess 1 — partial spoiler. Pure colors preserve mystery.

## 7. Day-numbering and puzzle determinism

- Day 1 = launch day (TBD).
- Today's puzzle for any user = `puzzleQueue[(currentUTCDate - launchDate) % puzzleQueue.length]`.
- Puzzle queue is a static JSON array shipped with the app, ordered by intended date.
- No clock can be fooled — we derive `currentUTCDate` from `Date.now()` only on the client (acceptable cheating exposure for v0; real fix is server-driven later).

## 8. Streak system

Stored in localStorage: `{ currentStreak, longestStreak, lastPlayedDay, todayResult }`.

**Rules:**
- Win adds +1 to currentStreak.
- Loss resets currentStreak to 0.
- Missing a day resets currentStreak to 0.
- One free "freeze" per calendar month (Duolingo-style — prevents one-miss rage quit).

**Anti-cheat:** none for v0. localStorage is trivially editable. Add server enforcement only if we add leaderboards.

## 9. UI screens (5 total)

1. **Today's puzzle** — guess input with autocomplete + grid of revealed attempts so far + remaining guesses count.
2. **Win screen** — reveal mystery player photo + name + bio, share button, streak count, "see you tomorrow" countdown.
3. **Lose screen** — same as win but commiserating tone.
4. **How to play** — 1-screen tutorial shown once on first open, accessible via header icon.
5. **Stats** — games played, win %, current streak, longest streak, guess distribution histogram.

No login screen, no profile, no settings beyond "dark mode" toggle in v0.

## 10. Visual style (lean Wordle)

- **Type:** system font stack (-apple-system, Inter fallback)
- **Palette:**
  - Green (correct): `#7BAE3F` (golf-fairway green, slightly muted)
  - Yellow (close): `#E8C547` (warm)
  - Grey (wrong): `#787C7E` (Wordle's exact grey)
  - Background light: `#FFFFFF`
  - Background dark: `#121213`
  - Accent (links/buttons): same green
- **No images** in v0 except mystery-player reveal photo on win/lose.
- **Wordmark:** "Pardle" in bold sans-serif, no logo art.

## 11. Out of scope for v1 (MVP)

Explicitly NOT in v1:
- User accounts / sign-in
- Cloud sync of streaks
- Leaderboards / friends
- Push notifications (we have no backend)
- Hard mode
- Practice / archive mode
- LPGA edition
- iOS app
- Ads or subscriptions
- Localization (English only, country names in English)

## 12. Open questions for Tom

Need your call on these before I code:

1. **Player pool — include LPGA?** I'm leaning **no** for v1 (men's only, gives us cleaner attribute distribution and doesn't dilute the pool). LPGA gets its own mode later if we want. **Default: men's only.**
2. **Height in cm or feet/inches?** I'd show **both** ("6'1" / 185 cm") to be region-agnostic. **Default: both.**
3. **Country — flag emoji yes/no?** Yes — flags are universal and skim-readable. **Default: yes.**
4. **Game name — confirm "Pardle"?** Or do you want to brainstorm alternatives (Birdle, Bogeyle, Tee-time, etc.)? **Default: Pardle.**
5. **Daily drop time — 00:00 UTC or 00:00 local?** UTC means everyone gets the same puzzle simultaneously (cleaner share-card discussions). Local time means players get fresh puzzle at midnight wherever they are (better personal habit). Wordle uses **local**. **Default: local time per device.** **DECIDED 2026-05-09: midday (12:00) local time per device — fits a lunchtime ritual rather than morning-coffee.**
6. **Cap on player pool size — 500 or smaller?** Bigger pool = more variety + harder C-tier. Smaller pool = better data quality but more repeats. **Default: ~500.**

## 13. What I'll build first (after your sign-off)

In order:
1. Golfer database scrape — output static JSON of ~500 pros with all 6 attributes + tier label.
2. Game logic library (TypeScript, no UI) with full unit test coverage of reveal logic.
3. Minimal UI — guess input, autocomplete, attribute grid, win/lose, share card.
4. Deploy to pardle.app via Vercel.

ETA from sign-off to pardle.app live with a working game: ~1 week of focused work.
