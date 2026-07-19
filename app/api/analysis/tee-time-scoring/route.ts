/**
 * /api/analysis/tee-time-scoring
 *
 * Fetches from DataGolf:
 *   - field-updates → R1 tee times per player
 *   - skill-ratings → sg_total (pre-tournament projection)
 *   - live-tournament-stats (round=1) → current R1 score-to-par
 *
 * Returns one row per player who has (a) a tee time, (b) a skill rating,
 * and (c) a live R1 score. Powers the scatter plot at
 * /analysis/tee-time-scoring.
 *
 * Skill-adjusted score = R1 score-to-par + sg_total.
 * A +2.5 SG player shooting −3 → adj = −0.5 (out-performed skill by 0.5).
 * A −1 SG player shooting +2 → adj = +1 (under-performed by 1).
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BASE = "https://feeds.datagolf.com";

function apiKey(): string {
  const k = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  if (!k) throw new Error("DATAGOLF_API_KEY is not set");
  return k;
}

/** Load DataGolf decomposition CSV — event-specific skill projections
 *  including major_adj, course_history_adj, driving-fit adjustments.
 *  `final_prediction` is what we use as the skill baseline. Cached
 *  once per server process — the CSV is a static file bundled in the
 *  repo. */
let csvSkillCache: Map<string, number> | null = null;
async function loadDecompositionSkill(): Promise<Map<string, number>> {
  if (csvSkillCache) return csvSkillCache;
  const map = new Map<string, number>();
  try {
    const csvPath = path.join(
      process.cwd(),
      "data",
      "dg-open-decomposition.csv",
    );
    const text = await fs.readFile(csvPath, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return map;
    const header = parseCsvLine(lines[0]);
    const nameIdx = header.indexOf("player_name");
    const finalIdx = header.indexOf("final_prediction");
    if (nameIdx < 0 || finalIdx < 0) return map;
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const name = cells[nameIdx];
      const finalPred = Number(cells[finalIdx]);
      if (name && Number.isFinite(finalPred)) {
        map.set(name, finalPred);
      }
    }
    csvSkillCache = map;
  } catch (err) {
    console.error("[tee-time-scoring] decomposition CSV load failed", err);
  }
  return map;
}

/** Very small CSV line parser handling quoted fields with commas
 *  inside. Enough for this fixed-schema file. */
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
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
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

async function fetchJson<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}key=${encodeURIComponent(apiKey())}&file_format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`DG ${res.status} ${path}`);
  return (await res.json()) as T;
}

interface FieldTeetime {
  round_num?: number;
  start_hole?: number;
  teetime?: string; // "YYYY-MM-DD HH:MM"
  wave?: string;
}

interface FieldEntry {
  dg_id: number;
  player_name: string;
  teetimes?: FieldTeetime[];
}

interface SkillEntry {
  dg_id: number;
  player_name: string;
  sg_total?: number;
}

interface LiveEntry {
  dg_id: number;
  player_name: string;
  /** DataGolf naming: `round` here is the SCORE for the requested
   *  round, not the round number. −4 = shot 4 under par. */
  round?: number;
  total?: number;
  thru?: number | string;
}

export type RoundNum = 1 | 2 | 3 | 4;

interface OutRow {
  dgId: string;
  name: string;
  round: RoundNum;
  teeTime: string;
  teeMinutes: number; // minutes since midnight for the scatter x-axis
  sgTotal: number;
  /** For finished rounds this is the actual round score to par.
   *  For projected (in-progress) rounds this is the MODEL'S projection
   *  of what they'll finish at. */
  toPar: number;
  adjusted: number; // toPar + sgTotal
  thru: string | number;
  startHole: number;
  /** True when the player has no DG skill rating. */
  noSkill: boolean;
  /** True when this row is a MODEL PROJECTION (player still on course).
   *  False when the round has actually completed. Drives the chart's
   *  visual distinction — dashed hollow marks for projections. */
  projected: boolean;
  /** Holes completed at snapshot time. 18 when finished; anything
   *  below when projected. Used for the tooltip. */
  thruHoles: number;
  /** Actual current score to par (only meaningful when projected).
   *  For finished rounds this equals `toPar`. */
  currentToPar: number;
}

/** Parse DataGolf tee times to minutes-since-midnight. Handles:
 *   - "YYYY-MM-DD HH:MM"   (field-updates format)
 *   - "HH:MM"              (24h short form)
 *   - "H:MMam/pm"          (12h clock)
 */
function teeToMinutes(t: string | undefined): number | null {
  if (!t) return null;
  const s = t.trim();
  // "YYYY-MM-DD HH:MM"
  const dt = s.match(/(\d{2}):(\d{2})/);
  if (dt) {
    const h = Number(dt[1]);
    const m = Number(dt[2]);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return h * 60 + m;
  }
  // 12h "7:15am" / "1:45pm"
  const h12 = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (h12) {
    let h = Number(h12[1]);
    const m = Number(h12[2]);
    const isPm = h12[3].toLowerCase() === "pm";
    if (h === 12) h = 0;
    if (isPm) h += 12;
    return h * 60 + m;
  }
  return null;
}

/** Parse the FULL DataGolf tee-time datetime string into an epoch ms.
 *  Format from field-updates: "YYYY-MM-DD HH:MM". Interpreted as UTC
 *  for the "is in the past?" check — 1h BST/UTC drift is fine at
 *  round-scale granularity. Returns null when the string is malformed
 *  or missing. */
function teeToEpochMs(t: string | undefined): number | null {
  if (!t) return null;
  const m = t.trim().match(/(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}):(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Pull the R1 tee time entry from DataGolf's teetimes array. */
function r1Teetime(entry: FieldEntry): FieldTeetime | null {
  const rows = entry.teetimes ?? [];
  const r1 = rows.find((r) => r.round_num === 1);
  return r1 ?? null;
}

/** Format minutes-since-midnight back to a clock display. */
function minutesToClock(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function GET() {
  try {
    const tour = "pga"; // The Open sits under DG's `pga` feed (majors covered there).

    const [field, skills, liveR1, liveR2, liveR3, liveR4, csvSkill] =
      await Promise.all([
        fetchJson<{ field?: FieldEntry[] }>("/field-updates?tour=" + tour),
        fetchJson<{ players?: SkillEntry[] }>(
          "/preds/skill-ratings?display=value",
        ),
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=1",
        ),
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=2",
        ),
        // R3/R4 return empty live_stats until those rounds start — the
        // buildRows helper naturally produces zero rows for those days.
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=3",
        ),
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=4",
        ),
        loadDecompositionSkill(),
      ]);

    const fieldRows = field.field ?? [];
    const skillRows = skills.players ?? [];
    const liveR1Rows = liveR1.live_stats ?? [];
    const liveR2Rows = liveR2.live_stats ?? [];
    const liveR3Rows = liveR3.live_stats ?? [];
    const liveR4Rows = liveR4.live_stats ?? [];

    const fieldMap = new Map<number, FieldEntry>();
    for (const f of fieldRows) fieldMap.set(f.dg_id, f);
    const skillMap = new Map<number, SkillEntry>();
    for (const s of skillRows) skillMap.set(s.dg_id, s);

    // Diagnostic counters (per round).
    const emptyDrops = () => ({
      noField: 0,
      noSkill: 0,
      noTeeTime: 0,
      noScore: 0,
      notDone: 0,
    });
    const dropCounts: Record<"r1" | "r2" | "r3" | "r4", ReturnType<typeof emptyDrops>> = {
      r1: emptyDrops(),
      r2: emptyDrops(),
      r3: emptyDrops(),
      r4: emptyDrops(),
    };

    /** Extract the given round's tee time from a field entry. */
    const roundTeetime = (
      entry: FieldEntry,
      round: RoundNum,
    ): FieldTeetime | null => {
      const rows = entry.teetimes ?? [];
      return rows.find((r) => r.round_num === round) ?? null;
    };

    const nowMs = Date.now();
    const buildRows = (
      liveRows: LiveEntry[],
      round: RoundNum,
    ): OutRow[] => {
      const drops = dropCounts[`r${round}` as "r1" | "r2" | "r3" | "r4"];
      const out: OutRow[] = [];
      for (const l of liveRows) {
        const f = fieldMap.get(l.dg_id);
        const s = skillMap.get(l.dg_id);
        if (!f) {
          drops.noField++;
          continue;
        }
        const tt = roundTeetime(f, round);
        const mins = teeToMinutes(tt?.teetime);
        if (mins == null) {
          drops.noTeeTime++;
          continue;
        }
        // Gate: player must have ACTUALLY teed off this round. DG's
        // `live-tournament-stats?round=N` will happily echo the
        // previous round's `thru: 18` and score for players who
        // haven't teed off yet — without this check R4 shows
        // R3 data for anyone in a late tee-time group. Compare the
        // full round-N tee datetime to wall clock; drop if future.
        const teeEpoch = teeToEpochMs(tt?.teetime);
        if (teeEpoch != null && teeEpoch > nowMs) {
          drops.notDone++;
          continue;
        }
        const thruNum =
          typeof l.thru === "number"
            ? l.thru
            : typeof l.thru === "string"
              ? Number(l.thru.trim())
              : NaN;
        const thruStr =
          typeof l.thru === "string" ? l.thru.trim() : "";
        const thruDone = thruNum === 18 || /^f/i.test(thruStr);
        // Must have SOME holes played to project — skip pre-round.
        const thruHoles = Number.isFinite(thruNum)
          ? Math.max(0, Math.min(18, Math.floor(thruNum)))
          : 0;
        if (!thruDone && thruHoles === 0) {
          drops.notDone++;
          continue;
        }
        const rndScore =
          typeof l.round === "number" ? l.round : undefined;
        if (typeof rndScore !== "number") {
          drops.noScore++;
          continue;
        }
        // Skill priority: CSV final_prediction → DG skill-ratings → 0.
        const csvSg = csvSkill.get(l.player_name);
        let sgTotal: number;
        let hasSkill: boolean;
        if (typeof csvSg === "number") {
          sgTotal = csvSg;
          hasSkill = true;
        } else if (s && typeof s.sg_total === "number") {
          sgTotal = s.sg_total;
          hasSkill = true;
        } else {
          sgTotal = 0;
          hasSkill = false;
          drops.noSkill++;
        }

        // Projected final for players still on course.
        //   projected_per_hole_remaining = -sgTotal / 18
        //     (positive SG player expected to shoot below field per
        //      hole; we treat field average as par as a simplification.)
        //   projected_final_toPar =
        //     current_score + (18 - thru) * projected_per_hole
        //
        // Regresses their current pace toward their skill baseline.
        // Naive but honest: a good player who's off to a bad start
        // gets projected to recover toward par; a bad player off to
        // a hot start gets projected to fall back a bit.
        const projected = !thruDone;
        const finalToPar = projected
          ? rndScore + (18 - thruHoles) * (-sgTotal / 18)
          : rndScore;

        out.push({
          dgId: String(l.dg_id),
          name: l.player_name,
          round,
          teeTime: minutesToClock(mins),
          teeMinutes: mins,
          sgTotal,
          toPar: finalToPar,
          adjusted: finalToPar + sgTotal,
          thru: l.thru ?? "-",
          startHole: tt?.start_hole ?? 1,
          noSkill: !hasSkill,
          projected,
          thruHoles,
          currentToPar: rndScore,
        });
      }
      return out;
    };

    const rowsR1 = buildRows(liveR1Rows, 1);
    const rowsR2 = buildRows(liveR2Rows, 2);
    const rowsR3 = buildRows(liveR3Rows, 3);
    const rowsR4 = buildRows(liveR4Rows, 4);
    const rows = [...rowsR1, ...rowsR2, ...rowsR3, ...rowsR4].sort(
      (a, b) => a.teeMinutes - b.teeMinutes,
    );

    /** Per-round split of finished vs projected — surfaces when the
     *  projection path is being taken. Verifies the "R4 still-on-course
     *  players are projected" invariant at a glance. */
    const splitByRound = (
      rs: OutRow[],
    ): { total: number; finished: number; projected: number } => {
      let finished = 0;
      let projected = 0;
      for (const r of rs) {
        if (r.projected) projected++;
        else finished++;
      }
      return { total: rs.length, finished, projected };
    };

    return NextResponse.json({
      ok: true,
      count: rows.length,
      countByRound: {
        r1: rowsR1.length,
        r2: rowsR2.length,
        r3: rowsR3.length,
        r4: rowsR4.length,
      },
      generatedAt: Date.now(),
      diag: {
        fieldRowsCount: fieldRows.length,
        skillRowsCount: skillRows.length,
        csvSkillCount: csvSkill.size,
        liveR1RowsCount: liveR1Rows.length,
        liveR2RowsCount: liveR2Rows.length,
        liveR3RowsCount: liveR3Rows.length,
        liveR4RowsCount: liveR4Rows.length,
        drops: dropCounts,
        splitByRound: {
          r1: splitByRound(rowsR1),
          r2: splitByRound(rowsR2),
          r3: splitByRound(rowsR3),
          r4: splitByRound(rowsR4),
        },
        // Sample R4 in-progress rows so you can spot-check the
        // projection maths on the wire.
        r4Samples: rowsR4
          .filter((r) => r.projected)
          .slice(0, 5)
          .map((r) => ({
            name: r.name,
            thruHoles: r.thruHoles,
            currentToPar: r.currentToPar,
            sgTotal: Number(r.sgTotal.toFixed(3)),
            projectedFinal: Number(r.toPar.toFixed(3)),
            adjusted: Number(r.adjusted.toFixed(3)),
          })),
      },
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
