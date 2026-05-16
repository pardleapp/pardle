/**
 * DataGolf API client.
 *
 * Endpoints used:
 *   GET /get-schedule           → current PGA Tour / DP World / KFT / LIV / etc. schedule
 *   GET /field-updates          → field for the upcoming tournament
 *   GET /preds/live-tournament-stats   → live per-player round stats
 *
 * Auth is via ?key=... query param. The key lives in a Vercel env var —
 * we accept either `DATAGOLF_API_KEY` (conventional) or `DATAGOLF`
 * (the name currently set on the project).
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
  const k = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
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
// Pre-tournament predictions — used to rank the field into tiers
// ──────────────────────────────────────────────────────────────────

interface DGPreTournamentRow {
  dg_id: number;
  player_name: string; // "Last, First"
  country?: string;
  win?: number;
  top_5?: number;
  top_10?: number;
  top_20?: number;
  make_cut?: number;
}

interface DGPreTournamentResponse {
  baseline?: DGPreTournamentRow[];
  // DataGolf sometimes nests under baseline_history_fit too; baseline is canonical.
}

export interface RankedGolfer {
  dgId: string;
  name: string;
  country?: string;
  /** Win probability (0..1) — the ranking key. */
  winProb: number;
  /** 1-based rank within the field, 1 = best. */
  fieldRank: number;
}

/**
 * Field ranked best→worst by DataGolf win probability. This drives the
 * tier split (A = rank 1–10, B = 11–30, C = 31–60, D = 61+).
 */
export async function getFieldRanking(
  tour: string = "pga",
): Promise<RankedGolfer[]> {
  const data = await fetchJson<DGPreTournamentResponse>(
    `/preds/pre-tournament?tour=${encodeURIComponent(tour)}&odds_format=percent`,
  );
  const rows = data.baseline ?? [];
  return rows
    .map((r) => ({
      dgId: String(r.dg_id),
      name: flipName(r.player_name),
      country: r.country,
      winProb: r.win ?? 0,
    }))
    .sort((a, b) => b.winProb - a.winProb)
    .map((g, i) => ({ ...g, fieldRank: i + 1 }));
}

// ──────────────────────────────────────────────────────────────────
// Live win probabilities — "who's actually contending right now"
// ──────────────────────────────────────────────────────────────────

interface DGInPlayRow {
  dg_id: number;
  player_name: string; // "Last, First"
  country?: string;
  win?: number;
  top_5?: number;
  top_10?: number;
  current_pos?: string;
  current_score?: number;
}

interface DGInPlayResponse {
  data?: DGInPlayRow[];
}

export interface LiveContender {
  dgId: string;
  name: string;
  /** Win probability 0..1 — updates live as the tournament plays out. */
  winProb: number;
  currentPos: string;
}

/**
 * Players ranked by live win probability for the in-progress event.
 * This is the genuine "most likely to win" — it folds in current
 * score, holes remaining and player skill, so it surfaces real
 * contenders rather than whoever happened to tee off early and go low.
 */
export async function getLiveContenders(): Promise<LiveContender[]> {
  const data = await fetchJson<DGInPlayResponse>(`/preds/in-play`);
  const rows = data.data ?? [];
  return rows
    .map((r) => ({
      dgId: String(r.dg_id),
      name: flipName(r.player_name),
      winProb: r.win ?? 0,
      currentPos: String(r.current_pos ?? "--"),
    }))
    .filter((c) => c.winProb > 0)
    .sort((a, b) => b.winProb - a.winProb);
}

export interface InPlayProb {
  dgId: string;
  name: string;
  winProb: number;
}

/**
 * Every active player's live win probability — same source as
 * getLiveContenders but unfiltered, used to populate the outright
 * bet chart's fallback buffer for players Polymarket isn't tracking
 * liquidly (e.g. longshot contenders).
 */
export async function getInPlayWinProbs(): Promise<InPlayProb[]> {
  const data = await fetchJson<DGInPlayResponse>(`/preds/in-play`);
  const rows = data.data ?? [];
  return rows
    .map((r) => ({
      dgId: String(r.dg_id),
      name: flipName(r.player_name),
      winProb: typeof r.win === "number" ? r.win : 0,
    }))
    .filter((p) => Number.isFinite(p.winProb));
}

// ──────────────────────────────────────────────────────────────────
// Skill ratings — per-player current SG (used by round-score model)
// ──────────────────────────────────────────────────────────────────

interface DGSkillRow {
  dg_id: number;
  player_name: string;
  sg_total?: number;
  sg_ott?: number;
  sg_app?: number;
  sg_arg?: number;
  sg_putt?: number;
}

interface DGSkillResponse {
  players?: DGSkillRow[];
}

export interface DGSkillRating {
  dgId: string;
  name: string;
  /** Strokes gained per round vs current field. Negative = better. */
  sgTotal: number;
}

/**
 * DataGolf's current skill estimates — refreshed weekly. SG_total is
 * "expected strokes gained per round vs an average tour field" using
 * the bayesian rolling fit DataGolf publishes. Negative = worse than
 * field; we flip it in the consumer so "per-hole adjustment to add
 * to par" is the natural sign.
 */
export async function getSkillRatings(): Promise<DGSkillRating[]> {
  const data = await fetchJson<DGSkillResponse>(
    `/preds/skill-ratings?display=value`,
  );
  const rows = data.players ?? [];
  return rows.map((r) => ({
    dgId: String(r.dg_id),
    name: flipName(r.player_name),
    sgTotal: Number.isFinite(r.sg_total) ? Number(r.sg_total) : 0,
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
  // Strokes-gained breakdown — populated when the `stats=` param
  // requests them. Values are strokes gained vs the field per round
  // (or per the requested round window).
  sg_total?: number;
  sg_t2g?: number; // tee-to-green
  sg_ott?: number; // off-the-tee
  sg_app?: number; // approach
  sg_arg?: number; // around-the-green
  sg_putt?: number;
  // Non-SG misc
  distance?: number; // driving distance, yds
  accuracy?: number; // driving accuracy, 0..1
  gir?: number; // greens in regulation, 0..1
  prox_rgh?: number; // proximity from rough, feet
  prox_fw?: number; // proximity from fairway, feet
  scrambling?: number; // 0..1
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

// ──────────────────────────────────────────────────────────────────
// Full live stats — SG breakdown + driving/GIR/etc for player pages
// ──────────────────────────────────────────────────────────────────

const FULL_STATS_LIST = [
  "sg_total",
  "sg_t2g",
  "sg_ott",
  "sg_app",
  "sg_arg",
  "sg_putt",
  "distance",
  "accuracy",
  "gir",
  "scrambling",
  "prox_rgh",
  "prox_fw",
].join(",");

export interface FullLiveStats {
  dgId: string;
  name: string;
  position: string | null;
  total: number | null;
  thru: number | null;
  sgTotal: number | null;
  sgT2G: number | null;
  sgOtt: number | null;
  sgApp: number | null;
  sgArg: number | null;
  sgPutt: number | null;
  drivingDist: number | null;
  drivingAcc: number | null;
  gir: number | null;
  scrambling: number | null;
  proxRgh: number | null;
  proxFw: number | null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Full per-player live stats for a round window. `round` accepts a
 * 1-4 round number (that round only) or "event_avg" for the
 * tournament-wide aggregate. DataGolf computes strokes-gained vs
 * the field; positive = better than field by that many strokes per
 * round (tournament-wide averages it across played rounds).
 */
export async function getFullLiveStats(
  round: number | "event_avg" = "event_avg",
  tour: string = "pga",
): Promise<FullLiveStats[]> {
  const data = await fetchJson<DGLiveResponse>(
    `/preds/live-tournament-stats?tour=${encodeURIComponent(tour)}&round=${round}&stats=${FULL_STATS_LIST}&display=value`,
  );
  const rows = data.live_stats ?? [];
  return rows.map((r) => ({
    dgId: String(r.dg_id),
    name: flipName(r.player_name),
    position: r.current_pos != null ? String(r.current_pos) : null,
    total: numOrNull(r.current_score),
    thru: numOrNull(r.thru),
    sgTotal: numOrNull(r.sg_total),
    sgT2G: numOrNull(r.sg_t2g),
    sgOtt: numOrNull(r.sg_ott),
    sgApp: numOrNull(r.sg_app),
    sgArg: numOrNull(r.sg_arg),
    sgPutt: numOrNull(r.sg_putt),
    drivingDist: numOrNull(r.distance),
    drivingAcc: numOrNull(r.accuracy),
    gir: numOrNull(r.gir),
    scrambling: numOrNull(r.scrambling),
    proxRgh: numOrNull(r.prox_rgh),
    proxFw: numOrNull(r.prox_fw),
  }));
}
