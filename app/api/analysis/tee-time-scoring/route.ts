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
  teeTime: string;
  teeMinutes: number; // minutes since midnight for the scatter x-axis
  sgTotal: number;
  toPar: number;
  adjusted: number; // toPar + sgTotal
  thru: string | number;
  startHole: number;
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

    const [field, skills, live] = await Promise.all([
      fetchJson<{ field?: FieldEntry[] }>("/field-updates?tour=" + tour),
      fetchJson<{ players?: SkillEntry[] }>(
        "/preds/skill-ratings?display=value",
      ),
      fetchJson<{ live_stats?: LiveEntry[] }>(
        "/preds/live-tournament-stats?tour=" + tour + "&round=1",
      ),
    ]);

    const fieldRows = field.field ?? [];
    const skillRows = skills.players ?? [];
    const liveRows = live.live_stats ?? [];

    const fieldMap = new Map<number, FieldEntry>();
    for (const f of fieldRows) fieldMap.set(f.dg_id, f);
    const skillMap = new Map<number, SkillEntry>();
    for (const s of skillRows) skillMap.set(s.dg_id, s);

    // Diagnostic counters — surfaced in the response so we can spot
    // which step is dropping rows without adding a separate debug hop.
    let noField = 0;
    let noSkill = 0;
    let noTeeTime = 0;
    let noScore = 0;
    let noSgTotal = 0;

    const rows: OutRow[] = [];
    for (const l of liveRows) {
      const f = fieldMap.get(l.dg_id);
      const s = skillMap.get(l.dg_id);
      if (!f) {
        noField++;
        continue;
      }
      if (!s) {
        noSkill++;
        continue;
      }
      const r1 = r1Teetime(f);
      const mins = teeToMinutes(r1?.teetime);
      if (mins == null) {
        noTeeTime++;
        continue;
      }
      // Only include players who have COMPLETED R1. DataGolf's
      // `thru` field arrives as multiple shapes — 18 (number),
      // "18" (string), "F" / "F*" (letter). Accept anything that
      // parses to 18 as a number OR starts with F.
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
        continue;
      }
      // DataGolf's live-tournament-stats reuses the `round` field for
      // "score in that round". Pull whichever number is populated.
      const r1Score =
        typeof l.round === "number" ? l.round : undefined;
      if (typeof r1Score !== "number") {
        noScore++;
        continue;
      }
      if (typeof s.sg_total !== "number") {
        noSgTotal++;
        continue;
      }

      rows.push({
        dgId: String(l.dg_id),
        name: l.player_name,
        teeTime: minutesToClock(mins),
        teeMinutes: mins,
        sgTotal: s.sg_total,
        toPar: r1Score,
        adjusted: r1Score + s.sg_total,
        thru: l.thru ?? "-",
        startHole: r1?.start_hole ?? 1,
      });
    }
    rows.sort((a, b) => a.teeMinutes - b.teeMinutes);

    // Diagnostic — for LATE-wave players (r1_teetime after 15:00),
    // show their `thru` and `round` values so we can spot when the
    // filter is dropping actually-finished ones.
    const latePlayers = (live.live_stats ?? [])
      .map((l) => ({ live: l, field: fieldMap.get(l.dg_id) }))
      .filter((p) => {
        const r1 = p.field ? r1Teetime(p.field) : null;
        const mins = teeToMinutes(r1?.teetime);
        return mins != null && mins >= 15 * 60;
      })
      .slice(0, 15)
      .map((p) => ({
        name: p.live.player_name,
        r1_teetime: r1Teetime(p.field!)?.teetime,
        thru: p.live.thru,
        thruType: typeof p.live.thru,
        round: p.live.round,
      }));

    return NextResponse.json({
      ok: true,
      count: rows.length,
      generatedAt: Date.now(),
      diag: {
        fieldRowsCount: fieldRows.length,
        skillRowsCount: skillRows.length,
        liveRowsCount: liveRows.length,
        drops: { noField, noSkill, noTeeTime, noScore, noSgTotal },
        latePlayers,
        fieldSample: fieldRows.slice(0, 2),
        skillSample: skillRows.slice(0, 2),
        liveSample: liveRows.slice(0, 2),
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
