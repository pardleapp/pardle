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

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const CACHE_TTL = 6 * 60 * 60;

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
  familyNames: string[]; // lowercased tournament names that map here
  historical: Array<{ year: number; tournamentId: string }>;
  /** Extra tournamentIds (typically the current-season id) that
   *  aren't in the historical list but still belong to this family. */
  otherIds: string[];
}

const TOURNAMENT_FAMILIES: FamilyDef[] = [
  {
    slug: "3m-open",
    familyNames: ["3m open"],
    historical: [
      // First 3M Open at TPC Twin Cities was 2019 — every year on
      // file since. 2019-2022 orchestrator payloads only carry a
      // roundless pin per hole (parser replicates it across R1-R4);
      // 2023 carries per-round pins in raw coords only (enhanced
      // fields are the -1 sentinel); 2024/2025 have full per-round
      // enhanced coords. See pgatour.ts pickPinCoord for the coord
      // priority — all four seasons contribute birdie counts either
      // way.
      { year: 2019, tournamentId: "R2019525" },
      { year: 2020, tournamentId: "R2020525" },
      { year: 2021, tournamentId: "R2021525" },
      { year: 2022, tournamentId: "R2022525" },
      { year: 2023, tournamentId: "R2023525" },
      { year: 2024, tournamentId: "R2024525" },
      { year: 2025, tournamentId: "R2025525" },
    ],
    otherIds: ["R2026525"],
  },
];

/** Find the family a tournamentId belongs to.
 *  Try the hardcoded id lists first (works for any historical id
 *  without hitting the network); fall back to a name lookup against
 *  the current-year schedule so brand-new live ids still resolve
 *  before we've had a chance to hardcode them. */
async function familyFor(tournamentId: string): Promise<FamilyDef | null> {
  const hardcoded = TOURNAMENT_FAMILIES.find(
    (f) =>
      f.otherIds.includes(tournamentId) ||
      f.historical.some((h) => h.tournamentId === tournamentId),
  );
  if (hardcoded) return hardcoded;

  const year = String(new Date().getUTCFullYear());
  const sched = await getSchedule(year);
  const match = [...sched.completed, ...sched.upcoming].find(
    (t) => t.id === tournamentId,
  );
  if (!match) return null;
  const name = match.name.toLowerCase().trim();
  return TOURNAMENT_FAMILIES.find((f) => f.familyNames.includes(name)) ?? null;
}

// ── Endpoint ────────────────────────────────────────────────────────

function cacheKey(tournamentId: string): string {
  // v6 — parser now falls back to raw coords when enhanced are the
  // -1 sentinel (unlocks 2023) and replicates roundless pins across
  // R1-R4 (unlocks 2019-2022). Old v5 responses were computed with
  // 2023-2025 only; bump so we recompute with 7 seasons of data.
  return `feed:pin-birdies:v6:${tournamentId}`;
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
    let pins: CoursePinSheet | null = null;
    if (!refreshPins) {
      try {
        pins = await redis.get<CoursePinSheet>(`feed:pins:v3:${ev.tournamentId}`);
      } catch {
        /* cache miss */
      }
    }
    if (!pins) {
      try {
        pins = await getCoursePins(ev.tournamentId);
        if (pins) {
          try {
            await redis.set(`feed:pins:v3:${ev.tournamentId}`, pins, {
              ex: CACHE_TTL,
            });
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
