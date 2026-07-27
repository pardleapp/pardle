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
import { getFullLiveStats } from "@/lib/golf-api/datagolf";
import type { RoundSgBreakdown } from "@/lib/scoring-model/forecast";

const DG_BASE = "https://feeds.datagolf.com";

/** DG per-round SG breakdown per player, for rounds 1-4. Each call
 *  to /preds/live-tournament-stats returns one round's SG numbers
 *  for every player currently in the field. We fan out the round
 *  fetches in parallel, then transpose into a per-dgId map. Any
 *  round that hasn't started (or returns empty) simply produces no
 *  entry for that round in the inner map. */
async function loadDgLiveSgByRound(): Promise<
  Map<number, Partial<Record<1 | 2 | 3 | 4, RoundSgBreakdown>>>
> {
  const out = new Map<
    number,
    Partial<Record<1 | 2 | 3 | 4, RoundSgBreakdown>>
  >();
  const rounds: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
  const perRound = await Promise.all(
    rounds.map((r) =>
      getFullLiveStats(r).catch(() => [] as Awaited<
        ReturnType<typeof getFullLiveStats>
      >),
    ),
  );
  perRound.forEach((rows, idx) => {
    const r = rounds[idx];
    for (const row of rows) {
      const dgIdNum = Number(row.dgId);
      if (!Number.isFinite(dgIdNum)) continue;
      // Skip rows with zero signal — the DG endpoint returns entries
      // for players who haven't started this round yet with all-null
      // SG. Storing those would just noise up the persistence math.
      const anySig =
        row.sgOtt != null ||
        row.sgApp != null ||
        row.sgArg != null ||
        row.sgPutt != null;
      if (!anySig) continue;
      const existing = out.get(dgIdNum) ?? {};
      existing[r] = {
        sgOtt: row.sgOtt,
        sgApp: row.sgApp,
        sgArg: row.sgArg,
        sgPutt: row.sgPutt,
      };
      out.set(dgIdNum, existing);
    }
  });
  return out;
}

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

  const [
    leaderboard,
    csvSg,
    dgTeeTimes,
    pgaToDg,
    dgSkillByDgId,
    dgSgByRound,
  ] = await Promise.all([
    getLeaderboard(tournamentId).catch(() => []),
    loadCsvSg(),
    loadDgTeeTimes(),
    loadPgaIdToDgId(),
    loadDgSkillRatings(),
    loadDgLiveSgByRound().catch(
      () => new Map<
        number,
        Partial<Record<1 | 2 | 3 | 4, RoundSgBreakdown>>
      >(),
    ),
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
    /** Where sgTotal came from — event-specific means the CSV
     *  `final_prediction`, which already includes DataGolf's course-
     *  fit adjustment for THIS event. season-generic means the
     *  fallback universal skill rating, no course fit applied. Drives
     *  the compression-factor default in the model. */
    sgSource: "event-specific" | "season-generic" | null;
    position: string;
    total: string;
    thru: string;
    playerState: string;
    weekRounds: number[]; // completed rounds' vs-par scores
    /** Per-round SG breakdown (index-aligned with weekRounds) so the
     *  model can persistence-weight each round's form contribution.
     *  Entries can be null when DG hasn't posted SG for that round
     *  yet even though the round is complete. */
    weekRoundsSg: Array<RoundSgBreakdown | null>;
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
    let sgSource: "event-specific" | "season-generic" | null =
      sg != null ? "event-specific" : null;
    if (sg == null) {
      const dgId = pgaToDg.get(lb.playerId);
      if (dgId != null) {
        const dgSg = dgSkillByDgId.get(dgId);
        if (typeof dgSg === "number") {
          sg = dgSg;
          sgSource = "season-generic";
        }
      }
    }
    const sc = scorecards[lb.playerId];
    const weekRounds: number[] = [];
    const completedRoundNums: Array<1 | 2 | 3 | 4> = [];
    if (sc?.rounds) {
      // Collect (round, vs-par) tuples so we can pair with DG SG by
      // ROUND NUMBER, not by array index (defensive against a rounds
      // dict that iterates non-sequentially).
      const collected: Array<{ round: 1 | 2 | 3 | 4; vsPar: number }> = [];
      for (const [rStr, holes] of Object.entries(sc.rounds)) {
        const r = Number(rStr);
        if (!Number.isFinite(r) || r < 1 || r > 4) continue;
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
        collected.push({ round: r as 1 | 2 | 3 | 4, vsPar: strokes - par });
      }
      collected.sort((a, b) => a.round - b.round);
      for (const c of collected) {
        weekRounds.push(c.vsPar);
        completedRoundNums.push(c.round);
      }
    }
    const dgId = pgaToDg.get(lb.playerId);
    const teeTimes = dgId != null ? dgTeeTimes.get(dgId) ?? {} : {};
    const dgSgForPlayer = dgId != null ? dgSgByRound.get(dgId) : undefined;
    const weekRoundsSg: Array<RoundSgBreakdown | null> = completedRoundNums.map(
      (r) => dgSgForPlayer?.[r] ?? null,
    );
    players.push({
      id: lb.playerId,
      name: lb.displayName,
      sgTotal: sg,
      sgSource,
      position: lb.position,
      total: lb.total,
      thru: lb.thru,
      playerState: lb.playerState,
      weekRounds,
      weekRoundsSg,
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
