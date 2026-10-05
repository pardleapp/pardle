/**
 * POST /api/dpwt/scoring-model/forecast
 *
 * DP World Tour version of /api/scoring-model/forecast. The model is
 * shared: runForecast resolves "D…" tournament ids to the DP World Tour
 * history, pins and weather. This route only swaps the default event
 * and the field endpoint used for tee times.
 */
import { NextResponse } from "next/server";
import { runForecast, fetchPriorRoundObservations, type ForecastInputs } from "@/lib/scoring-model/forecast";
import { getDpwtActive } from "@/lib/dpwt/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fieldTeeHours(tournamentId: string, targetRound: number, originUrl: string): Promise<number[]> {
  try {
    const res = await fetch(`${originUrl}/api/dpwt/scoring-model/field`, { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { tournamentId?: string | null; players?: Array<{ teeTimes?: Record<string, string | undefined> }> };
    if (j.tournamentId !== tournamentId) return [];
    const out: number[] = [];
    for (const p of j.players ?? []) {
      const m = p.teeTimes?.[String(targetRound)]?.match(/^(\d{1,2}):(\d{2})$/);
      if (m) out.push(Number(m[1]) + Number(m[2]) / 60);
    }
    return out;
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  let body: Partial<ForecastInputs>;
  try {
    body = (await req.json()) as Partial<ForecastInputs>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const tournamentId = body.tournamentId ?? (await getDpwtActive())?.tournamentId;
  if (!tournamentId) return NextResponse.json({ ok: false, error: "no tournamentId (and no active tournament)" }, { status: 400 });
  const targetRound = body.targetRound;
  if (targetRound !== 1 && targetRound !== 2 && targetRound !== 3 && targetRound !== 4) {
    return NextResponse.json({ ok: false, error: "targetRound must be 1, 2, 3, or 4" }, { status: 400 });
  }
  const originUrl = new URL(req.url).origin;
  const priorRounds =
    body.priorRounds && Object.keys(body.priorRounds).length
      ? body.priorRounds
      : await fetchPriorRoundObservations(tournamentId, originUrl, targetRound);
  const result = await runForecast({
    tournamentId,
    targetRound,
    originUrl,
    holes: body.holes,
    autoYardageAndPins: body.autoYardageAndPins,
    autoYardage: body.autoYardage,
    autoPins: body.autoPins,
    yardsDeltaFromRound: body.yardsDeltaFromRound,
    pinDifficultyAdder: body.pinDifficultyAdder,
    windOverride: body.windOverride,
    useHrrr: body.useHrrr,
    fieldTeeHoursLocal: body.fieldTeeHoursLocal ?? (await fieldTeeHours(tournamentId, targetRound, originUrl)),
    levelShiftMode: body.levelShiftMode,
    levelShiftAttenuation: body.levelShiftAttenuation,
    priorRounds,
    players: body.players,
  });
  if (!("ok" in result) || !result.ok) {
    const status = "newVenue" in result && result.newVenue ? 200 : 500;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
