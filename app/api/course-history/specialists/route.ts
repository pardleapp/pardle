/**
 * GET /api/course-history/specialists?min=8
 *
 * Global course-fit table across every venue in the archive. For each
 * (player, course) pair with rounds >= min, returns the outperformance
 * (at-course SG:OTT+APP − trailing-50 baseline). Fans out per-course
 * aggregate lookups — mostly Redis-cached hits, so warm-path response
 * is fast.
 *
 * Client uses this to render "best specialists" and "worst drags"
 * tables independent of any single course pick.
 */

import { NextResponse } from "next/server";
import {
  getCuratedCourses,
  getCourseHistoryByCourse,
} from "@/lib/course-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// On warm cache this is ~84 Redis GETs (~1s). Cold cache would fan
// out per-course rebuilds; give it headroom.
export const maxDuration = 300;

interface Row {
  dgId: number;
  name: string;
  course: string;
  rounds: number;
  years: number;
  atCombined: number;
  baselineCombined: number;
  outperformance: number;
  outperformanceOtt: number;
  outperformanceApp: number;
  currentSkillOttApp: number | null;
  skillDrift: number | null;
}

// Rows with |skillDrift| above this threshold get filtered out when
// hideDrift=1, because the outperformance signal is contaminated by
// a change in the player's underlying skill (breakout or decline)
// rather than genuine course fit.
const DRIFT_THRESHOLD = 1.0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minRounds = Math.max(1, Number(url.searchParams.get("min") ?? 8) || 8);
  // Default: hide skill-drift rows (breakouts + declines). Client can
  // opt in to the noisy view by passing hideDrift=0.
  const hideDrift = url.searchParams.get("hideDrift") !== "0";
  try {
    const courses = await getCuratedCourses();
    // Fetch aggregates in parallel — Redis hits are cheap and
    // independent. Any course that fails just contributes nothing to
    // the result rather than failing the whole endpoint.
    const results = await Promise.all(
      courses.map((c) =>
        getCourseHistoryByCourse(c.courseName).catch(() => null),
      ),
    );
    const rows: Row[] = [];
    let driftFiltered = 0;
    for (const r of results) {
      if (!r || !r.players) continue;
      for (const p of r.players) {
        if ((p.roundsPlayed ?? 0) < minRounds) continue;
        if (
          hideDrift &&
          p.skillDrift != null &&
          Math.abs(p.skillDrift) > DRIFT_THRESHOLD
        ) {
          driftFiltered++;
          continue;
        }
        rows.push({
          dgId: p.dgId,
          name: p.name,
          course: r.courseName,
          rounds: p.roundsPlayed,
          years: p.yearsPlayed,
          atCombined: p.atCourseCombined,
          baselineCombined: p.baselineCombined,
          outperformance: p.outperformanceCombined,
          outperformanceOtt: p.outperformanceSgOtt,
          outperformanceApp: p.outperformanceSgApp,
          currentSkillOttApp: p.currentSkillOttApp,
          skillDrift: p.skillDrift,
        });
      }
    }
    rows.sort((a, b) => b.outperformance - a.outperformance);
    return NextResponse.json({
      ok: true,
      minRounds,
      hideDrift,
      driftThreshold: DRIFT_THRESHOLD,
      totalPairs: rows.length,
      driftFiltered,
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "failed to load specialists",
      },
      { status: 500 },
    );
  }
}
