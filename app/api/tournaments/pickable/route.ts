/**
 * GET /api/tournaments/pickable
 *
 * Returns the curated list of tournaments a user can attach a bet to
 * from the AddBet sheet: the active tournament (if any), the next 2
 * upcoming events, and the last 4 completed events. Enough to cover
 * "I'm placing a bet DURING the event" (default), "I meant to log a
 * bet from last week" (recent completed), and "I want to place a bet
 * on next week's event ahead of time" (upcoming).
 *
 * The dropdown UX is what makes settlement watertight — every placed
 * bet gets an unambiguous tournamentId, so historical-settle can go
 * fetch the right archived leaderboard and grade it. No more legacy
 * "which tournament was this?" guessing.
 *
 * Cache: 5 minutes on the edge — the schedule barely changes, and
 * the active pointer shifts once a week.
 */

import { NextResponse } from "next/server";
import {
  getActiveTournament,
  getSchedule,
} from "@/lib/golf-api/pgatour";

export const runtime = "nodejs";
export const revalidate = 300;

const RECENT_COMPLETED_N = 4;
const UPCOMING_N = 2;

/** Opposite-field / secondary events that run the same week as a
 *  main tour stop. Users tracking bets almost always mean the main
 *  event of the week, so we filter these out of the pickable list.
 *  If someone genuinely bet on ISCO they can raise it — much rarer
 *  case than the noise of two entries per week in the dropdown. */
const OPPOSITE_FIELD_KEYWORDS = [
  "isco championship",
  "barracuda championship",
  "barbasol championship",
  "puerto rico open",
  "corales puntacana",
  "myrtle beach classic",
  "butterfield bermuda",
  "bank of utah",
  "sanderson farms",
  "black desert",
  "world wide technology",
];

function isOppositeField(name: string): boolean {
  const n = name.toLowerCase();
  return OPPOSITE_FIELD_KEYWORDS.some((kw) => n.includes(kw));
}

interface PickableTournament {
  id: string;
  name: string;
  startDate: number;
  /** upcoming | live | completed — drives the UI grouping + labels. */
  state: "upcoming" | "live" | "completed";
}

export async function GET() {
  try {
    const [scheduleThis, activeInfo] = await Promise.all([
      getSchedule().catch(() => ({ upcoming: [], completed: [] })),
      getActiveTournament().catch(() => null),
    ]);
    let active = activeInfo?.tournament ?? null;
    // If the active resolver picked an opposite-field event, try to
    // find a concurrent main event (started within ±3 days) and use
    // that as "Live" for the dropdown instead. Falls through to null
    // when no main exists in that window.
    if (active && isOppositeField(active.name)) {
      const WINDOW = 3 * 24 * 60 * 60 * 1000;
      const concurrentMain = [
        ...scheduleThis.upcoming,
        ...scheduleThis.completed,
      ]
        .filter(
          (t) =>
            !isOppositeField(t.name) &&
            Math.abs(t.startDate - active!.startDate) <= WINDOW,
        )
        .sort((a, b) => a.startDate - b.startDate)[0];
      active = concurrentMain ?? null;
    }
    const activeId = active?.id ?? null;

    // Recent completed events — bias to the last 4 by startDate so a
    // user who forgot to log a bet from 3 weeks ago can still tag it.
    const completedSorted = [...scheduleThis.completed].sort(
      (a, b) => b.startDate - a.startDate,
    );
    const recentCompleted: PickableTournament[] = completedSorted
      .filter((t) => t.id !== activeId && !isOppositeField(t.name))
      .slice(0, RECENT_COMPLETED_N)
      .map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        state: "completed",
      }));

    // Upcoming — next 2 events. Users placing pre-tournament bets get
    // this so their bet is stamped to the RIGHT event ahead of time.
    const upcomingSorted = [...scheduleThis.upcoming].sort(
      (a, b) => a.startDate - b.startDate,
    );
    const upcoming: PickableTournament[] = upcomingSorted
      .filter((t) => t.id !== activeId && !isOppositeField(t.name))
      .slice(0, UPCOMING_N)
      .map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        state: "upcoming",
      }));

    const options: PickableTournament[] = [];
    // Order: upcoming (closest first) → live → recent completed (most
    // recent first). The AddBet sheet defaults to `active` so the
    // common case (mid-event bet) needs zero clicks; the other groups
    // are one tap away.
    for (const t of [...upcoming].reverse()) options.push(t);
    if (active) {
      options.push({
        id: active.id,
        name: active.name,
        startDate: active.startDate,
        state: "live",
      });
    }
    for (const t of recentCompleted) options.push(t);

    return NextResponse.json(
      {
        active: active
          ? {
              id: active.id,
              name: active.name,
              startDate: active.startDate,
            }
          : null,
        options,
      },
      {
        // Match revalidate — the schedule + active pointer are cheap
        // to re-render at 5-min granularity.
        headers: {
          "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.error("[tournaments/pickable] failed", err);
    return NextResponse.json(
      { error: "pickable-fetch-failed" },
      { status: 500 },
    );
  }
}
