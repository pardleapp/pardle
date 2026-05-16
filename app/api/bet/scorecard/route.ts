import { NextResponse } from "next/server";
import { getActiveTournament, getScorecards } from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";

/**
 * GET /api/bet/scorecard?playerId=X&round=N
 *
 * Targeted single-player scorecard for the bet detail page. The main
 * /api/feed events list is capped at 1000 entries and a busy tournament
 * day rolls past that within a few hours, so early-round score events
 * get LTRIM'd off and the bet's PnL chart can't see them. The
 * orchestrator scorecard is authoritative — every played hole is in
 * the response — so for the round-score chart we read it directly.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const playerId = url.searchParams.get("playerId");
    const roundStr = url.searchParams.get("round");
    if (!playerId || !roundStr) {
      return NextResponse.json(
        { error: "missing-params" },
        { status: 400 },
      );
    }
    const round = Number(roundStr);
    if (!Number.isInteger(round) || round < 1 || round > 4) {
      return NextResponse.json({ error: "bad-round" }, { status: 400 });
    }

    const active = await getActiveTournament();
    if (!active) {
      return NextResponse.json({ holes: [], roundPar: 0 });
    }

    const cards = await getScorecards(active.tournament.id, [playerId]);
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

    return NextResponse.json({ holes: ordered, roundPar });
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
