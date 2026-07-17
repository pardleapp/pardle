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

interface OutRow {
  dgId: string;
  name: string;
  round: 1 | 2;
  teeTime: string;
  teeMinutes: number; // minutes since midnight for the scatter x-axis
  sgTotal: number;
  toPar: number;
  adjusted: number; // toPar + sgTotal
  thru: string | number;
  startHole: number;
  /** True when the player has no DG skill rating (amateur, qualifier,
   *  minor-tour). Their sgTotal defaults to 0 so their raw score
   *  IS their adjusted score. The chart draws them as outlined dots
   *  so the visual distinguishes "skill-adjusted" from "raw score". */
  noSkill: boolean;
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

    const [field, skills, liveR1, liveR2, csvSkill] = await Promise.all([
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
      loadDecompositionSkill(),
    ]);

    const fieldRows = field.field ?? [];
    const skillRows = skills.players ?? [];
    const liveR1Rows = liveR1.live_stats ?? [];
    const liveR2Rows = liveR2.live_stats ?? [];

    const fieldMap = new Map<number, FieldEntry>();
    for (const f of fieldRows) fieldMap.set(f.dg_id, f);
    const skillMap = new Map<number, SkillEntry>();
    for (const s of skillRows) skillMap.set(s.dg_id, s);

    // Diagnostic counters (per round).
    const dropCounts = {
      r1: { noField: 0, noSkill: 0, noTeeTime: 0, noScore: 0, notDone: 0 },
      r2: { noField: 0, noSkill: 0, noTeeTime: 0, noScore: 0, notDone: 0 },
    };

    /** Extract the given round's tee time from a field entry. */
    const roundTeetime = (
      entry: FieldEntry,
      round: 1 | 2,
    ): FieldTeetime | null => {
      const rows = entry.teetimes ?? [];
      return rows.find((r) => r.round_num === round) ?? null;
    };

    const buildRows = (
      liveRows: LiveEntry[],
      round: 1 | 2,
    ): OutRow[] => {
      const drops = dropCounts[round === 1 ? "r1" : "r2"];
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
        const thruNum =
          typeof l.thru === "number"
            ? l.thru
            : typeof l.thru === "string"
              ? Number(l.thru.trim())
              : NaN;
        const thruStr =
          typeof l.thru === "string" ? l.thru.trim() : "";
        const thruDone = thruNum === 18 || /^f/i.test(thruStr);
        if (!thruDone) {
          drops.notDone++;
          continue;
        }
        const rndScore =
          typeof l.round === "number" ? l.round : undefined;
        if (typeof rndScore !== "number") {
          drops.noScore++;
          continue;
        }
        // Skill source priority:
        //   1. CSV `final_prediction` — event-specific (major + course
        //      history + course-fit adjusted). Best available skill
        //      estimate for The Open at Royal Birkdale.
        //   2. DG `skill-ratings` endpoint — generic tour SG baseline.
        //   3. Fall back to 0 (tour average) and mark as noSkill.
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

        out.push({
          dgId: String(l.dg_id),
          name: l.player_name,
          round,
          teeTime: minutesToClock(mins),
          teeMinutes: mins,
          sgTotal,
          toPar: rndScore,
          adjusted: rndScore + sgTotal,
          thru: l.thru ?? "-",
          startHole: tt?.start_hole ?? 1,
          noSkill: !hasSkill,
        });
      }
      return out;
    };

    const rowsR1 = buildRows(liveR1Rows, 1);
    const rowsR2 = buildRows(liveR2Rows, 2);
    const rows = [...rowsR1, ...rowsR2].sort(
      (a, b) => a.teeMinutes - b.teeMinutes,
    );

    return NextResponse.json({
      ok: true,
      count: rows.length,
      countByRound: { r1: rowsR1.length, r2: rowsR2.length },
      generatedAt: Date.now(),
      diag: {
        fieldRowsCount: fieldRows.length,
        skillRowsCount: skillRows.length,
        csvSkillCount: csvSkill.size,
        liveR1RowsCount: liveR1Rows.length,
        liveR2RowsCount: liveR2Rows.length,
        drops: dropCounts,
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
