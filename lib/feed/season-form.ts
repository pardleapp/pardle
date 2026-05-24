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
 *   1. Active hot streak: "Coming off T-3" / "Won the Schwab"
 *   2. Long cuts-made run: "8 straight cuts made"
 *   3. Multi top-finish stretch: "3 top-10s in 5 starts"
 *   4. Bounceback: "Bouncing back from MC last week"
 *   5. Quiet but consistent: "5 cuts in a row"
 */
export function seasonFormTag(playerName: string): string | null {
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
