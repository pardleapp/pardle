import { NextResponse } from "next/server";
import {
  getActiveTournament,
  getSchedule,
  getScorecards,
  getLeaderboard,
  type PGAScorecard,
} from "@/lib/golf-api/pgatour";
import { derivePlayerStats } from "@/lib/feed/scorecard-stats";
import { getPositionTrajectory } from "@/lib/feed/position-trajectory";
import { computeCommunityBacking } from "@/lib/feed/community-backing";

/**
 * GET /api/leaderboard/player-card/[id]
 *
 * Lazy-fetched payload powering the inline scorecard panel that
 * expands when a leaderboard row is clicked. Returns just the
 * round-by-round summary + the current/last round's 18 holes —
 * enough to render a compact tournament view without the weight
 * of the full /live/player/[id] page.
 *
 * Edge-cached for 20s so a popular player whose row gets opened
 * by every viewer doesn't hammer the orchestrator. Stale-while-
 * revalidate keeps the panel snappy on subsequent expands.
 */
export const dynamic = "force-dynamic";
export const revalidate = 20;

interface PanelRound {
  round: number;
  strokes: number | null;
  toPar: number | null;
  holesPlayed: number;
  birdies: number;
  eagles: number;
  bogeys: number;
  doubles: number;
}

interface PanelHole {
  hole: number;
  par: number;
  score: number | null;
}

export interface PlayerCardResponse {
  playerId: string;
  playerName: string;
  position: string;
  total: string;
  thru: string;
  /** Round to default-surface in the 18-hole strip — current live
   *  round when one's underway, otherwise the most recent completed
   *  round. The client may swap which round it renders. */
  focusRound: number | null;
  /** Per-round 18-hole strips. Empty rounds (not started, missed
   *  cut) simply absent. Client picks which round to render. */
  holesByRound: Record<number, PanelHole[]>;
  rounds: PanelRound[];
  totals: {
    birdies: number;
    eagles: number;
    bogeys: number;
    doubles: number;
    bestRound: number | null;
    scoringAvg: number | null;
  };
  /** Recent rank samples, oldest-first. Empty array if the
   *  tournament is finished (no further sampling) or the player
   *  hasn't been sampled yet. */
  trajectory: { ts: number; pos: number }[];
  /** Integer % of distinct Pardle bettors who placed an outright
   *  or top-finish bet on this player in the tournament window.
   *  Null when the population is too small to be meaningful. */
  communityBackingPct: number | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing-id" }, { status: 400 });
  }

  // Mirror /api/feed?prefer=last-completed: resolve the live event
  // when one's underway, otherwise fall back to the most recently
  // completed one so the /leaderboard tab keeps working Mon-Wed
  // and during the period between schedule events.
  const active = await getActiveTournament().catch(() => null);
  let tournamentId: string | null =
    active?.isLive ? active.tournament.id : null;
  if (!tournamentId) {
    try {
      const { completed } = await getSchedule();
      const mostRecent = completed
        .filter((t) => t.startDate <= Date.now())
        .sort((a, b) => b.startDate - a.startDate)[0];
      if (mostRecent) tournamentId = mostRecent.id;
    } catch {
      // fall through to 404 below
    }
  }
  if (!tournamentId) {
    return NextResponse.json({ error: "no-tournament" }, { status: 404 });
  }

  // Tournament start date — needed for the community-backing window
  // which spans (start - 2d) to (start + 7d). Pulled from the same
  // schedule lookup as the fallback above.
  let tournamentStart: number | null = null;
  try {
    const { upcoming, completed } = await getSchedule();
    const meta = [...upcoming, ...completed].find((t) => t.id === tournamentId);
    if (meta) tournamentStart = meta.startDate;
  } catch {
    // backing chip will skip — non-fatal
  }

  const [leaderboard, scorecards, trajectory, backing] = await Promise.all([
    getLeaderboard(tournamentId).catch(() => []),
    getScorecards(tournamentId, [id]).catch(
      () => ({}) as Record<string, PGAScorecard>,
    ),
    getPositionTrajectory(tournamentId, id).catch(() => []),
    tournamentStart != null
      ? computeCommunityBacking(tournamentStart).catch(() => null)
      : Promise.resolve(null),
  ]);
  const row = leaderboard.find((r) => r.playerId === id);
  const scorecard = scorecards[id];
  if (!row || !scorecard) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const stats = derivePlayerStats(scorecard);

  // Pick the round to show in the 18-hole strip: prefer the live
  // round (some holes played but not all 18), else the latest
  // completed round, else R1 if nothing's started.
  let focusRound: number | null = null;
  for (const rs of stats.rounds) {
    if (rs.holesPlayed > 0 && rs.holesPlayed < 18) {
      focusRound = rs.round;
      break;
    }
  }
  if (focusRound == null) {
    const completed = stats.rounds.filter((r) => r.holesPlayed === 18);
    if (completed.length > 0) {
      focusRound = completed[completed.length - 1].round;
    } else if (stats.rounds.length > 0) {
      focusRound = stats.rounds[0].round;
    }
  }

  const holesByRound: Record<number, PanelHole[]> = {};
  for (const rs of stats.rounds) {
    const raw = scorecard.rounds[rs.round] ?? [];
    if (raw.length === 0) continue;
    holesByRound[rs.round] = raw.map((h) => ({
      hole: h.holeNumber,
      par: h.par,
      score:
        h.score === "" || h.score === "-" || !Number.isFinite(Number(h.score))
          ? null
          : Number(h.score),
    }));
  }

  const body: PlayerCardResponse = {
    playerId: row.playerId,
    playerName: row.displayName,
    position: row.position,
    total: row.total,
    thru: row.thru,
    focusRound,
    holesByRound,
    rounds: stats.rounds.map((r) => ({
      round: r.round,
      strokes: r.strokes,
      toPar: r.toPar,
      holesPlayed: r.holesPlayed,
      birdies: r.birdies,
      eagles: r.eagles,
      bogeys: r.bogeys,
      doubles: r.doubles,
    })),
    totals: {
      birdies: stats.totalBirdies,
      eagles: stats.totalEagles,
      bogeys: stats.totalBogeys,
      doubles: stats.totalDoubles,
      bestRound: stats.bestRound,
      scoringAvg: stats.scoringAvg,
    },
    trajectory,
    communityBackingPct: backing?.byPlayer[id] ?? null,
  };

  return NextResponse.json(body);
}
