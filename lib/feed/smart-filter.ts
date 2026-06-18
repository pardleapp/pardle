/**
 * Smart-feed impact set — Tier 1 heuristic.
 *
 * Given the user's tracked bets + current leaderboard / odds, decide
 * which players' shots are "material" to those bets:
 *
 *   ┌────────────────┬────────────────────────────────────┬───────────────────────┐
 *   │ bet kind       │ impact set                          │ notable threshold     │
 *   ├────────────────┼────────────────────────────────────┼───────────────────────┤
 *   │ round-score    │ {bet.playerId}                      │ every shot            │
 *   │ outright       │ {bet.playerId} ∪ top-K by odds      │ birdie/eagle/bogey+   │
 *   │ top-finish     │ {bet.playerId} ∪ bubble around N    │ birdie/eagle/bogey+   │
 *   │ winning-score  │ top-L leaderboard contenders        │ birdie/eagle/bogey+   │
 *   └────────────────┴────────────────────────────────────┴───────────────────────┘
 *
 * The function returns two disjoint sets:
 *   - `everyShot`     — render any score/shot event from these players
 *   - `notableOnly`   — render only birdies/eagles/bogeys+ (no pars)
 *
 * `everyShot` wins on overlap (if a player qualifies under both, the
 * looser filter applies).
 */

import type { CachedLeaderboardRow } from "@/lib/feed/store";
import type { TrackedBet } from "@/app/live/bet-shared";
import type { FeedEvent } from "@/lib/feed/types";

/** Per-bet-kind tunables. Kept in one block so a future Tier-2 pass
 *  can replace them with measured £-impact thresholds without
 *  hunting through the function body. */
const OUTRIGHT_TOP_K = 5;
const TOP_FINISH_BUFFER_BELOW = 2;
const TOP_FINISH_BUFFER_ABOVE = 3;
const WINNING_SCORE_TOP_L = 10;

export interface SmartImpactSet {
  /** Players whose every shot is shown (the user's own bets). */
  everyShot: Set<string>;
  /** Players whose only notable shots (birdie/eagle/bogey+) show. */
  notableOnly: Set<string>;
}

/** Parse a leaderboard position string like "T5" / "12" / "—" into a
 *  number. Returns null for non-numeric ("CUT", "WD", "—"). */
function parsePosition(pos: string): number | null {
  if (!pos) return null;
  const m = pos.match(/^T?(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/** Did this event change the player's score by anything OTHER than a
 *  par? Used as the loose-relevance gate for non-owned players. */
function isNotableEvent(ev: FeedEvent): boolean {
  if (ev.type !== "score") return false;
  if (!ev.result) return false;
  return ev.result !== "par";
}

/** Build the impact set from the user's bets + current snapshot. The
 *  caller passes only the slices it has (currentOdds may be empty
 *  pre-tournament; leaderboard may be empty before the first poll). */
export function buildSmartImpactSet({
  bets,
  leaderboard,
  currentOdds,
}: {
  bets: TrackedBet[];
  leaderboard: CachedLeaderboardRow[];
  currentOdds: Record<string, number>;
}): SmartImpactSet {
  const everyShot = new Set<string>();
  const notableOnly = new Set<string>();

  // Pre-rank players for outright top-K (descending current prob).
  let topByOddsIds: string[] | null = null;
  const getTopByOdds = () => {
    if (topByOddsIds !== null) return topByOddsIds;
    topByOddsIds = Object.entries(currentOdds)
      .filter(([, p]) => typeof p === "number" && p > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, OUTRIGHT_TOP_K)
      .map(([pid]) => pid);
    return topByOddsIds;
  };

  // Top-L by leaderboard total — used by winning-score (no playerId).
  let topByBoardIds: string[] | null = null;
  const getTopByBoard = (limit: number) => {
    if (topByBoardIds !== null) return topByBoardIds.slice(0, limit);
    // Leaderboard is already position-sorted by the cache layer.
    topByBoardIds = leaderboard
      .map((r) => r.playerId)
      .filter((id) => id);
    return topByBoardIds.slice(0, limit);
  };

  // Lookup: playerId → position number (for top-finish bubble).
  const positionByPlayer = new Map<string, number>();
  for (const r of leaderboard) {
    const n = parsePosition(r.position);
    if (n != null) positionByPlayer.set(r.playerId, n);
  }

  for (const b of bets) {
    if (b.settledAt != null) continue;

    if (b.kind === "round-score") {
      // Round-score is a single-player line — only that player's shots
      // can move it.
      if (b.playerId) everyShot.add(b.playerId);
      continue;
    }

    if (b.kind === "outright") {
      if (b.playerId) everyShot.add(b.playerId);
      // Top-K contenders by current win prob — a Scheffler eagle on
      // an "Aberg outright" bet moves it just as much as Aberg's own
      // shots do, because the market re-prices on the field.
      for (const pid of getTopByOdds()) {
        if (!everyShot.has(pid)) notableOnly.add(pid);
      }
      continue;
    }

    if (b.kind === "top-finish") {
      if (b.playerId) everyShot.add(b.playerId);
      // Bubble around the cutoff: positions cutoff-2 → cutoff+3.
      // A Bradley birdie when Bradley is T6 on a Top-5 bet matters.
      const lo = b.cutoff - TOP_FINISH_BUFFER_BELOW;
      const hi = b.cutoff + TOP_FINISH_BUFFER_ABOVE;
      for (const [pid, pos] of positionByPlayer.entries()) {
        if (pos >= lo && pos <= hi && !everyShot.has(pid)) {
          notableOnly.add(pid);
        }
      }
      continue;
    }

    if (b.kind === "winning-score") {
      // No specific player — the bet is on the eventual winning total.
      // Top of the leaderboard is where the winning score gets made.
      for (const pid of getTopByBoard(WINNING_SCORE_TOP_L)) {
        if (!everyShot.has(pid)) notableOnly.add(pid);
      }
      continue;
    }
  }

  // Disjoint guarantee — `everyShot` wins on overlap so the looser
  // rule applies if a player qualifies under both lenses.
  for (const pid of everyShot) notableOnly.delete(pid);

  return { everyShot, notableOnly };
}

/** Should this event be shown in Smart feed given the impact set? */
export function isMaterialEvent(
  ev: FeedEvent,
  impact: SmartImpactSet,
): boolean {
  if (impact.everyShot.has(ev.playerId)) return true;
  if (impact.notableOnly.has(ev.playerId)) return isNotableEvent(ev);
  return false;
}
