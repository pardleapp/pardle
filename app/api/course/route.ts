import { NextResponse } from "next/server";
import {
  computeFieldStats,
  getCachedLeaderboard,
  getCachedTournamentPars,
  getSnapshot,
} from "@/lib/feed/store";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { lookupCourseForTournament } from "@/lib/data/courses/registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/course
 *
 * Returns per-player current-hole positions for the live course-map
 * view. Source is the same cached leaderboard the feed page uses, so
 * this endpoint is dirt cheap — no orchestrator hit.
 *
 * Output:
 *   {
 *     tournament: { id, name, currentRound, isLive } | null,
 *     holes: [{ number, par }] (18 entries),
 *     players: [{
 *       playerId, displayName, currentHole, status, total, thru
 *     }]
 *   }
 *
 *   currentHole: number 1..18 of the hole the player is currently
 *                playing (or about to play) — null when not started.
 *   status: "active" | "finished" | "not-started" | "out"
 *           (out = MC / WD / DQ / CUT, player isn't on the course)
 */
export async function GET() {
  const active = await getActiveTournament().catch(() => null);
  if (!active) {
    return NextResponse.json({ tournament: null, holes: [], players: [] });
  }
  const tournamentId = active.tournament.id;

  const [leaderboard, parsByRoundHole, snapshot] = await Promise.all([
    getCachedLeaderboard(tournamentId),
    getCachedTournamentPars(tournamentId),
    getSnapshot(tournamentId),
  ]);

  // Derive the round being played from whichever round has the most
  // par entries cached — the cron writes them as it polls each round's
  // scorecard, so the freshest is also the heaviest. Fallback to R1.
  const currentRound = pickActiveRound(parsByRoundHole) ?? 1;
  const parsForRound = parsByRoundHole[currentRound] ?? {};

  // Field-difficulty per hole this round — drives the heatmap on the
  // course-map UI. Mean (strokes − par) across every player who's
  // completed the hole so far. Negative = playing easy (birdies),
  // positive = playing hard (bogeys+). Sparse: only holes with at
  // least one completion get a stat. Cheap — same maths the engine
  // already runs for bet projections.
  const fieldStats = computeFieldStats(snapshot, parsByRoundHole);
  const roundStats = fieldStats[currentRound] ?? {};

  const holes = Array.from({ length: 18 }, (_, i) => {
    const num = i + 1;
    const stat = roundStats[num];
    return {
      number: num,
      par: parsForRound[num] ?? null,
      /** Field mean strokes-vs-par for this hole today. null when no
       *  completions yet. Powers the heatmap color on the UI. */
      fieldMean: stat?.mean ?? null,
      /** How many players have completed this hole today. Small
       *  samples (< 8) get a softer color so we don't claim
       *  certainty from 2 players. */
      fieldCount: stat?.count ?? 0,
    };
  });

  const players = leaderboard.map((r) => {
    const status = playerStatus(r.playerState);
    const { currentHole, finished } = computeCurrentHole(r.thru);
    return {
      playerId: r.playerId,
      displayName: r.displayName,
      currentHole,
      status:
        status === "out"
          ? "out"
          : finished
          ? "finished"
          : currentHole == null
          ? "not-started"
          : "active",
      total: r.total,
      thru: r.thru,
      position: r.position,
    };
  });

  // Match the active tournament against the per-course geometry
  // registry so the client knows whether to enable the visual
  // course-map view (vs falling back to the abstract grid).
  const courseRegistry = lookupCourseForTournament(active.tournament.name);

  return NextResponse.json(
    {
      tournament: {
        id: tournamentId,
        name: active.tournament.name,
        currentRound,
        isLive: active.isLive,
      },
      /** Slug of the course geometry JSON to load via
       *  /api/course/geo/[id]. Null when we don't have geometry
       *  extracted for this tournament's venue. */
      courseId: courseRegistry?.id ?? null,
      courseName: courseRegistry?.name ?? null,
      holes,
      players,
    },
    {
      // Same edge-cache hint as /api/feed — response is the same for
      // every visitor (no per-user overlays here) so the edge can
      // dedupe aggressively. Course-map polls at 6s on the client;
      // s-maxage=3 + swr=6 means most polls hit the edge cache.
      headers: {
        "Cache-Control":
          "public, s-maxage=3, stale-while-revalidate=6, max-age=0",
      },
    },
  );
}

function pickActiveRound(
  pars: Record<number, Record<number, number>>,
): number | null {
  let best: { round: number; count: number } | null = null;
  for (const [k, v] of Object.entries(pars)) {
    const round = Number(k);
    const count = Object.keys(v).length;
    if (!best || count > best.count) best = { round, count };
  }
  return best?.round ?? null;
}

function playerStatus(s: string): "active" | "out" {
  if (!s) return "active";
  const u = s.toUpperCase();
  if (u === "CUT" || u === "MC" || u === "WD" || u === "DQ" || u === "DNS") {
    return "out";
  }
  return "active";
}

/**
 * Translate a `thru` string from the orchestrator leaderboard into
 * a current-hole number. Handles the conventional forms:
 *
 *   ""  / "-"  → null (not yet teed off)
 *   "F"         → finished (return null + finished=true)
 *   "N"         → completed N holes off front tee → currently on hole N+1
 *                 (capped at 18; when N=18 player just finished)
 *   "N*"        → completed N holes off back tee → currently on the
 *                 N+1th hole of their split-tee sequence: 10..18,1..9.
 */
function computeCurrentHole(thru: string): {
  currentHole: number | null;
  finished: boolean;
} {
  if (!thru) return { currentHole: null, finished: false };
  const t = thru.trim();
  if (t === "" || t === "-") return { currentHole: null, finished: false };
  if (t === "F" || t === "F*") return { currentHole: null, finished: true };
  const m = /^(\d+)(\*?)$/.exec(t);
  if (!m) return { currentHole: null, finished: false };
  const done = Number(m[1]);
  const backNine = m[2] === "*";
  if (!Number.isFinite(done) || done < 0) {
    return { currentHole: null, finished: false };
  }
  if (done >= 18) return { currentHole: null, finished: true };
  // Their next hole is (start + done) wrapped around the 18-hole cycle.
  // Front-tee start: 1 + done. Back-tee start: 10 + done, wrapping 18→1.
  const startHole = backNine ? 10 : 1;
  const next = ((startHole - 1 + done) % 18) + 1;
  return { currentHole: next, finished: false };
}
