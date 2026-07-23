/**
 * Server-side loader for per-hole scoring averages. Reads Pardle's
 * live snapshot (current + previous rounds) plus the historical JSON
 * dump for the previous year's edition, then hands everything to the
 * pure computeHoleAverages helper.
 *
 * Isolated in its own module so it can be reused by:
 *   - /api/analysis/tee-time-scoring (server-side projection)
 *   - The feed engine's snap bake (client-side round-score bet projection)
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PollSnapshot } from "./feed/store";
import {
  computeHoleAverages,
  type HoleAverages,
  type HoleAverageDiag,
  type HoleScoreSamples,
} from "./hole-averages";

/** Extract per-hole raw strokes samples from a Pardle snapshot for a
 *  specific round. Returns an empty object when the snapshot has no
 *  data for that round yet. */
export function samplesFromSnapshot(
  snapshot: PollSnapshot | null,
  round: number,
): HoleScoreSamples {
  const out: HoleScoreSamples = {};
  if (!snapshot?.holes) return out;
  for (const [, byRound] of Object.entries(snapshot.holes)) {
    const holes = byRound?.[round];
    if (!holes) continue;
    for (const [holeStr, scoreStr] of Object.entries(holes)) {
      const s = Number(scoreStr);
      if (!Number.isFinite(s) || s <= 0) continue;
      const h = Number(holeStr);
      if (!Number.isFinite(h) || h < 1 || h > 18) continue;
      (out[h] ??= []).push(s);
    }
  }
  return out;
}

/** Shape of the historical JSON files under /data/historical/. */
interface HistoricalPlayer {
  rounds?: Record<
    string,
    {
      holes?: Record<string, { strokes?: number; par?: number }>;
    }
  >;
}
interface HistoricalDump {
  year: number;
  dgEventId?: number | string;
  pgaTournamentId?: string;
  players?: HistoricalPlayer[];
}

let historicalManifest:
  | { events: Map<string, string[]> } // event-id → sorted file paths
  | null = null;

/** Build (or return cached) manifest of {eventId → [file paths]} from
 *  /data/historical. Files are sorted newest-first so we can pull the
 *  most-recent prior year without scanning. */
async function buildManifest(): Promise<Map<string, string[]>> {
  if (historicalManifest) return historicalManifest.events;
  const dir = path.join(process.cwd(), "data", "historical");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    historicalManifest = { events: new Map() };
    return historicalManifest.events;
  }
  const byEvent = new Map<string, string[]>();
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    // File name pattern: `<slug>-<year>.json`. We don't infer the
    // event id from the filename — we open the JSON and read dgEventId.
    const full = path.join(dir, name);
    try {
      const buf = await fs.readFile(full, "utf-8");
      const j = JSON.parse(buf) as HistoricalDump;
      const key = j.dgEventId != null ? String(j.dgEventId) : null;
      if (!key) continue;
      const list = byEvent.get(key) ?? [];
      list.push(full);
      byEvent.set(key, list);
    } catch {
      /* skip malformed file */
    }
  }
  // Sort each list by embedded year, newest-first.
  for (const [key, list] of byEvent) {
    list.sort((a, b) => {
      const ya = Number(a.match(/(\d{4})\.json$/)?.[1] ?? 0);
      const yb = Number(b.match(/(\d{4})\.json$/)?.[1] ?? 0);
      return yb - ya;
    });
    byEvent.set(key, list);
  }
  historicalManifest = { events: byEvent };
  return byEvent;
}

/** Extract the DG event-id from a Pardle/orchestrator tournament id.
 *  R2026525 → "525", R2024541 → "541". The event id is stable across
 *  years so historical lookups can use it as the join key. */
export function dgEventIdFromTournamentId(
  tournamentId: string,
): string | null {
  const m = tournamentId.match(/^R\d{4}(\d+)$/);
  return m ? m[1] : null;
}

/** Merge per-hole samples across ALL rounds of a historical dump.
 *  Fallback #3 is course-difficulty over the previous year, not a
 *  specific round — the more samples the merge has, the more stable
 *  its per-hole average. */
function samplesFromHistorical(dump: HistoricalDump): HoleScoreSamples {
  const out: HoleScoreSamples = {};
  const players = dump.players ?? [];
  for (const p of players) {
    const rounds = p.rounds ?? {};
    for (const rObj of Object.values(rounds)) {
      const holes = rObj.holes ?? {};
      for (const [holeStr, entry] of Object.entries(holes)) {
        const s = Number(entry?.strokes);
        if (!Number.isFinite(s) || s <= 0) continue;
        const h = Number(holeStr);
        if (!Number.isFinite(h) || h < 1 || h > 18) continue;
        (out[h] ??= []).push(s);
      }
    }
  }
  return out;
}

/**
 * Load per-hole averages for `round` of `tournamentId`, applying the
 * live-first fallback chain (current round → previous round → previous
 * year → par). All I/O + fallback logic lives here so callers just
 * take the resulting HoleAverages / diag map.
 */
export async function loadHoleAveragesForRound(input: {
  tournamentId: string;
  round: number;
  snapshot: PollSnapshot | null;
  holePars: Record<number, number>;
}): Promise<{
  averages: HoleAverages;
  diag: Record<number, HoleAverageDiag>;
}> {
  const { tournamentId, round, snapshot, holePars } = input;
  const currentRound = samplesFromSnapshot(snapshot, round);
  const prevRound =
    round > 1 ? samplesFromSnapshot(snapshot, round - 1) : null;

  let prevYear: HoleScoreSamples | null = null;
  const eventId = dgEventIdFromTournamentId(tournamentId);
  if (eventId) {
    try {
      const manifest = await buildManifest();
      const files = manifest.get(eventId) ?? [];
      // Skip the current year's file if it happens to be in there
      // (the historical dump is written after the event completes).
      const currentYear = Number(tournamentId.slice(1, 5));
      for (const f of files) {
        const y = Number(f.match(/(\d{4})\.json$/)?.[1] ?? 0);
        if (y === currentYear) continue;
        try {
          const buf = await fs.readFile(f, "utf-8");
          const j = JSON.parse(buf) as HistoricalDump;
          prevYear = samplesFromHistorical(j);
          if (Object.keys(prevYear).length > 0) break;
        } catch {
          /* skip */
        }
      }
    } catch {
      /* swallow — falls through to par */
    }
  }

  return computeHoleAverages({
    currentRound,
    prevRound,
    prevYear,
    holePars,
  });
}
