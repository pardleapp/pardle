/**
 * Hot-feed notability filter.
 *
 * The "Hot" tab is the middle ground between "All" (raw firehose, ~25
 * events/min at peak) and "Mine" (tracked-bets + followed players).
 * It's the "come watch the tournament without picking favourites"
 * landing — filters IMG's per-shot flood down to shots and moments
 * that would show up on TV.
 *
 * A shot / score / poll is "hot" when any of the following hold:
 *
 *   • Score event (birdie / eagle / bogey+) — every completed hole
 *     except par lands. Pars are noise; the feed engine already
 *     filters them upstream.
 *
 *   • Putt-poll — interactive "will it drop?" moments always show.
 *
 *   • Contender action — every shot from a TOP-5 leaderboard player,
 *     regardless of its own notability. When Scheffler is leading,
 *     his routine drives are worth showing.
 *
 *   • SG-standout shot — a shot that gained (or lost) meaningfully
 *     more than tour average. Not a real SG model — a set of
 *     surface + distance + shot-num heuristics that approximate the
 *     TV-highlight bar. See isSgStandout for the exact rules.
 *
 * Shots that are none of the above (routine par-4 drives to the
 * fairway from mid-tier players, safe layups, etc.) drop out.
 */

import type { FeedEvent } from "./types";
import type { CachedLeaderboardRow } from "./store";

const CLOSE_APPROACH_FEET = 10;
const TAP_IN_FEET = 5;
const BIG_DRIVE_YDS = 320;
const LONG_APPROACH_YDS = 200;
const SHORT_MISS_MIN_YDS = 20;
const SHORT_MISS_MAX_YDS = 130;
const SHORT_MISS_MISS_FEET = 40;
const CONTENDER_TOP_N = 5;

const TROUBLE_RX = /penalty|hazard|water/i;

interface HotFilterInputs {
  leaderboard: CachedLeaderboardRow[];
}

interface HotFilterCtx {
  contenderIds: Set<string>;
}

/** Precompute the leaderboard-derived pieces once per render. */
export function buildHotFilterCtx({
  leaderboard,
}: HotFilterInputs): HotFilterCtx {
  // Leaderboard is already position-sorted by the cache layer, so
  // the first N are the current top-N by position (ties broken as
  // orchestrator sorts them).
  const contenderIds = new Set<string>();
  for (const r of leaderboard.slice(0, CONTENDER_TOP_N)) {
    if (r.playerId) contenderIds.add(r.playerId);
  }
  return { contenderIds };
}

/** Extract feet from `imgToPin` strings like "12ft. 5in.", "0ft. 6in.",
 *  "8 ft 3 in to pin". Returns null if we can't parse — that's fine,
 *  the caller falls back to non-close-approach classification. */
function parseToPinFeet(toPin: string | undefined): number | null {
  if (!toPin) return null;
  const t = toPin.trim();
  // Anything expressed in yards is by definition > 15 ft (5 yds = 15 ft).
  if (/yds?\b/i.test(t) && !/ft\b/i.test(t)) {
    const m = t.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const yds = Number(m[1]);
      if (Number.isFinite(yds)) return yds * 3;
    }
    return null;
  }
  const ftMatch = t.match(/(\d+(?:\.\d+)?)\s*ft/i);
  const inMatch = t.match(/(\d+(?:\.\d+)?)\s*in/i);
  const ft = ftMatch ? Number(ftMatch[1]) : 0;
  const inch = inMatch ? Number(inMatch[1]) : 0;
  if (!ftMatch && !inMatch) return null;
  return ft + inch / 12;
}

/**
 * "Strokes-gained standout" — approximates TV highlight-reel material
 * from IMG's per-shot data. Rough proxy, not a real SG model.
 *
 * Positive standouts (TV would show):
 *   • Approach from 100+ yds landed inside 10 ft
 *   • Any shot landed inside 5 ft (tap-in territory)
 *   • Very long drive (≥ 320 yds off the tee)
 *   • Approach from 200+ yds landed on green
 *
 * Negative standouts:
 *   • Shot from 20–130 yds ended > 40 ft from pin (bladed, chunked,
 *     or bailed way wide)
 *   • Landed in penalty area / hazard / water
 */
function isSgStandout(ev: FeedEvent): boolean {
  if (ev.type !== "shot") return false;

  const dist = ev.imgShotDistance ?? 0;
  const shotNum = ev.imgShotNum ?? 0;
  const surface = ev.imgSurface || "";
  const feet = parseToPinFeet(ev.imgToPin);

  // ── Positive ────────────────────────────────────────────────────
  // Big drive off the tee.
  if (shotNum === 1 && dist >= BIG_DRIVE_YDS) return true;

  // Tap-in territory from any distance ≥ tee-shot range
  if (feet != null && feet <= TAP_IN_FEET && dist >= 20) return true;

  // Close approach from meaningful distance.
  if (feet != null && feet <= CLOSE_APPROACH_FEET && dist >= 100) return true;

  // Long approach that found the green.
  if (dist >= LONG_APPROACH_YDS && /green/i.test(surface)) return true;

  // ── Negative ────────────────────────────────────────────────────
  // Landed in penalty area / hazard / water.
  if (surface && TROUBLE_RX.test(surface)) return true;

  // Short-range miss — took a short shot, ended nowhere near the pin.
  if (
    dist >= SHORT_MISS_MIN_YDS &&
    dist <= SHORT_MISS_MAX_YDS &&
    feet != null &&
    feet > SHORT_MISS_MISS_FEET
  ) {
    return true;
  }

  return false;
}

/** Results that qualify as "exceptional" — always in Hot regardless
 *  of whether the player is a contender. Eagles, aces, and blow-ups
 *  (triple bogey or worse) are moments TV would cut to. Routine
 *  birdies and bogeys from a mid-pack player are not. */
const EXCEPTIONAL_RESULTS = new Set([
  "ace",
  "albatross",
  "eagle",
  "triple-plus",
]);

/**
 * Should this event render in the Hot tab?
 *
 * Rules:
 *   • Contender (top-5 leaderboard) → every shot + every score
 *   • Everyone else                 → only SG-standout shots + only
 *                                     exceptional scores (eagle /
 *                                     ace / albatross / triple+)
 *   • Interactive polls             → always in (rare, high-signal)
 *   • Position / milestone          → always in (engine-curated)
 *
 * A routine bogey from Nakajima at T14 doesn't make Hot; his eagle
 * would. Every McIlroy shot makes Hot while he's on the leaderboard.
 */
export function isHotEvent(ev: FeedEvent, ctx: HotFilterCtx): boolean {
  // Putt-poll — always interactive, always in.
  if (ev.type === "putt-poll") return true;

  // Position + milestone events are already hand-curated notability
  // signals from the engine — surface them.
  if (ev.type === "position" || ev.type === "milestone") return true;

  const isContender =
    typeof ev.playerId === "string" && ctx.contenderIds.has(ev.playerId);

  // Score events
  if (ev.type === "score") {
    if (isContender) return true;
    if (ev.ace) return true;
    if (ev.result && EXCEPTIONAL_RESULTS.has(ev.result)) return true;
    return false;
  }

  if (ev.type !== "shot") return false;

  // Contender action: every shot.
  if (isContender) return true;

  // Big SG winner / loser.
  if (isSgStandout(ev)) return true;

  // Engine-flagged highlights/lowlights (orchestrator's shot classifier).
  if (ev.highlight || ev.lowlight) return true;

  return false;
}
