/**
 * GET /api/scoring-model/field
 *
 * Returns the roster the forecast tool's player-picker uses:
 *   - Current tournament id + label
 *   - Player list with pre-tournament SG total (from DG decomposition
 *     CSV bundled in-repo) merged with this week's actual round scores
 *     (from the live leaderboard) so the tool can auto-fill both the
 *     baseline SG and the "week rounds" form input.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getActiveTournament,
  getLeaderboard,
  getScorecards,
  type PGAScorecard,
} from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface CsvLine {
  name: string;
  finalPrediction: number;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadCsvSg(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const p = path.join(
      process.cwd(),
      "data",
      "dg-open-decomposition.csv",
    );
    const txt = await readFile(p, "utf-8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return map;
    const header = parseCsvLine(lines[0]);
    const nameIdx = header.indexOf("player_name");
    const finalIdx = header.indexOf("final_prediction");
    if (nameIdx < 0 || finalIdx < 0) return map;
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const name = cells[nameIdx];
      const fp = Number(cells[finalIdx]);
      if (name && Number.isFinite(fp)) map.set(name, fp);
    }
  } catch {
    /* file missing — empty map is fine */
  }
  return map;
}

/** Normalise "Last, First" ↔ "First Last" so DG's CSV format and
 *  the orchestrator's displayName both match. */
function normalise(name: string): string {
  const trim = name.trim();
  // "Last, First" → "First Last"
  if (trim.includes(",")) {
    const [last, first] = trim.split(",").map((s) => s.trim());
    return `${first} ${last}`.toLowerCase();
  }
  return trim.toLowerCase();
}

export async function GET() {
  const active = await getActiveTournament().catch(() => null);
  const tournamentId = active?.tournament?.id ?? null;
  const tournamentName = active?.tournament?.name ?? null;
  if (!tournamentId) {
    return NextResponse.json({
      ok: true,
      tournamentId: null,
      tournamentName: null,
      players: [],
    });
  }

  const [leaderboard, csvSg] = await Promise.all([
    getLeaderboard(tournamentId).catch(() => []),
    loadCsvSg(),
  ]);

  // Build normalised name → SG lookup once
  const sgByNorm = new Map<string, number>();
  for (const [name, sg] of csvSg) {
    sgByNorm.set(normalise(name), sg);
  }

  // Pull per-round scores for every player in the field so the tool
  // can auto-populate the "week rounds" input.
  const playerIds = leaderboard.map((r) => r.playerId).filter(Boolean);
  const scorecards = await getScorecards(tournamentId, playerIds).catch(
    () => ({} as Record<string, PGAScorecard>),
  );

  interface Player {
    id: string;
    name: string;
    sgTotal: number | null;
    position: string;
    total: string;
    thru: string;
    playerState: string;
    weekRounds: number[]; // completed rounds' vs-par scores
  }

  const players: Player[] = [];
  for (const lb of leaderboard) {
    const sg = sgByNorm.get(normalise(lb.displayName)) ?? null;
    const sc = scorecards[lb.playerId];
    const weekRounds: number[] = [];
    if (sc?.rounds) {
      for (const [rStr, holes] of Object.entries(sc.rounds)) {
        const r = Number(rStr);
        if (!Number.isFinite(r)) continue;
        // Only count fully-completed rounds (all 18 holes scored).
        const played = holes.filter((h) => {
          const s = Number(h.score);
          return Number.isFinite(s) && s > 0;
        });
        if (played.length < 18) continue;
        let strokes = 0;
        let par = 0;
        for (const h of played) {
          strokes += Number(h.score);
          par += h.par;
        }
        weekRounds.push(strokes - par);
      }
      // Rounds come back in insertion order, roughly R1 → R4.
    }
    players.push({
      id: lb.playerId,
      name: lb.displayName,
      sgTotal: sg,
      position: lb.position,
      total: lb.total,
      thru: lb.thru,
      playerState: lb.playerState,
      weekRounds,
    });
  }

  return NextResponse.json({
    ok: true,
    tournamentId,
    tournamentName,
    players: players.sort((a, b) => a.name.localeCompare(b.name)),
  });
}
