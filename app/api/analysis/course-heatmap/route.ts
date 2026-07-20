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
import { promises as fs } from "node:fs";
import path from "node:path";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getSnapshot, getCachedTournamentPars } from "@/lib/feed/store";
import { getDailyWeather, type DailyWeather } from "@/lib/weather/open-meteo";
import { coordsForTournamentId } from "@/lib/weather/course-coords";

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

/** Historical file shape (see scripts/fetch-3m-historical.mjs). */
interface HistoricalRound {
  teetime: string | null;
  startHole: number;
  coursePar: number | null;
  holes: Record<string, { strokes: number; par: number }> | null;
}
interface HistoricalPlayer {
  dgId: string;
  pgaId: string | null;
  name: string;
  rounds: Record<string, HistoricalRound>;
}
interface HistoricalPayload {
  year: number;
  dgEventName: string;
  players: HistoricalPlayer[];
  weatherByRound?: Record<string, DailyWeather | null> | null;
}

/** Parse "7:29am" / "1:45pm" / "07:29" → minutes since midnight. */
function historicalTeeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = t.trim();
  const h12 = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (h12) {
    let h = Number(h12[1]);
    const m = Number(h12[2]);
    const isPm = h12[3].toLowerCase() === "pm";
    if (h === 12) h = 0;
    if (isPm) h += 12;
    return h * 60 + m;
  }
  const h24 = s.match(/(\d{1,2}):(\d{2})/);
  if (h24) {
    const h = Number(h24[1]);
    const m = Number(h24[2]);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return h * 60 + m;
  }
  return null;
}

async function buildHistoricalCells(year: number) {
  const p = path.join(process.cwd(), "data", "historical", `3m-open-${year}.json`);
  let payload: HistoricalPayload;
  try {
    payload = JSON.parse(await fs.readFile(p, "utf8")) as HistoricalPayload;
  } catch {
    return null;
  }
  const cellMap = new Map<string, CellAgg>();
  let tallied = 0;
  let noHoles = 0;
  let noTee = 0;
  for (const player of payload.players) {
    for (const [roundStr, r] of Object.entries(player.rounds)) {
      const round = Number(roundStr);
      const teeMins = historicalTeeToMinutes(r.teetime);
      if (teeMins == null) {
        noTee++;
        continue;
      }
      if (!r.holes) {
        noHoles++;
        continue;
      }
      const startHole = r.startHole || 1;
      for (const [holeStr, cell] of Object.entries(r.holes)) {
        const hole = Number(holeStr);
        const strokes = Number(cell.strokes);
        const par = Number(cell.par);
        if (!Number.isFinite(strokes) || !Number.isFinite(par) || strokes <= 0) continue;
        const pos = holePosition(hole, startHole);
        const completionMins = teeMins + (pos + 1) * HOLE_PACE_MIN;
        const bucket = Math.floor(completionMins / BUCKET_MIN) * BUCKET_MIN;
        const key = `${round}:${hole}:${bucket}`;
        const c = cellMap.get(key) ?? {
          round,
          hole,
          timeBucket: bucket,
          sumVsPar: 0,
          count: 0,
        };
        c.sumVsPar += strokes - par;
        c.count += 1;
        cellMap.set(key, c);
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
  return {
    cells,
    tallied,
    noHoles,
    noTee,
    eventName: payload.dgEventName,
    weatherByRound: payload.weatherByRound ?? null,
  };
}

/** Same shape as the tee-time-scoring version — small enough to
 *  duplicate rather than share, keeps each route self-contained. */
async function fetchLiveWeatherByRoundLocal(
  tournamentId: string | null,
  fieldRows: { teetimes?: { round_num?: number; teetime?: string }[] }[],
): Promise<Record<string, DailyWeather | null> | null> {
  const coords = coordsForTournamentId(tournamentId);
  if (!coords) return null;
  let earliest: string | null = null;
  for (const f of fieldRows) {
    for (const t of f.teetimes ?? []) {
      if (t.round_num !== 1 || !t.teetime) continue;
      const day = t.teetime.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (!earliest || day < earliest) earliest = day;
    }
  }
  if (!earliest) return null;
  const [y, m, d] = earliest.split("-").map(Number);
  const r1 = new Date(Date.UTC(y, m - 1, d));
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  const bump = (offset: number) => {
    const dt = new Date(r1);
    dt.setUTCDate(r1.getUTCDate() + offset);
    return iso(dt);
  };
  const dates = { 1: iso(r1), 2: bump(1), 3: bump(2), 4: bump(3) };
  const daily = await getDailyWeather(
    coords.lat,
    coords.lon,
    [dates[1], dates[2], dates[3], dates[4]],
    coords.tz,
  );
  const byDate = new Map(daily.map((x) => [x.date, x]));
  return {
    "1": byDate.get(dates[1]) ?? null,
    "2": byDate.get(dates[2]) ?? null,
    "3": byDate.get(dates[3]) ?? null,
    "4": byDate.get(dates[4]) ?? null,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const yearParam = url.searchParams.get("year");
    const yearNum = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

    if (yearNum && yearNum !== new Date().getUTCFullYear()) {
      const hist = await buildHistoricalCells(yearNum);
      if (!hist) {
        return NextResponse.json(
          { ok: false, error: `no historical data for ${yearNum}` },
          { status: 404 },
        );
      }
      const roundRanges: Record<
        number,
        { minMins: number; maxMins: number; cellCount: number }
      > = {};
      for (const c of hist.cells) {
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
        source: "historical",
        year: yearNum,
        eventName: hist.eventName,
        // Historical is always 3M Open at TPC Twin Cities on the
        // R{year}525 tournament id (fetched via PGA Tour schedule
        // in scripts/fetch-3m-historical.mjs). Surfacing it here
        // lets the client fetch pin sheets for old years too.
        tournamentId: `R${yearNum}525`,
        generatedAt: null,
        bucketMinutes: BUCKET_MIN,
        cells: hist.cells,
        roundRanges,
        weatherByRound: hist.weatherByRound,
        diag: {
          tallied: hist.tallied,
          noHoles: hist.noHoles,
          noTee: hist.noTee,
        },
      });
    }

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

    // Live weather (shared with tee-time-scoring — same venue lookup,
    // same date derivation from field-updates R1 tee times).
    const weatherByRound = await fetchLiveWeatherByRoundLocal(
      tournamentId,
      field.field ?? [],
    );

    return NextResponse.json({
      ok: true,
      tournamentId,
      tournamentName: active.tournament.name,
      generatedAt: Date.now(),
      bucketMinutes: BUCKET_MIN,
      cells,
      roundRanges,
      weatherByRound,
      diag: { tallied, noTeeInfo, noPar, noScore },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
