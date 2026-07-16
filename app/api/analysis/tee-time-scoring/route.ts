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

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BASE = "https://feeds.datagolf.com";

function apiKey(): string {
  const k = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  if (!k) throw new Error("DATAGOLF_API_KEY is not set");
  return k;
}

async function fetchJson<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}key=${encodeURIComponent(apiKey())}&file_format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`DG ${res.status} ${path}`);
  return (await res.json()) as T;
}

interface FieldEntry {
  dg_id: number;
  player_name: string;
  r1_teetime?: string;
  start_hole?: number;
}

interface SkillEntry {
  dg_id: number;
  player_name: string;
  sg_total?: number;
}

interface LiveEntry {
  dg_id: number;
  player_name: string;
  current_score?: number; // to par
  round?: number;
  thru?: number | string;
}

interface OutRow {
  dgId: string;
  name: string;
  teeTime: string;
  teeMinutes: number; // minutes since midnight for the scatter x-axis
  sgTotal: number;
  toPar: number;
  adjusted: number; // toPar + sgTotal
  thru: string | number;
  startHole: number;
}

/** Parse "HH:MM" (24h) or "H:MMam/pm" to minutes-since-midnight. */
function teeToMinutes(t: string | undefined): number | null {
  if (!t) return null;
  const s = t.trim();
  // 24h "07:15" or "13:45"
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = Number(h24[1]);
    const m = Number(h24[2]);
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

/** Format minutes-since-midnight back to a clock display. */
function minutesToClock(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function GET() {
  try {
    const tour = "pga"; // The Open sits under DG's `pga` feed (majors covered there).

    const [field, skills, live] = await Promise.all([
      fetchJson<{ field?: FieldEntry[] }>("/field-updates?tour=" + tour),
      fetchJson<{ players?: SkillEntry[] }>(
        "/preds/skill-ratings?display=value",
      ),
      fetchJson<{ live_stats?: LiveEntry[] }>(
        "/preds/live-tournament-stats?tour=" + tour + "&round=1",
      ),
    ]);

    const fieldMap = new Map<number, FieldEntry>();
    for (const f of field.field ?? []) fieldMap.set(f.dg_id, f);
    const skillMap = new Map<number, SkillEntry>();
    for (const s of skills.players ?? []) skillMap.set(s.dg_id, s);

    const rows: OutRow[] = [];
    for (const l of live.live_stats ?? []) {
      const f = fieldMap.get(l.dg_id);
      const s = skillMap.get(l.dg_id);
      if (!f || !s) continue;
      const mins = teeToMinutes(f.r1_teetime);
      if (mins == null) continue;
      if (typeof l.current_score !== "number") continue;
      if (typeof s.sg_total !== "number") continue;

      rows.push({
        dgId: String(l.dg_id),
        name: l.player_name,
        teeTime: minutesToClock(mins),
        teeMinutes: mins,
        sgTotal: s.sg_total,
        toPar: l.current_score,
        adjusted: l.current_score + s.sg_total,
        thru: l.thru ?? "-",
        startHole: f.start_hole ?? 1,
      });
    }
    rows.sort((a, b) => a.teeMinutes - b.teeMinutes);

    return NextResponse.json({
      ok: true,
      count: rows.length,
      generatedAt: Date.now(),
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
