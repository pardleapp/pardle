import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getFeedBundle } from "@/lib/feed/store";
import { getSkillDecompositions } from "@/lib/golf-api/datagolf";

export const dynamic = "force-dynamic";

/**
 * GET /api/player/season?playerId=X
 *
 * Returns a player's current-season strokes-gained decomposition from
 * DataGolf's bayesian skill ratings — what we use throughout the rest
 * of the app for the round-score model's skill prior.
 *
 * The route id from the URL is the PGA Tour orchestrator's playerId
 * (numeric). DataGolf keys its own rows by dg_id, so we reconcile via
 * name: look the player up in the active tournament's leaderboard for
 * a displayName, then match against the DG skill-ratings list. This
 * is the same name-based pattern lib/feed/skill-cache.ts uses to fold
 * DG's ratings into the orchestrator-keyed skill map.
 *
 * Returns 404 with { found: false } when the player isn't on the
 * active leaderboard or DG doesn't carry them — the client renders an
 * empty state rather than someone else's stats.
 */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const playerId = url.searchParams.get("playerId");
    if (!playerId || !ID_RE.test(playerId)) {
      return NextResponse.json({ error: "bad-playerId" }, { status: 400 });
    }

    const active = await getActiveTournament().catch(() => null);
    if (!active) {
      return NextResponse.json({ found: false, reason: "no-tournament" });
    }

    const bundle = await getFeedBundle(active.tournament.id);
    const row = bundle.leaderboard.find((r) => r.playerId === playerId);
    if (!row) {
      return NextResponse.json({ found: false, reason: "not-on-leaderboard" });
    }

    const dg = await getSkillDecompositions().catch(
      () => [] as Awaited<ReturnType<typeof getSkillDecompositions>>,
    );
    if (dg.length === 0) {
      return NextResponse.json({ found: false, reason: "dg-unavailable" });
    }

    const target = normalizeName(row.displayName);
    const hit = dg.find((r) => normalizeName(r.name) === target);
    if (!hit) {
      return NextResponse.json({ found: false, reason: "no-dg-match" });
    }

    return NextResponse.json({
      found: true,
      playerId,
      displayName: row.displayName,
      season: {
        sgTotal: hit.sgTotal,
        sgOtt: hit.sgOtt,
        sgApp: hit.sgApp,
        sgArg: hit.sgArg,
        sgPutt: hit.sgPutt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server-error" },
      { status: 500 },
    );
  }
}
