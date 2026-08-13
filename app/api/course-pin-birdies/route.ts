/**
 * /api/course-pin-birdies?tournamentId=R2026525
 *
 * Multi-season birdie-or-better analysis for every hole on the
 * course of a given tournament. Combines:
 *   - Historical scoring per (hole, round) from data/historical/
 *     JSON files (currently 3M Open 2023 / 2024 / 2025).
 *   - Live scoring from PGA Tour scorecards for the current event.
 *   - Pin positions from the orchestrator (getCoursePins), cached
 *     under feed:pins:{tournamentId}.
 *
 * Returns per-hole:
 *   - every pin position that has scoring, with its birdie rate
 *   - quadrant summaries (TL / TR / BL / BR) across all pins
 *   - overall rate for the hole
 *
 * 6-hour Redis cache; the surface here is stable-ish (scores update
 * mid-round but the per-hole rates move slowly with 156-player
 * samples).
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import {
  getCoursePins,
  getScorecards,
  getShotDetailsBatch,
  getLeaderboard,
  getSchedule,
  type CoursePinSheet,
  type PGAScorecard,
} from "@/lib/golf-api/pgatour";
import {
  buildAllHoles,
  holeRoundKey,
  tallyPlayerHole,
  type EventInput,
  type PerHoleRoundCounts,
} from "@/lib/analysis/course-birdies";
import { augmentYardsFromHistorical } from "@/lib/pin-sheet-augment";
import { listTournamentConfigs } from "@/lib/scoring-model/tournament-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const CACHE_TTL = 6 * 60 * 60;

/** Pull shot-details for 20 finishers × 4 rounds of a modern
 *  tournament and extract (rawX, rawY, enhX, enhY) pairs from every
 *  on-green stroke where both frames are populated. That's several
 *  hundred pairs per hole distributed across the whole green — a
 *  much richer calibration source than the 4 pin coords per year
 *  courseStats gives us. Returns per-hole pair arrays; empty when
 *  the tournament doesn't have paired green coord data. */
async function gatherGreenCalibrationPairs(
  tournamentId: string,
): Promise<
  Record<number, Array<{ rawX: number; rawY: number; x: number; y: number }>>
> {
  const lb = await getLeaderboard(tournamentId);
  const players = lb.slice(0, 20).map((r) => r.playerId);
  const requests: Array<{ playerId: string; round: number }> = [];
  for (const pid of players) {
    for (let r = 1; r <= 4; r++) requests.push({ playerId: pid, round: r });
  }
  const shots = await getShotDetailsBatch(tournamentId, requests);
  const perHole: Record<
    number,
    Array<{ rawX: number; rawY: number; x: number; y: number }>
  > = {};
  const push = (
    hole: number,
    rawX?: number,
    rawY?: number,
    x?: number,
    y?: number,
  ) => {
    const ok = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n !== -1 && n >= 0;
    if (!ok(rawX) || !ok(rawY) || !ok(x) || !ok(y)) return;
    (perHole[hole] ??= []).push({ rawX, rawY, x, y });
  };
  for (const holes of Object.values(shots)) {
    for (const hole of holes ?? []) {
      const holeNum = hole.holeNumber;
      if (typeof holeNum !== "number") continue;
      for (const s of hole.strokes ?? []) {
        if (s.fromLocationCode !== "OGR") continue;
        push(
          holeNum,
          s.greenFromRawX,
          s.greenFromRawY,
          s.greenFromEnhX,
          s.greenFromEnhY,
        );
        push(
          holeNum,
          s.greenToRawX,
          s.greenToRawY,
          s.greenToEnhX,
          s.greenToEnhY,
        );
      }
    }
  }
  return perHole;
}

// ── Historical file schema (matches scripts/fetch-3m-historical.mjs) ─
interface HistPlayerHole {
  strokes: number;
  par: number;
}
interface HistPlayerRound {
  holes?: Record<string, HistPlayerHole> | null;
}
interface HistPlayer {
  rounds: Record<string, HistPlayerRound>;
}
interface HistPayload {
  year: number;
  dgEventName?: string;
  pgaTournamentId?: string;
  players: HistPlayer[];
}

/** Read a historical file if it exists; null on any error so a
 *  missing year (e.g. course was rejigged) doesn't take the whole
 *  endpoint down. */
async function readHistorical(slug: string, year: number): Promise<HistPayload | null> {
  const p = path.join(process.cwd(), "data", "historical", `${slug}-${year}.json`);
  try {
    const text = await readFile(p, "utf-8");
    return JSON.parse(text) as HistPayload;
  } catch {
    return null;
  }
}

/** Tally per-hole birdie counts from a historical payload. */
function countsFromHistorical(payload: HistPayload): PerHoleRoundCounts {
  const counts = new Map();
  for (const player of payload.players ?? []) {
    for (const [rStr, r] of Object.entries(player.rounds ?? {})) {
      const round = Number(rStr);
      if (!Number.isFinite(round)) continue;
      const holes = r.holes ?? {};
      for (const [hStr, h] of Object.entries(holes)) {
        const hole = Number(hStr);
        if (!Number.isFinite(hole)) continue;
        tallyPlayerHole(counts, hole, round, h.strokes, h.par);
      }
    }
  }
  return counts;
}

/** Tally live scorecards. `scorecards` = playerId → PGAScorecard. */
function countsFromScorecards(
  scorecards: Record<string, PGAScorecard>,
): PerHoleRoundCounts {
  const counts = new Map();
  for (const sc of Object.values(scorecards)) {
    for (const [rStr, holes] of Object.entries(sc.rounds ?? {})) {
      const round = Number(rStr);
      if (!Number.isFinite(round)) continue;
      for (const h of holes ?? []) {
        const strokesNum = Number(h.score);
        if (!Number.isFinite(strokesNum) || strokesNum <= 0) continue;
        tallyPlayerHole(counts, h.holeNumber, round, strokesNum, h.par);
      }
    }
  }
  return counts;
}

// ── Tournament-family lookup ────────────────────────────────────────
// We know 3M Open historically (3 seasons on file + the live event).
// Other events fall back to just their own single-tournament data.
// Adding more courses = adding a slug, its historical ids per year,
// and its known current-year id(s).

interface FamilyDef {
  slug: string;
  familyNames: string[]; // lowercased event names that map here
  historical: Array<{ year: number; tournamentId: string }>;
  /** Extra tournamentIds (typically the current-season id) that
   *  aren't in the historical list but still belong to this family. */
  otherIds: string[];
}

/** Look up the family (slug + historical/live ids) for a given
 *  tournamentId. Fully dynamic — derives from whatever historical
 *  JSONs the fetch script has produced. If nothing matches, returns
 *  null and the caller reports "no family for this tournament" so
 *  the caller reports the new-venue state upstream. */
async function familyFor(tournamentId: string): Promise<FamilyDef | null> {
  const configs = await listTournamentConfigs();
  for (const cfg of configs) {
    const historical = Object.entries(cfg.historicalTournamentIds)
      .map(([y, id]) => ({ year: Number(y), tournamentId: id }))
      .sort((a, b) => a.year - b.year);
    const historicalIds = historical.map((h) => h.tournamentId);
    const inHistorical = historicalIds.includes(tournamentId);
    const isDerivedLive =
      cfg.tournamentIdSuffix &&
      tournamentId ===
        `R${new Date().getUTCFullYear()}${cfg.tournamentIdSuffix}`;
    if (inHistorical || isDerivedLive) {
      return {
        slug: cfg.slug,
        familyNames: [cfg.eventName.toLowerCase().trim()],
        historical,
        otherIds: isDerivedLive ? [tournamentId] : [],
      };
    }
  }

  // Fallback: match by live schedule name against known slugs.
  const year = String(new Date().getUTCFullYear());
  try {
    const sched = await getSchedule(year);
    const match = [...sched.completed, ...sched.upcoming].find(
      (t) => t.id === tournamentId,
    );
    if (!match) return null;
    const name = match.name.toLowerCase().trim();
    for (const cfg of configs) {
      if (cfg.eventName.toLowerCase().trim() === name) {
        const historical = Object.entries(cfg.historicalTournamentIds)
          .map(([y, id]) => ({ year: Number(y), tournamentId: id }))
          .sort((a, b) => a.year - b.year);
        return {
          slug: cfg.slug,
          familyNames: [name],
          historical,
          otherIds: [tournamentId],
        };
      }
    }
  } catch {
    // schedule fetch failed — nothing to do
  }
  return null;
}

// ── Endpoint ────────────────────────────────────────────────────────

function cacheKey(tournamentId: string): string {
  // v15 — force-refresh after this week's onboarding of the FedEx
  // St. Jude Championship (fedex-stjude slug + 7 historical years
  // now on file). v14 payloads for R2026027 predate the family
  // registration and would have familySlug: null and only the
  // live event's data. v14 payloads for the other three tournaments
  // are fine but bumping globally keeps every family cohort in
  // sync post-onboarding.
  return `feed:pin-birdies:v15:${tournamentId}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tournamentId = url.searchParams.get("tournamentId");
  const nocache = url.searchParams.get("nocache") === "1";
  if (!tournamentId) {
    return NextResponse.json(
      { ok: false, error: "tournamentId required" },
      { status: 400 },
    );
  }

  if (!nocache) {
    try {
      const cached = await redis.get(cacheKey(tournamentId));
      if (cached) {
        return NextResponse.json({ ok: true, cached: true, ...cached });
      }
    } catch {
      /* cache miss / read fail — proceed to fresh compute */
    }
  }

  const refreshPins = url.searchParams.get("refreshPins") === "1";
  const family = await familyFor(tournamentId);

  // Build the list of events we'll aggregate. Order matters — earlier
  // events are considered first, so their par / image URL win when a
  // later event omits them (matches the "stable metadata" behaviour
  // in buildHoleBirdieData).
  const eventsToLoad: Array<{ year: number; tournamentId: string; historical: boolean }> = [];
  if (family) {
    for (const h of family.historical) {
      eventsToLoad.push({ year: h.year, tournamentId: h.tournamentId, historical: true });
    }
  }
  // Add the current event unless it's already in the historical list.
  if (!eventsToLoad.some((e) => e.tournamentId === tournamentId)) {
    eventsToLoad.push({
      year: new Date().getUTCFullYear(),
      tournamentId,
      historical: false,
    });
  }

  // Load each event's pins + counts.
  const inputs: EventInput[] = [];
  for (const ev of eventsToLoad) {
    // Pins — hit the shared cache from /api/course-pins first so we
    // aren't paying orchestrator twice for a hot tournament.
    // refreshPins=1 bypasses the read to force a fresh orchestrator
    // fetch (used when the cached payload was populated by a buggy
    // parser and needs to be replaced).
    // Cache key must match /api/course-pins so both routes share
    // ONE pin-sheet cache — otherwise this route can populate a raw
    // (unaugmented) sheet that /api/course-pins then reads back and
    // returns without augmenting.  v9: cache-invalidation bump — v8
    // rows were populated by this route WITHOUT augmentYardsFromHistorical,
    // so pre-2023 events had replicated per-round pins and the
    // birdie-history modal showed all four dots stacked in one spot.
    const cacheKey = `feed:pins:v9:${ev.tournamentId}`;
    let pins: CoursePinSheet | null = null;
    if (!refreshPins) {
      try {
        pins = await redis.get<CoursePinSheet>(cacheKey);
      } catch {
        /* cache miss */
      }
    }
    if (!pins) {
      try {
        pins = await getCoursePins(ev.tournamentId);
        if (pins) {
          // Apply the shared augment — for pre-2023 events, this
          // swaps in the real per-round pins from
          // pinsByRoundByHole (fetched via shotDetailsV3 and
          // written to data/historical/*.json). Without this step,
          // pinByRound stays replicated and the birdie-history
          // modal's four round dots stack on top of each other.
          pins = await augmentYardsFromHistorical(pins, ev.tournamentId);
          try {
            await redis.set(cacheKey, pins, { ex: CACHE_TTL });
          } catch {
            /* cache write failure not fatal */
          }
        }
      } catch {
        pins = null;
      }
    }
    if (!pins) continue;

    // Counts — historical file OR live scorecards.
    let counts: PerHoleRoundCounts | null = null;
    if (ev.historical && family) {
      const hist = await readHistorical(family.slug, ev.year);
      if (hist) counts = countsFromHistorical(hist);
    } else {
      // Live year — pull the field, batch-fetch scorecards.
      try {
        const leaderboard = await getLeaderboard(ev.tournamentId);
        const playerIds = leaderboard.map((r) => r.playerId);
        if (playerIds.length > 0) {
          const scorecards = await getScorecards(ev.tournamentId, playerIds);
          counts = countsFromScorecards(scorecards);
        }
      } catch {
        counts = null;
      }
    }
    if (!counts) continue;

    inputs.push({
      year: ev.year,
      tournamentId: ev.tournamentId,
      pins: pins.holes,
      counts,
    });
  }

  // Enrich the calibration inputs with green stroke (raw, enh) pairs
  // from a modern-year putt sheet. Every on-green stroke gives us
  // TWO calibration data points (from-coord and to-coord), and
  // there are hundreds per hole, spread across the whole green —
  // enough that the per-hole affine fit doesn't extrapolate at the
  // edges the way an 8-pin-pair-only fit does (H18 2019 R2/R3/R4
  // landed off the green with only pin pairs). Pick the newest
  // events we have on file that carry paired data; fall through
  // silently on any fetch error.
  const calibrationSourceEvents = inputs
    .filter((i) => i.year >= 2024)
    .slice(-2);
  for (const src of calibrationSourceEvents) {
    try {
      const pairs = await gatherGreenCalibrationPairs(src.tournamentId);
      if (Object.keys(pairs).length > 0) {
        src.extraCalibrationPairs = pairs;
      }
    } catch {
      /* calibration enrichment is best-effort */
    }
  }

  if (inputs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no data available" },
      { status: 404 },
    );
  }

  const holes = buildAllHoles(inputs);
  const payload = {
    tournamentId,
    familySlug: family?.slug ?? null,
    yearsCovered: [...new Set(inputs.map((i) => i.year))].sort(
      (a, b) => a - b,
    ),
    holes,
  };
  try {
    await redis.set(cacheKey(tournamentId), payload, { ex: CACHE_TTL });
  } catch {
    /* write-through not fatal */
  }
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
