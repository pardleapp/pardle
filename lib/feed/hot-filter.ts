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
 *   • Big drive — shot #1 with ≥ 300 yds carry.
 *
 *   • Close approach — landed within 15 ft of the pin (imgToPin
 *     reports as "Xft Yin to pin" once on the green; we parse and
 *     bucket).
 *
 *   • Trouble — landed in a hazard (bunker / rough / native area /
 *     waste). Drama, not calm play.
 *
 *   • Contender action — every shot from a top-10 leaderboard player,
 *     regardless of its own notability. When Scheffler is leading,
 *     his routine drives are worth showing.
 *
 * Shots that are none of the above (routine par-4 drives to the
 * fairway from mid-tier players, safe layups, etc.) drop out.
 */

import type { FeedEvent } from "./types";
import type { CachedLeaderboardRow } from "./store";

const CLOSE_APPROACH_FEET = 15;
const BIG_DRIVE_YDS = 300;
const CONTENDER_TOP_N = 10;

const TROUBLE_RX = /bunker|sand|rough|native|waste|penalty/i;

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
 * Should this event render in the Hot tab? See file-level doc for
 * the rule matrix.
 */
export function isHotEvent(ev: FeedEvent, ctx: HotFilterCtx): boolean {
  // Score events — every non-par landing (orchestrator already
  // filters pars out before emitting a score event).
  if (ev.type === "score") return true;

  // Putt-poll — always interactive, always in.
  if (ev.type === "putt-poll") return true;

  // Position + milestone events are already hand-curated notability
  // signals from the engine — surface them.
  if (ev.type === "position" || ev.type === "milestone") return true;

  if (ev.type !== "shot") return false;

  // Contender action: every shot for a top-10 leaderboard player.
  if (ev.playerId && ctx.contenderIds.has(ev.playerId)) return true;

  // Big drive: shot 1 with meaningful carry.
  if (
    (ev.imgShotNum ?? 0) === 1 &&
    typeof ev.imgShotDistance === "number" &&
    ev.imgShotDistance >= BIG_DRIVE_YDS
  ) {
    return true;
  }

  // Close approach: parsed feet ≤ threshold.
  const feet = parseToPinFeet(ev.imgToPin);
  if (feet != null && feet <= CLOSE_APPROACH_FEET) return true;

  // Landed in trouble.
  if (ev.imgSurface && TROUBLE_RX.test(ev.imgSurface)) return true;

  // Engine-flagged highlights/lowlights (orchestrator's shot classifier).
  if (ev.highlight || ev.lowlight) return true;

  return false;
}
