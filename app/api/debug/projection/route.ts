/**
 * GET /api/debug/projection?name=kitayama
 *
 * One-shot diagnostic to compare what our top-finish model thinks
 * about a player vs what DataGolf publishes. Hits the same pipeline
 * /api/feed uses, then pulls out the named player's skill input,
 * projection (mean / variance / SD), and the model's top-5/10/20.
 *
 * Also runs a "what-if" Monte Carlo where every projection variance
 * is halved, to test whether our field-wide variance is the reason
 * we're flatter than DG.
 */
import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getFeedBundle } from "@/lib/feed/store";
import { ensurePlayerSkill } from "@/lib/feed/skill-cache";
import {
  simulateTopFinish,
  type TopFinishProbs,
} from "@/lib/feed/top-finish-model";

export const dynamic = "force-dynamic";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = (url.searchParams.get("name") ?? "").toLowerCase();
  if (!query) {
    return NextResponse.json(
      { error: "Pass ?name=<substring>" },
      { status: 400 },
    );
  }

  const active = await getActiveTournament();
  if (!active) {
    return NextResponse.json({ error: "No active tournament" }, { status: 404 });
  }
  const tournament = active.tournament;

  // We re-use the live feed's internal output so we're inspecting
  // exactly what the UI sees, not a divergent debug pipeline.
  const feedRes = await fetch(
    `${url.origin}/api/feed?debug=1`,
    { cache: "no-store" },
  );
  if (!feedRes.ok) {
    return NextResponse.json(
      { error: "feed-fetch-failed", status: feedRes.status },
      { status: 500 },
    );
  }
  const feed = (await feedRes.json()) as {
    playerIndex: Array<{
      playerId: string;
      displayName: string;
      position?: string;
      total?: number;
      thru?: number | string;
    }>;
    tournamentProjections: Record<
      string,
      { mean: number; variance: number; active: boolean }
    >;
    topFinishCurrent?: Record<string, TopFinishProbs>;
  };

  const bundle = await getFeedBundle(tournament.id);
  const skillMap = await ensurePlayerSkill(tournament.id, bundle.leaderboard);
  const snap = bundle.snapshot;
  const pars = bundle.pars;

  // Substring match by lower-cased displayName.
  const matches = feed.playerIndex.filter((p) =>
    p.displayName.toLowerCase().includes(query),
  );
  if (matches.length === 0) {
    return NextResponse.json({
      error: "no-match",
      query,
      sampleNames: feed.playerIndex.slice(0, 10).map((p) => p.displayName),
    });
  }

  const projections = feed.tournamentProjections;
  const top = feed.topFinishCurrent ?? {};

  // What-if MC: halve every projection's variance, re-simulate, and
  // see how the matched player's probs move. If they jump close to
  // DataGolf's published numbers, that's the smoking gun.
  const halved: Record<
    string,
    { mean: number; variance: number; active: boolean }
  > = {};
  for (const [pid, p] of Object.entries(projections)) {
    halved[pid] = { mean: p.mean, variance: p.variance * 0.5, active: p.active };
  }
  const halvedProbs = simulateTopFinish(halved, 5000);

  const report = matches.map((p) => {
    const proj = projections[p.playerId];
    const sg = skillMap[p.playerId];
    const sd = proj ? Math.sqrt(proj.variance) : null;
    // Raw snapshot slice + per-round score detection. This is the
    // smoking-gun view: if R2/R3/R4 entries are present with par-like
    // strokes, the model treats them as already played and variance
    // collapses to zero.
    const byRound = snap?.holes?.[p.playerId] ?? {};
    const roundBreakdown: Array<{
      round: number;
      parsLoaded: boolean;
      parsCount: number;
      snapshotEntries: number;
      snapshotSample: Record<string, string>;
      detectedHolesPlayed: number;
      detectedHolesRemaining: number;
      detectedStrokes: number;
    }> = [];
    for (let r = 1; r <= 4; r++) {
      const rp = (pars?.[r] ?? {}) as Record<string, number>;
      const rh = (byRound?.[r] ?? {}) as Record<string, string>;
      const entries = Object.entries(rh);
      let played = 0;
      let remaining = 0;
      let strokes = 0;
      for (const [hStr, _par] of Object.entries(rp)) {
        const scoreStr = rh[hStr];
        const isPlayed =
          scoreStr != null &&
          scoreStr !== "" &&
          scoreStr !== "-" &&
          Number.isFinite(Number(scoreStr));
        if (isPlayed) {
          played++;
          strokes += Number(scoreStr);
        } else {
          remaining++;
        }
      }
      roundBreakdown.push({
        round: r,
        parsLoaded: Object.keys(rp).length > 0,
        parsCount: Object.keys(rp).length,
        snapshotEntries: entries.length,
        snapshotSample: Object.fromEntries(entries.slice(0, 4)) as Record<
          string,
          string
        >,
        detectedHolesPlayed: played,
        detectedHolesRemaining: remaining,
        detectedStrokes: strokes,
      });
    }
    return {
      playerId: p.playerId,
      displayName: p.displayName,
      normalizedKey: normalizeName(p.displayName),
      position: p.position,
      total: p.total,
      thru: p.thru,
      skill: {
        sg_total_per_round: sg ?? null,
        found_in_cache: sg !== undefined,
      },
      projection: proj
        ? {
            mean: Number(proj.mean.toFixed(2)),
            variance: Number(proj.variance.toFixed(2)),
            sd: sd != null ? Number(sd.toFixed(2)) : null,
            active: proj.active,
          }
        : null,
      currentModel: top[p.playerId]
        ? {
            top5: Number((top[p.playerId].top5 * 100).toFixed(2)),
            top10: Number((top[p.playerId].top10 * 100).toFixed(2)),
            top20: Number((top[p.playerId].top20 * 100).toFixed(2)),
          }
        : null,
      ifVarianceHalved: halvedProbs[p.playerId]
        ? {
            top5: Number((halvedProbs[p.playerId].top5 * 100).toFixed(2)),
            top10: Number((halvedProbs[p.playerId].top10 * 100).toFixed(2)),
            top20: Number((halvedProbs[p.playerId].top20 * 100).toFixed(2)),
          }
        : null,
      roundBreakdown,
    };
  });

  return NextResponse.json({
    tournament: { id: tournament.id, name: tournament.name },
    query,
    matchCount: matches.length,
    skillCacheSize: Object.keys(skillMap).length,
    activeFieldSize: Object.values(projections).filter((p) => p.active)
      .length,
    matches: report,
  });
}
