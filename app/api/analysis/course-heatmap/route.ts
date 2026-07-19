/**
 * /api/analysis/course-heatmap
 *
 * Builds a (round × hole × time-of-day) grid of average field
 * scoring vs par, so the client can render a heatmap showing WHEN
 * each hole started playing harder or easier through the day.
 *
 * Data flow:
 *   1. Active tournament id → Pardle's own snapshot in Redis. That
 *      snapshot has every player's per-hole score for every round
 *      they've played (source of truth for scores).
 *   2. Same snapshot's par map for stroke-vs-par delta.
 *   3. DataGolf field-updates for tee times + start holes so we
 *      can estimate WHEN each hole was completed (a player teeing
 *      off 07:00 on hole 1 completes hole 7 around ~08:40).
 *   4. Bucket every (round, hole, completion_time) into a
 *      15-minute grid, average strokes-vs-par per cell.
 *
 * We estimate completion time rather than using event timestamps
 * because Pardle's shot-event buffer is capped and doesn't hold
 * the entire tournament back to Thursday.
 */

import { NextResponse } from "next/server";
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
  teetime?: string;
}
interface FieldEntry {
  dg_id: number;
  player_num?: number;
  teetimes?: FieldTeetime[];
}

const BUCKET_MIN = 60; // 1-hour grid buckets — coarse enough that
                       // every round has a readable, uniform x-axis
                       // (partial rounds don't drop into 15-min noise)
const HOLE_PACE_MIN = 15; // approx minutes per hole

/** "2026-07-16 15:04" → 15*60 + 04 = 904 (minutes since midnight). */
function teeToMinutes(t: string | undefined): number | null {
  if (!t) return null;
  const m = t.trim().match(/(\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h >= 0 && h < 24 && min >= 0 && min < 60) return h * 60 + min;
  return null;
}

/** How many holes into a round is `hole` played, given the start hole?
 *  Returns 0-indexed position (0 = first hole after tee off). */
function holePosition(hole: number, startHole: number): number {
  if (startHole === 1) return hole - 1;
  // Two-tee starts: hole N is played at position...
  //   startHole=10 → 10,11,...,18,1,2,...,9
  //   startHole=1  → 1,2,...,9,10,...,18
  const shifted = ((hole - startHole) + 18) % 18;
  return shifted;
}

interface CellAgg {
  round: number;
  hole: number;
  timeBucket: number;
  sumVsPar: number;
  count: number;
}

/** Try to key playerId ↔ dg_id. Pardle's playerId is the orchestrator
 *  numeric id; DataGolf uses its own dg_id + player_num. For The Open
 *  field-updates we get `player_num` on each entry which usually
 *  equals the PGA Tour orchestrator id. Fall back to matching by
 *  name via the leaderboard cache in a follow-up if this ever misses. */
function pgaIdOf(entry: FieldEntry): string | null {
  return entry.player_num ? String(entry.player_num) : null;
}

export async function GET() {
  try {
    const active = await getActiveTournament();
    if (!active?.tournament?.id) {
      return NextResponse.json(
        { ok: false, error: "no-active-tournament" },
        { status: 404 },
      );
    }
    const tournamentId = active.tournament.id;

    const [snapshot, pars, field] = await Promise.all([
      getSnapshot(tournamentId),
      getCachedTournamentPars(tournamentId),
      fetchJson<{ field?: FieldEntry[] }>("/field-updates?tour=pga"),
    ]);
    if (!snapshot) {
      return NextResponse.json(
        { ok: false, error: "no-snapshot" },
        { status: 404 },
      );
    }

    // Map: pgaTourId → { round → { teeMins, startHole } }
    const teeInfo = new Map<
      string,
      Record<number, { teeMins: number; startHole: number }>
    >();
    for (const f of field.field ?? []) {
      const pgaId = pgaIdOf(f);
      if (!pgaId) continue;
      const perRound: Record<number, { teeMins: number; startHole: number }> = {};
      for (const t of f.teetimes ?? []) {
        if (!t.round_num) continue;
        const mins = teeToMinutes(t.teetime);
        if (mins == null) continue;
        perRound[t.round_num] = {
          teeMins: mins,
          startHole: t.start_hole ?? 1,
        };
      }
      if (Object.keys(perRound).length > 0) teeInfo.set(pgaId, perRound);
    }

    // Build the cell aggregation.
    const cellMap = new Map<string, CellAgg>();
    let noTeeInfo = 0;
    let noPar = 0;
    let noScore = 0;
    let tallied = 0;
    for (const [pid, byRound] of Object.entries(snapshot.holes)) {
      const playerTees = teeInfo.get(pid);
      if (!playerTees) {
        noTeeInfo++;
        continue;
      }
      for (const [roundStr, byHole] of Object.entries(byRound)) {
        const round = Number(roundStr);
        const t = playerTees[round];
        if (!t) continue;
        const roundPars = pars[round];
        if (!roundPars) continue;
        for (const [holeStr, scoreStr] of Object.entries(byHole)) {
          const hole = Number(holeStr);
          const strokes = Number(scoreStr);
          if (!Number.isFinite(strokes) || strokes <= 0) {
            noScore++;
            continue;
          }
          const par = roundPars[hole];
          if (typeof par !== "number") {
            noPar++;
            continue;
          }
          const pos = holePosition(hole, t.startHole);
          const completionMins = t.teeMins + (pos + 1) * HOLE_PACE_MIN;
          const bucket = Math.floor(completionMins / BUCKET_MIN) * BUCKET_MIN;
          const key = `${round}:${hole}:${bucket}`;
          const cell = cellMap.get(key) ?? {
            round,
            hole,
            timeBucket: bucket,
            sumVsPar: 0,
            count: 0,
          };
          cell.sumVsPar += strokes - par;
          cell.count += 1;
          cellMap.set(key, cell);
          tallied++;
        }
      }
    }

    const cells = [...cellMap.values()].map((c) => ({
      round: c.round,
      hole: c.hole,
      timeBucket: c.timeBucket,
      avgVsPar: c.sumVsPar / c.count,
      count: c.count,
    }));

    // Per-round tee-time ranges for the x-axis extents.
    const roundRanges: Record<
      number,
      { minMins: number; maxMins: number; cellCount: number }
    > = {};
    for (const c of cells) {
      const r = roundRanges[c.round] ?? {
        minMins: Infinity,
        maxMins: -Infinity,
        cellCount: 0,
      };
      if (c.timeBucket < r.minMins) r.minMins = c.timeBucket;
      if (c.timeBucket > r.maxMins) r.maxMins = c.timeBucket;
      r.cellCount += 1;
      roundRanges[c.round] = r;
    }

    return NextResponse.json({
      ok: true,
      tournamentId,
      tournamentName: active.tournament.name,
      generatedAt: Date.now(),
      bucketMinutes: BUCKET_MIN,
      cells,
      roundRanges,
      diag: { tallied, noTeeInfo, noPar, noScore },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
