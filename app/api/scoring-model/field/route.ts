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

const DG_BASE = "https://feeds.datagolf.com";

/** DG skill-ratings — universal baseline SG per player, refreshed
 *  weekly. Falls back for players who aren't in the event-specific
 *  decomposition CSV (currently keyed to a different tournament). */
async function loadDgSkillRatings(): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const key = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  if (!key) return out;
  try {
    const url = `${DG_BASE}/preds/skill-ratings?display=value&key=${encodeURIComponent(key)}&file_format=json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return out;
    const j = (await res.json()) as {
      players?: Array<{ dg_id?: number; sg_total?: number }>;
    };
    for (const p of j.players ?? []) {
      if (p.dg_id != null && typeof p.sg_total === "number") {
        out.set(p.dg_id, p.sg_total);
      }
    }
  } catch {
    /* skip */
  }
  return out;
}

/** DG field-updates → per-round tee times per player. Same data
 *  source the tee-time-scoring API uses. Returns a map keyed by
 *  dg_id → { round → HH:MM }. */
async function loadDgTeeTimes(): Promise<
  Map<number, Partial<Record<1 | 2 | 3 | 4, string>>>
> {
  const out = new Map<number, Partial<Record<1 | 2 | 3 | 4, string>>>();
  const key = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  if (!key) return out;
  try {
    const url = `${DG_BASE}/field-updates?tour=pga&key=${encodeURIComponent(key)}&file_format=json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return out;
    const j = (await res.json()) as {
      field?: Array<{
        dg_id?: number;
        teetimes?: Array<{ round_num?: number; teetime?: string }>;
      }>;
    };
    for (const p of j.field ?? []) {
      if (!p.dg_id) continue;
      const perRound: Partial<Record<1 | 2 | 3 | 4, string>> = {};
      for (const t of p.teetimes ?? []) {
        if (t.round_num == null || !t.teetime) continue;
        const r = t.round_num as 1 | 2 | 3 | 4;
        // Support "YYYY-MM-DD HH:MM" and "HH:MM" alike.
        const m = t.teetime.match(/(\d{2}):(\d{2})/);
        if (m) perRound[r] = `${m[1]}:${m[2]}`;
      }
      out.set(p.dg_id, perRound);
    }
  } catch {
    /* DG unavailable — no tee times, model falls back to day avg */
  }
  return out;
}

/** Map orchestrator playerId (`player_num` in DG's field-updates) to
 *  DG dg_id. Needs a second fetch of the field payload. */
async function loadPgaIdToDgId(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const key = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  if (!key) return out;
  try {
    const url = `${DG_BASE}/field-updates?tour=pga&key=${encodeURIComponent(key)}&file_format=json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return out;
    const j = (await res.json()) as {
      field?: Array<{ dg_id?: number; player_num?: number | string }>;
    };
    for (const p of j.field ?? []) {
      if (p.dg_id != null && p.player_num != null) {
        out.set(String(p.player_num), p.dg_id);
      }
    }
  } catch {
    /* skip */
  }
  return out;
}

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

  const [leaderboard, csvSg, dgTeeTimes, pgaToDg, dgSkillByDgId] =
    await Promise.all([
      getLeaderboard(tournamentId).catch(() => []),
      loadCsvSg(),
      loadDgTeeTimes(),
      loadPgaIdToDgId(),
      loadDgSkillRatings(),
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
    /** Tee times per round, "HH:MM" local. Empty when unavailable. */
    teeTimes: Partial<Record<1 | 2 | 3 | 4, string>>;
  }

  const players: Player[] = [];
  for (const lb of leaderboard) {
    // SG priority chain:
    //   1. Event-specific CSV (final_prediction) if the player is in it
    //   2. Universal DG skill-ratings sg_total via dg_id lookup
    //   3. null (UI shows empty; user can type manually)
    let sg = sgByNorm.get(normalise(lb.displayName)) ?? null;
    if (sg == null) {
      const dgId = pgaToDg.get(lb.playerId);
      if (dgId != null) {
        const dgSg = dgSkillByDgId.get(dgId);
        if (typeof dgSg === "number") sg = dgSg;
      }
    }
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
    const dgId = pgaToDg.get(lb.playerId);
    const teeTimes = dgId != null ? dgTeeTimes.get(dgId) ?? {} : {};
    players.push({
      id: lb.playerId,
      name: lb.displayName,
      sgTotal: sg,
      position: lb.position,
      total: lb.total,
      thru: lb.thru,
      playerState: lb.playerState,
      weekRounds,
      teeTimes,
    });
  }

  return NextResponse.json({
    ok: true,
    tournamentId,
    tournamentName,
    players: players.sort((a, b) => a.name.localeCompare(b.name)),
  });
}
