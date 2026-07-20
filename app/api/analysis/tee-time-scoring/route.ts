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
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getSnapshot, getCachedTournamentPars } from "@/lib/feed/store";

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
  player_num?: number; // PGA Tour orchestrator id — matches Pardle's snapshot key
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

/** Load a historical 3M Open payload and reshape into the same
 *  OutRow[] the live path returns. skillBaseline in the JSON is the
 *  per-player 4-round average sg_total (see the fetcher script), so
 *  the chart's "adjusted = toPar + sgTotal" formula naturally shows
 *  each round's deviation from that player's own week baseline. */
interface HistoricalRound {
  teetime: string | null;
  startHole: number;
  score: number;
  sgTotal: number | null;
  coursePar: number | null;
}
interface HistoricalPlayer {
  dgId: string;
  pgaId: string | null;
  name: string;
  skillBaseline: number | null;
  rounds: Record<string, HistoricalRound>;
}
interface HistoricalPayload {
  year: number;
  dgEventName: string;
  players: HistoricalPlayer[];
}

async function loadHistorical(year: number): Promise<HistoricalPayload | null> {
  try {
    const p = path.join(
      process.cwd(),
      "data",
      "historical",
      `3m-open-${year}.json`,
    );
    const text = await fs.readFile(p, "utf8");
    return JSON.parse(text) as HistoricalPayload;
  } catch {
    return null;
  }
}

function buildHistoricalRows(payload: HistoricalPayload): OutRow[] {
  const rows: OutRow[] = [];
  for (const p of payload.players) {
    const skill = typeof p.skillBaseline === "number" ? p.skillBaseline : 0;
    const hasSkill = typeof p.skillBaseline === "number";
    for (const [roundStr, r] of Object.entries(p.rounds)) {
      const round = Number(roundStr) as RoundNum;
      const mins = teeToMinutes(r.teetime ?? undefined);
      if (mins == null) continue;
      if (typeof r.score !== "number" || typeof r.coursePar !== "number") continue;
      const toPar = r.score - r.coursePar;
      rows.push({
        dgId: p.dgId,
        name: p.name,
        round,
        teeTime: minutesToClock(mins),
        teeMinutes: mins,
        sgTotal: skill,
        toPar,
        adjusted: toPar + skill,
        thru: 18,
        startHole: r.startHole ?? 1,
        noSkill: !hasSkill,
        projected: false,
        thruHoles: 18,
        currentToPar: toPar,
      });
    }
  }
  return rows.sort((a, b) => a.teeMinutes - b.teeMinutes);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const yearParam = url.searchParams.get("year");
    const yearNum = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

    // Historical branch — one file per year, no external calls.
    if (yearNum && yearNum !== new Date().getUTCFullYear()) {
      const hist = await loadHistorical(yearNum);
      if (!hist) {
        return NextResponse.json(
          { ok: false, error: `no historical data for ${yearNum}` },
          { status: 404 },
        );
      }
      const rows = buildHistoricalRows(hist);
      const perRound = (r: RoundNum) => rows.filter((x) => x.round === r);
      return NextResponse.json({
        ok: true,
        source: "historical",
        year: yearNum,
        eventName: hist.dgEventName,
        count: rows.length,
        countByRound: {
          r1: perRound(1).length,
          r2: perRound(2).length,
          r3: perRound(3).length,
          r4: perRound(4).length,
        },
        generatedAt: null,
        rows,
      });
    }

    const tour = "pga"; // The Open sits under DG's `pga` feed (majors covered there).

    // Resolve the active tournament so we can fetch Pardle's own
    // per-hole snapshot as the authoritative score source. DG's
    // live-tournament-stats?round=4 was returning stale thru:18 /
    // R3-echoed round scores for mid-R4 players — snapshot has real
    // hole-by-hole data.
    const activeTourney = await getActiveTournament();
    const activeTournamentId = activeTourney?.tournament?.id ?? null;

    const dgStats = "sg_total,sg_ott,sg_app,sg_arg,sg_putt";
    const [
      field,
      skills,
      liveR1,
      liveR2,
      liveR3,
      liveR4,
      csvSkill,
      snapshot,
      snapshotPars,
    ] = await Promise.all([
        fetchJson<{ field?: FieldEntry[] }>("/field-updates?tour=" + tour),
        fetchJson<{ players?: SkillEntry[] }>(
          "/preds/skill-ratings?display=value",
        ),
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=1&stats=" + dgStats,
        ),
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=2&stats=" + dgStats,
        ),
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=3&stats=" + dgStats,
        ),
        fetchJson<{ live_stats?: LiveEntry[] }>(
          "/preds/live-tournament-stats?tour=" + tour + "&round=4&stats=" + dgStats,
        ),
        loadDecompositionSkill(),
        activeTournamentId ? getSnapshot(activeTournamentId) : Promise.resolve(null),
        activeTournamentId
          ? getCachedTournamentPars(activeTournamentId)
          : Promise.resolve({} as Record<number, Record<number, number>>),
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

    /** Compute (thruHoles, scoreToPar) from Pardle's snapshot for a
     *  specific (player, round). Returns null when there's no
     *  snapshot data for this player/round yet — caller falls back
     *  to DG. */
    const snapshotScore = (
      pgaId: string | undefined,
      round: RoundNum,
    ): { thruHoles: number; toPar: number } | null => {
      if (!pgaId || !snapshot) return null;
      const holes = snapshot.holes?.[pgaId]?.[round];
      if (!holes) return null;
      const roundPars = snapshotPars[round];
      if (!roundPars) return null;
      let strokes = 0;
      let par = 0;
      let played = 0;
      for (const [holeStr, scoreStr] of Object.entries(holes)) {
        const s = Number(scoreStr);
        if (!Number.isFinite(s) || s <= 0) continue;
        const p = roundPars[Number(holeStr)];
        if (typeof p !== "number") continue;
        strokes += s;
        par += p;
        played++;
      }
      if (played === 0) return null;
      return { thruHoles: played, toPar: strokes - par };
    };

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
        // Drop players whose round hasn't started yet.
        const teeEpoch = teeToEpochMs(tt?.teetime);
        if (teeEpoch != null && teeEpoch > nowMs) {
          drops.notDone++;
          continue;
        }
        // Score source priority: Pardle snapshot (authoritative
        // per-hole data) → DG live-tournament-stats (unreliable for
        // in-progress rounds — DG echoes previous round data).
        const pgaId = f.player_num ? String(f.player_num) : undefined;
        const snap = snapshotScore(pgaId, round);
        let thruHoles: number;
        let rndScore: number;
        let thruDone: boolean;
        if (snap) {
          thruHoles = snap.thruHoles;
          rndScore = snap.toPar;
          thruDone = snap.thruHoles === 18;
        } else {
          // Fallback: DG. Unreliable for R4 but OK for finished
          // rounds that Pardle's snapshot hasn't been kept for.
          const thruNum =
            typeof l.thru === "number"
              ? l.thru
              : typeof l.thru === "string"
                ? Number(l.thru.trim())
                : NaN;
          const thruStr =
            typeof l.thru === "string" ? l.thru.trim() : "";
          thruDone = thruNum === 18 || /^f/i.test(thruStr);
          thruHoles = Number.isFinite(thruNum)
            ? Math.max(0, Math.min(18, Math.floor(thruNum)))
            : 0;
          if (!thruDone && thruHoles === 0) {
            drops.notDone++;
            continue;
          }
          if (typeof l.round !== "number") {
            drops.noScore++;
            continue;
          }
          rndScore = l.round;
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
        activeTournamentId,
        snapshotAvailable: snapshot != null,
        snapshotPlayerCount: snapshot?.holes
          ? Object.keys(snapshot.holes).length
          : 0,
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
        // Raw DG R4 payload for a couple of named players — verifies
        // whether DG is returning R4 numbers or echoing older rounds.
        r4RawFromDG: (liveR4Rows.filter((l) =>
          /southgate|scheffler|mcilroy|fleetwood/i.test(l.player_name),
        )).map((l) => ({
          name: l.player_name,
          thru: l.thru,
          round: l.round,
          total: l.total,
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
