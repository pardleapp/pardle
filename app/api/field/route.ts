/**
 * /api/field — entrants list for the active/upcoming tournament.
 * Used by /leaderboard pre-tournament so the page can show the real
 * Memorial field tonight, before round 1 publishes the orchestrator
 * leaderboard. Once play starts /leaderboard prefers the live
 * leaderboard from /api/feed and this route is only the cold-start
 * fallback.
 *
 * Source: DataGolf /field-updates (PGA tour). Server-only because of
 * the API key.
 */

import { NextResponse } from "next/server";
import { getFieldForActiveEvent } from "@/lib/golf-api/datagolf";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface FieldRow {
  dgId: string;
  name: string;
  country?: string;
}

export async function GET() {
  try {
    const field = await getFieldForActiveEvent("pga");
    const rows: FieldRow[] = field.map((f) => ({
      dgId: f.dgId,
      name: f.name,
      country: f.country,
    }));
    return NextResponse.json({
      ok: true,
      field: rows,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        field: [] as FieldRow[],
      },
      { status: 200 }, // soft-fail; UI falls back to whatever it has
    );
  }
}
