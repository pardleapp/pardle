/**
 * Season-form derivations — quick context chips computed from each
 * player's recent-form list (last 5–8 PGA Tour starts with finish
 * positions and made-cut flags).
 *
 * Adds the "season" layer to the feed: turns a routine birdie into
 * "Niemann birdies 14 · coming off T-3 at Schwab" or a blow-up into
 * "Cantlay doubles 14 · 3rd missed cut in last 5". Stateless, in-memory
 * lookup — no I/O.
 *
 * Server-only because the upstream recent-form.json is ~900 KB and
 * shouldn't ship to the browser.
 */

import "server-only";
import { getRecentFormByName, type RecentEvent } from "./recent-form";
import {
  getSeasonRoundsByName,
  type SeasonRound,
} from "./season-rounds";

interface SeasonForm {
  /** Made cut in the most recent N starts (N from 0 to recent.length). */
  cutStreak: number;
  /** Most recent missed cut — 0 = last start, 1 = the one before, etc.
   *  null when the player has made every recent cut. */
  lastMissedCutIdx: number | null;
  /** Best (lowest) finish position in the last 5 starts. */
  bestRecent: { pos: number; tournament: string; idx: number } | null;
  /** Count of top-10s and top-25s in the last 5 starts. */
  top10s: number;
  top25s: number;
  /** Most recent event the player teed up in (for "coming off X"). */
  lastStart: RecentEvent | null;
  /** Total recent starts captured in the dataset. */
  totalRecent: number;
}

function summarise(recent: RecentEvent[]): SeasonForm {
  const lastStart = recent[0] ?? null;
  let cutStreak = 0;
  let lastMissedCutIdx: number | null = null;
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].madeCut) {
      if (lastMissedCutIdx === null) cutStreak++;
    } else {
      if (lastMissedCutIdx === null) lastMissedCutIdx = i;
    }
  }
  const recent5 = recent.slice(0, 5);
  let top10s = 0;
  let top25s = 0;
  let best: SeasonForm["bestRecent"] = null;
  for (let i = 0; i < recent5.length; i++) {
    const r = recent5[i];
    if (typeof r.finishPos === "number" && r.madeCut) {
      if (r.finishPos <= 10) top10s++;
      if (r.finishPos <= 25) top25s++;
      if (!best || r.finishPos < best.pos) {
        best = { pos: r.finishPos, tournament: r.tournament, idx: i };
      }
    }
  }
  return {
    cutStreak,
    lastMissedCutIdx,
    bestRecent: best,
    top10s,
    top25s,
    lastStart,
    totalRecent: recent.length,
  };
}

/** Trim a tournament name to the loudest one or two words so the chip
 *  fits on a phone — "RBC Heritage" not "RBC Heritage presented by ..." */
function shortTournament(name: string | undefined): string {
  if (!name) return "";
  const trimmed = name.replace(/\s+presented by.*/i, "").trim();
  // First 22 chars is plenty for a chip — past that we slice.
  if (trimmed.length <= 22) return trimmed;
  return trimmed.slice(0, 21).trimEnd() + "…";
}

/**
 * Pick the single most editorially interesting form chip for a player,
 * given their recent run. Returns null when the dataset is too thin or
 * nothing notable stands out. Caller adds the result to `event.tags`.
 *
 * Priority order — the loudest signal wins:
 *   1. Richer round-level facts (when season-rounds data is loaded):
 *        - "First eagle since The Players"
 *        - "4th sub-67 round in 6 starts"
 *        - "5th round in red in last 8"
 *   2. Active hot streak: "Coming off T-3" / "Won the Schwab"
 *   3. Long cuts-made run: "8 straight cuts made"
 *   4. Multi top-finish stretch: "3 top-10s in 5 starts"
 *   5. Bounceback: "Bouncing back from MC last week"
 *   6. Quiet but consistent: "5 cuts in a row"
 *
 * Round-level chips ride on top of season-rounds.json (populated by
 * scripts/build-season-rounds.mjs). When that file is empty (deploy
 * day pre-build), the chip-picker silently falls back to the
 * finish-based chips. So the richer-data path is opt-in via running
 * the build script — no code change required to "switch it on".
 */
export function seasonFormTag(playerName: string): string | null {
  // Pre-flight: rich round chip wins when the data's there + matches.
  const richChip = richRoundChip(playerName);
  if (richChip) return richChip;

  const form = getRecentFormByName(playerName);
  if (!form || form.recent.length === 0) return null;
  const s = summarise(form.recent);

  if (s.lastStart && typeof s.lastStart.finishPos === "number" && s.lastStart.madeCut) {
    const pos = s.lastStart.finishPos;
    if (pos === 1) {
      return `Won ${shortTournament(s.lastStart.tournament)}`;
    }
    if (pos <= 5) {
      return `Coming off T-${pos}`;
    }
    if (pos <= 10) {
      return `Top-10 last week`;
    }
  }

  if (s.cutStreak >= 8) {
    return `${s.cutStreak} straight cuts`;
  }

  if (s.top10s >= 2) {
    return `${s.top10s} top-10s in 5 starts`;
  }
  if (s.top25s >= 3) {
    return `${s.top25s} top-25s in 5 starts`;
  }

  if (s.lastMissedCutIdx === 0 && s.cutStreak === 0 && s.totalRecent >= 2) {
    return "Bouncing back from MC";
  }

  if (s.cutStreak >= 5) {
    return `${s.cutStreak} cuts in a row`;
  }

  return null;
}

/**
 * Pick the loudest fact from round-level history. Returns null when
 * the dataset isn't loaded for this player (file empty, or this
 * player not on the PGA Tour). Caller falls back to finish-based
 * chips when this returns null.
 */
function richRoundChip(playerName: string): string | null {
  const entry = getSeasonRoundsByName(playerName);
  if (!entry || entry.rounds.length === 0) return null;
  const rounds = entry.rounds;
  // Rounds come from the build script newest-first; defensively sort.
  const sorted = [...rounds].sort((a, b) => (a.date < b.date ? 1 : -1));
  const last8 = sorted.slice(0, 32); // ~8 events × 4 rounds

  // "First eagle since X" — fires when the player had zero eagles in
  // recent rounds before scoring one earlier today (or when their
  // most recent eagle is ≥4 events old). Most evocative chip we have.
  const eagleChip = eagleSinceChip(sorted);
  if (eagleChip) return eagleChip;

  // "Nth sub-67 round in last M starts" — counts low rounds across
  // the last 8 events. Fires when the count is meaningfully above
  // baseline (sub-67 is ~12-15% of tour rounds, so 4+ in 24-32 rounds
  // is the threshold where it reads as form rather than noise).
  const sub67 = countSub67(last8);
  if (sub67.count >= 4 && sub67.fromLastEvents >= 4) {
    return `${sub67.count} sub-67 rounds in ${sub67.fromLastEvents} starts`;
  }

  // "5th round in red in last 8 rounds" — broader "playing well"
  // signal. Sub-par rounds in the last 8 chronological rounds.
  const last8Rounds = sorted.slice(0, 8);
  const red = last8Rounds.filter((r) => r.vsPar < 0).length;
  if (red >= 5 && last8Rounds.length >= 6) {
    return `${red} red rounds in last ${last8Rounds.length}`;
  }

  // "3 rounds in red in last week" — recent burst.
  return null;
}

/**
 * "First eagle since The Players" — fires when the player's most
 * recent eagle (eagles_or_better >= 1 on a single round) was at a
 * tournament that's now several events back. Threshold: ≥4 events
 * since to be tag-worthy (eagles happen routinely week-to-week, so
 * "first since last week" isn't a moment).
 */
function eagleSinceChip(sorted: SeasonRound[]): string | null {
  // Walk newest first. The current/most-recent eagle's tournament is
  // the "today" tournament; look backwards for the previous eagle.
  // Players see this chip on the row of their current eagle — but the
  // chip data sits at the player level, so we report the gap any time
  // there's been a notable eagle drought ending with the latest event.
  let currentEagleEventId: number | null = null;
  let priorEagleTournament: string | null = null;
  let eventsSpanned = 0;
  const seenEvents = new Set<number>();
  for (const r of sorted) {
    seenEvents.add(r.eventId);
    if (currentEagleEventId == null) {
      if (r.eagles > 0) currentEagleEventId = r.eventId;
      continue;
    }
    if (r.eventId === currentEagleEventId) continue;
    if (r.eagles > 0) {
      priorEagleTournament = r.tournament;
      break;
    }
    eventsSpanned = seenEvents.size - 1; // events since the current eagle
  }
  if (currentEagleEventId == null || eventsSpanned < 4) return null;
  if (!priorEagleTournament) {
    // No prior eagle in the loaded window — call it "first this season".
    return "First eagle of the season";
  }
  return `First eagle since ${shortTournament(priorEagleTournament)}`;
}

interface Sub67Result {
  count: number;
  fromLastEvents: number;
}

function countSub67(rounds: SeasonRound[]): Sub67Result {
  let count = 0;
  const events = new Set<number>();
  for (const r of rounds) {
    events.add(r.eventId);
    if (r.score > 0 && r.score < 67) count++;
  }
  return { count, fromLastEvents: events.size };
}
