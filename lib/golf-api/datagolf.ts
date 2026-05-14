/**
 * DataGolf API client.
 *
 * Endpoints used:
 *   GET /get-schedule           → current PGA Tour / DP World / KFT / LIV / etc. schedule
 *   GET /field-updates          → field for the upcoming tournament
 *   GET /preds/live-tournament-stats   → live per-player round stats
 *
 * Auth is via ?key=... query param. Key lives in DATAGOLF_API_KEY env.
 * Free tier is rate-limited but generous for our use case (one fetch
 * every 2-5 min during live tournament hours).
 *
 * Server-only — never import in client components or the key will leak
 * into the bundle.
 */

import "server-only";
import type { FieldGolfer, GolferRoundScore } from "@/lib/fantasy/types";

const BASE = "https://feeds.datagolf.com";

function key(): string {
  const k = process.env.DATAGOLF_API_KEY;
  if (!k) throw new Error("DATAGOLF_API_KEY is not set");
  return k;
}

async function fetchJson<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}key=${encodeURIComponent(key())}&file_format=json`;
  const res = await fetch(url, {
    // Live data — don't cache on the edge. Our own Redis cache wraps
    // calls at a higher level when we want to dedupe within a window.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`DataGolf ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ──────────────────────────────────────────────────────────────────
// Schedule
// ──────────────────────────────────────────────────────────────────

export interface DGScheduleEvent {
  event_id: number;
  event_name: string;
  course: string;
  start_date: string; // "YYYY-MM-DD"
  tour: string; // "pga" | "euro" | "kft" | "liv" | ...
}

interface DGScheduleResponse {
  schedule: DGScheduleEvent[];
}

/**
 * Returns the current/upcoming PGA Tour events. The closest start_date
 * to today (looking forward, then back as fallback) is "the" active
 * tournament for fantasy purposes.
 */
export async function getScheduleRaw(
  tour: string = "pga",
): Promise<DGScheduleEvent[]> {
  const data = await fetchJson<DGScheduleResponse>(
    `/get-schedule?tour=${encodeURIComponent(tour)}`,
  );
  return data.schedule ?? [];
}

/**
 * Pick the active event: latest event whose start_date <= today + 14d
 * AND end_date (start + 3) >= today - 1. We don't have an explicit
 * end date so we infer 4 rounds from start.
 */
export function pickActiveEvent(
  events: DGScheduleEvent[],
  today: Date = new Date(),
): DGScheduleEvent | null {
  const todayMs = today.getTime();
  const candidates = events
    .map((e) => {
      const start = new Date(e.start_date + "T00:00:00Z").getTime();
      const end = start + 4 * 24 * 60 * 60 * 1000; // 4 rounds inclusive
      return { e, start, end };
    })
    .filter(
      ({ start, end }) =>
        end >= todayMs - 24 * 60 * 60 * 1000 &&
        start <= todayMs + 14 * 24 * 60 * 60 * 1000,
    )
    .sort((a, b) => a.start - b.start);
  return candidates[0]?.e ?? null;
}

// ──────────────────────────────────────────────────────────────────
// Field
// ──────────────────────────────────────────────────────────────────

interface DGFieldEntry {
  dg_id: number;
  player_name: string; // "Last, First"
  country?: string;
  am?: number; // amateur flag
}

interface DGFieldResponse {
  event_name?: string;
  field?: DGFieldEntry[];
}

/** Normalise "Last, First" → "First Last". */
function flipName(name: string): string {
  const i = name.indexOf(",");
  if (i < 0) return name.trim();
  const last = name.slice(0, i).trim();
  const first = name.slice(i + 1).trim();
  return `${first} ${last}`;
}

export async function getFieldForActiveEvent(
  tour: string = "pga",
): Promise<FieldGolfer[]> {
  const data = await fetchJson<DGFieldResponse>(
    `/field-updates?tour=${encodeURIComponent(tour)}`,
  );
  const field = data.field ?? [];
  return field.map((p) => ({
    dgId: String(p.dg_id),
    name: flipName(p.player_name),
    country: p.country,
  }));
}

// ──────────────────────────────────────────────────────────────────
// Live tournament stats
// ──────────────────────────────────────────────────────────────────

interface DGLivePlayerRow {
  dg_id: number;
  player_name: string;
  current_pos?: string | number;
  current_score?: number; // to par overall
  thru?: number | string;
  round?: number; // 1..4 — current round number
  // Round stats — counts since round-N start (DataGolf exposes per-round
  // stats by repeating the call with round=1..4 or via per-round fields).
  birdies?: number;
  eagles?: number;
  doubles?: number; // doubles+
  bogeys?: number;
  pars?: number;
}

interface DGLiveResponse {
  event_name?: string;
  stat_round?: number;
  live_stats?: DGLivePlayerRow[];
}

/**
 * Live per-player stats for one round. DataGolf returns the round
 * specified by stat_round; we call it once per round and merge.
 */
export async function getLiveStatsForRound(
  round: 1 | 2 | 3 | 4,
  tour: string = "pga",
): Promise<GolferRoundScore[]> {
  const stats = ["birdies", "eagles", "doubles", "bogeys"].join(",");
  const data = await fetchJson<DGLiveResponse>(
    `/preds/live-tournament-stats?tour=${encodeURIComponent(tour)}&round=${round}&stats=${stats}`,
  );
  const rows = data.live_stats ?? [];
  return rows.map((r) => ({
    dgId: String(r.dg_id),
    round,
    strokes: null, // DataGolf doesn't return strokes in this endpoint;
    // we infer toPar from current_score where appropriate higher up.
    toPar: typeof r.current_score === "number" ? r.current_score : null,
    birdies: r.birdies ?? 0,
    eagles: r.eagles ?? 0,
    doubleEagles: 0, // DataGolf doesn't separately count albatrosses; rare enough to skip
    bogeys: r.bogeys ?? 0,
    doubles: r.doubles ?? 0,
    positionAfter:
      typeof r.current_pos === "number" ? r.current_pos : null,
  }));
}
