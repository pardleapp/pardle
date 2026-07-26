/**
 * POST /api/scoring-model/forecast
 *
 * Round score forecast tool. Accepts flexible inputs — pin clusters,
 * yardages, wind override, level-shift mode, pin-difficulty adder,
 * player list with form data — and returns:
 *   - Field score forecast (mean vs par)
 *   - Per-hole breakdown
 *   - Per-player expected mean/median with skill + form + skew
 *
 * See lib/scoring-model/forecast.ts for the input/output shapes.
 */

import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import {
  runForecast,
  fetchPriorRoundObservations,
  type ForecastInputs,
} from "@/lib/scoring-model/forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  let body: Partial<ForecastInputs>;
  try {
    body = (await req.json()) as Partial<ForecastInputs>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  // Default tournamentId to the currently-active event when the
  // caller omits it — the tool is meant for "forecast this week".
  let tournamentId = body.tournamentId;
  if (!tournamentId) {
    const active = await getActiveTournament().catch(() => null);
    tournamentId = active?.tournament?.id ?? undefined;
  }
  if (!tournamentId) {
    return NextResponse.json(
      { ok: false, error: "no tournamentId (and no active tournament)" },
      { status: 400 },
    );
  }

  const targetRound = body.targetRound;
  if (
    targetRound !== 1 &&
    targetRound !== 2 &&
    targetRound !== 3 &&
    targetRound !== 4
  ) {
    return NextResponse.json(
      { ok: false, error: "targetRound must be 1, 2, 3, or 4" },
      { status: 400 },
    );
  }

  const originUrl = new URL(req.url).origin;

  // Auto-fetch prior-round observations when the caller didn't supply
  // them — makes the tool "just work" for typical use.
  let priorRounds = body.priorRounds;
  if (!priorRounds || Object.keys(priorRounds).length === 0) {
    priorRounds = await fetchPriorRoundObservations(
      tournamentId,
      originUrl,
      targetRound,
    );
  }

  const result = await runForecast({
    tournamentId,
    targetRound,
    originUrl,
    holes: body.holes,
    pinDifficultyAdder: body.pinDifficultyAdder,
    windOverride: body.windOverride,
    useHrrr: body.useHrrr,
    levelShiftMode: body.levelShiftMode,
    levelShiftAttenuation: body.levelShiftAttenuation,
    priorRounds,
    players: body.players,
  });

  if (!("ok" in result) || !result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}

export async function GET() {
  // Convenience: return the tool's contract so the UI can render an
  // "expected inputs" panel without a JSON schema file.
  return NextResponse.json({
    ok: true,
    method: "POST",
    contract: {
      tournamentId: "string (optional; defaults to active tournament)",
      targetRound: "1 | 2 | 3 | 4",
      holes: "Record<number, { cluster?: string, yards?: number }>",
      pinDifficultyAdder: "number (strokes total for the round)",
      windOverride: "{ windMph, windDirDeg } (optional; else HRRR)",
      useHrrr: "boolean (default true)",
      levelShiftMode:
        "'average' | 'most-recent' | 'most-recent-post-cut' (default auto)",
      levelShiftAttenuation:
        "number 0-1 (default 1.0; 0 = ignore level shift)",
      priorRounds: "auto-fetched when omitted",
      players:
        "Array<{ name, sgTotal, compressionFactor?, skewAdjustment?, weekRounds?, formWeight? }>",
    },
  });
}
