import { NextResponse } from "next/server";
import { getActiveTournament, getScorecards } from "@/lib/golf-api/pgatour";
import {
  computeFieldStats,
  getFeedBundle,
} from "@/lib/feed/store";
import { ensurePlayerSkill } from "@/lib/feed/skill-cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/bet/scorecard?playerId=X&round=N[&tournamentId=Y]
 *
 * Targeted single-player scorecard for the bet detail page. The main
 * /api/feed events list is capped at 1000 entries and a busy tournament
 * day rolls past that within a few hours, so early-round score events
 * get LTRIM'd off and the bet's PnL chart can't see them. The
 * orchestrator scorecard is authoritative — every played hole is in
 * the response — so for the round-score chart we read it directly.
 *
 * Pass tournamentId for past-tournament bet replays — without it, the
 * route falls back to whichever tournament is currently active, which
 * is the wrong tournament for any historical round-score chart.
 */
/** PGA Tour player + tournament IDs are alphanumeric tokens with
 *  occasional dashes/underscores. Reject anything else so user-
 *  supplied values can't smuggle quotes or braces into the GraphQL
 *  string the orchestrator client builds. The orchestrator may have
 *  field-level guards, but defence-in-depth: validate at the API
 *  boundary too. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const playerId = url.searchParams.get("playerId");
    const roundStr = url.searchParams.get("round");
    const tournamentIdOverride = url.searchParams.get("tournamentId");
    if (!playerId || !roundStr) {
      return NextResponse.json(
        { error: "missing-params" },
        { status: 400 },
      );
    }
    if (!ID_RE.test(playerId)) {
      return NextResponse.json({ error: "bad-playerId" }, { status: 400 });
    }
    if (tournamentIdOverride && !ID_RE.test(tournamentIdOverride)) {
      return NextResponse.json(
        { error: "bad-tournamentId" },
        { status: 400 },
      );
    }
    const round = Number(roundStr);
    if (!Number.isInteger(round) || round < 1 || round > 4) {
      return NextResponse.json({ error: "bad-round" }, { status: 400 });
    }

    let tournamentId: string;
    if (tournamentIdOverride) {
      tournamentId = tournamentIdOverride;
    } else {
      const active = await getActiveTournament();
      if (!active) {
        return NextResponse.json({ holes: [], roundPar: 0 });
      }
      tournamentId = active.tournament.id;
    }

    const cards = await getScorecards(tournamentId, [playerId]);
    const card = cards[playerId];
    if (!card) {
      return NextResponse.json({ holes: [], roundPar: 0 });
    }

    const all = card.rounds[round] ?? [];

    type Played = { holeNumber: number; par: number; strokes: number };
    const played: Played[] = [];
    let roundPar = 0;
    for (const h of all) {
      const p = Number(h.par) || 0;
      roundPar += p;
      const strokes = Number(h.score);
      if (Number.isFinite(strokes) && strokes > 0) {
        played.push({ holeNumber: h.holeNumber, par: p, strokes });
      }
    }

    // Order by completion. The scorecard array is sorted by hole
    // number (1..18), but players teeing off on 10 complete 10..18
    // before 1..9. Heuristic: if the back nine has any scores and the
    // front nine has none (or fewer), the player started on 10.
    const back9Played = played.filter((h) => h.holeNumber >= 10).length;
    const front9Played = played.filter((h) => h.holeNumber <= 9).length;
    const startedOnBack =
      (back9Played > 0 && front9Played === 0) ||
      (back9Played === 9 && front9Played < 9);

    const ordered = startedOnBack
      ? [
          ...played
            .filter((h) => h.holeNumber >= 10)
            .sort((a, b) => a.holeNumber - b.holeNumber),
          ...played
            .filter((h) => h.holeNumber <= 9)
            .sort((a, b) => a.holeNumber - b.holeNumber),
        ]
      : played.sort((a, b) => a.holeNumber - b.holeNumber);

    // Build the field stats + skill for the round-score chart's
    // hole-by-hole reconstruction. Same prior-round fallback ladder
    // as /api/feed: thin samples for this round use the same hole's
    // average from any earlier round before falling back to par.
    const bundle = await getFeedBundle(tournamentId);
    const fieldStats = computeFieldStats(bundle.snapshot, bundle.pars);
    const skillMap = await ensurePlayerSkill(
      tournamentId,
      bundle.leaderboard,
    );
    const skillPerHole = (skillMap[playerId] ?? 0) / 18;

    type HoleStat = { mean: number; variance: number };
    const MIN_SAMPLE = 10;
    const FALLBACK_VAR = 0.65;
    const holeStats: Record<number, HoleStat> = {};
    for (const h of all) {
      const s = fieldStats[round]?.[h.holeNumber];
      if (s && s.count >= MIN_SAMPLE) {
        holeStats[h.holeNumber] = { mean: s.mean, variance: s.variance };
        continue;
      }
      let resolved = false;
      for (let r = round - 1; r >= 1; r--) {
        const prior = fieldStats[r]?.[h.holeNumber];
        if (prior && prior.count >= MIN_SAMPLE) {
          holeStats[h.holeNumber] = {
            mean: prior.mean,
            variance: prior.variance,
          };
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        holeStats[h.holeNumber] = { mean: 0, variance: FALLBACK_VAR };
      }
    }

    // Remaining holes (unplayed) so the chart knows what's left to
    // project against. Same ordering: if the player teed off on 10,
    // we want completion order; otherwise 1→18.
    const playedSet = new Set(ordered.map((h) => h.holeNumber));
    const remaining = all
      .filter((h) => !playedSet.has(h.holeNumber))
      .map((h) => ({ holeNumber: h.holeNumber, par: Number(h.par) || 0 }));

    return NextResponse.json({
      holes: ordered,
      remaining,
      roundPar,
      holeStats,
      skillPerHole,
    });
  } catch (err) {
    console.error("[bet/scorecard]", err);
    return NextResponse.json(
      {
        error: "fetch-failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
