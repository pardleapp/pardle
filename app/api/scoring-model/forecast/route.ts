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

/** Pull every field member's target-round tee time from the /field
 *  endpoint (which already merges DG teetimes with the leaderboard).
 *  Returns fractional local hours. Empty when unavailable. */
async function fetchFieldTeeHours(
  tournamentId: string,
  targetRound: 1 | 2 | 3 | 4,
  originUrl: string,
): Promise<number[]> {
  try {
    const url = `${originUrl.replace(/\/$/, "")}/api/scoring-model/field`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      tournamentId?: string | null;
      players?: Array<{
        teeTimes?: Record<string, string | undefined>;
      }>;
    };
    if (j.tournamentId !== tournamentId) return [];
    const out: number[] = [];
    for (const p of j.players ?? []) {
      const tt = p.teeTimes?.[String(targetRound)];
      if (!tt) continue;
      const m = tt.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) continue;
      const hr = Number(m[1]);
      const min = Number(m[2]);
      if (
        !Number.isFinite(hr) ||
        !Number.isFinite(min) ||
        hr < 0 ||
        hr > 23 ||
        min < 0 ||
        min > 59
      ) {
        continue;
      }
      out.push(hr + min / 60);
    }
    return out;
  } catch {
    return [];
  }
}

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
    autoYardageAndPins: body.autoYardageAndPins,
    autoYardage: body.autoYardage,
    autoPins: body.autoPins,
    yardsDeltaFromRound: body.yardsDeltaFromRound,
    pinDifficultyAdder: body.pinDifficultyAdder,
    windOverride: body.windOverride,
    useHrrr: body.useHrrr,
    // Field-wide tee times auto-fetched when the caller doesn't
    // supply them, so the field forecast walks HRRR per hole at
    // when the average field member plays each hole rather than
    // a naive day-average.
    fieldTeeHoursLocal:
      body.fieldTeeHoursLocal ??
      (await fetchFieldTeeHours(tournamentId, targetRound, originUrl)),
    levelShiftMode: body.levelShiftMode,
    levelShiftAttenuation: body.levelShiftAttenuation,
    priorRounds,
    players: body.players,
  });

  if (!("ok" in result) || !result.ok) {
    // A "new venue" result is not a server error — the model just
    // hasn't been trained on this course yet. Surface as 200 so the
    // UI can render a friendly state without an error banner.
    const status = "newVenue" in result && result.newVenue ? 200 : 500;
    return NextResponse.json(result, { status });
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
        "Array<{ name, sgTotal, compressionFactor?, skewAdjustment?, weekRounds?, weekRoundsSg?: Array<{ sgOtt?, sgApp?, sgArg?, sgPutt? } | null>, formWeight? }>",
    },
  });
}
