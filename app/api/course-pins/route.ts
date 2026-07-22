/**
 * /api/course-pins?tournamentId=R2026525
 *
 * Returns a per-hole × per-round pin sheet for a tournament, plus the
 * PGA Tour green-diagram image URL for each hole. Powers the pin
 * modal in the course-heatmap analysis page.
 *
 * Cache: 6-hour Redis TTL. Pin positions are set overnight and
 * unchanged during play; a 6-hour cache keeps the orchestrator hit
 * rate low without going stale.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import {
  getCoursePins,
  getCoursePinsWithDiag,
  type CoursePinSheet,
} from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const TTL_SECONDS = 6 * 60 * 60;

function cacheKey(tournamentId: string): string {
  // v6 — pre-v6 caches for 2019-2022 tournamentIds carry an empty
  // yardsByRound because the augmentYardsFromHistorical readFile
  // silently failed on Vercel (data/historical JSONs weren't in
  // the serverless bundle). next.config.mjs now traces those
  // files into the /api/course-pins bundle; bump the cache so
  // the augmentation actually runs and TEE Δ starts firing.
  return `feed:pins:v6:${tournamentId}`;
}

/** Map a tournamentId like "R2020525" back to the historical JSON
 *  slug/year (e.g. { slug: "3m-open", year: 2020 }). Returns null
 *  when the tournamentId doesn't fit our historical family scheme
 *  — the augmentation quietly no-ops for those. */
function historicalRefFor(
  tournamentId: string,
): { slug: string; year: number } | null {
  // 3M Open family — R{year}525 for every edition since 2019.
  const m3m = tournamentId.match(/^R(\d{4})525$/);
  if (m3m) return { slug: "3m-open", year: Number(m3m[1]) };
  return null;
}

/** Historical file shape (matches scripts/fetch-3m-historical.mjs +
 *  the /api/course-pin-birdies HistPayload). Kept local rather than
 *  shared because the shape is fetch-script-owned and evolves. */
interface HistHole {
  strokes: number;
  par: number;
  /** New in the v3 fetch — per-hole yardage from scorecardV3. Null
   *  on older files that were fetched before the yardage query
   *  landed. */
  yards?: number | null;
}
interface HistRound {
  holes?: Record<string, HistHole> | null;
}
interface HistPlayer {
  rounds?: Record<string, HistRound>;
}
interface HistFile {
  players?: HistPlayer[];
}

/** Merge per-round per-hole yardage from the historical JSON into
 *  the pin sheet's yardsByRound maps. Only fills entries that are
 *  actually missing — a year that already has per-round yardage in
 *  the orchestrator (2023+) stays authoritative. */
async function augmentYardsFromHistorical(
  sheet: CoursePinSheet,
  tournamentId: string,
): Promise<CoursePinSheet> {
  const ref = historicalRefFor(tournamentId);
  if (!ref) return sheet;
  const filePath = path.join(
    process.cwd(),
    "data",
    "historical",
    `${ref.slug}-${ref.year}.json`,
  );
  let hist: HistFile;
  try {
    const text = await readFile(filePath, "utf-8");
    hist = JSON.parse(text) as HistFile;
  } catch {
    return sheet;
  }
  // Aggregate per (round, hole) → yardage. Every player in the
  // field sees the same yardage in a round, so first-seen wins.
  const yardsByRoundHole = new Map<string, number>();
  for (const player of hist.players ?? []) {
    for (const [rStr, r] of Object.entries(player.rounds ?? {})) {
      const round = Number(rStr);
      if (!Number.isFinite(round)) continue;
      for (const [hStr, h] of Object.entries(r.holes ?? {})) {
        const hole = Number(hStr);
        if (!Number.isFinite(hole)) continue;
        const y = h?.yards;
        if (typeof y !== "number" || !Number.isFinite(y) || y <= 0) continue;
        const key = `${round}:${hole}`;
        if (!yardsByRoundHole.has(key)) yardsByRoundHole.set(key, y);
      }
    }
  }
  if (yardsByRoundHole.size === 0) return sheet;
  const nextHoles = sheet.holes.map((holePin) => {
    const yardsByRound = { ...(holePin.yardsByRound ?? {}) };
    let changed = false;
    for (const r of [1, 2, 3, 4]) {
      // Skip when the orchestrator already has a per-round yardage
      // for this (hole, round) — that value trumps our replay.
      if (yardsByRound[r]) continue;
      const y = yardsByRoundHole.get(`${r}:${holePin.holeNumber}`);
      if (y != null) {
        yardsByRound[r] = y;
        changed = true;
      }
    }
    return changed ? { ...holePin, yardsByRound } : holePin;
  });
  return { ...sheet, holes: nextHoles };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tournamentId = url.searchParams.get("tournamentId");
  const debug = url.searchParams.get("debug") === "1";
  if (!tournamentId) {
    return NextResponse.json(
      { ok: false, error: "tournamentId required" },
      { status: 400 },
    );
  }

  // Cache lookup first — pin data is stable for the day. Skip when
  // ?debug=1 so we can inspect the raw orchestrator response.
  if (!debug) {
    try {
      const cached = await redis.get<CoursePinSheet>(cacheKey(tournamentId));
      if (cached) {
        return NextResponse.json({ ok: true, cached: true, pins: cached });
      }
    } catch {
      /* cache-miss safe to ignore */
    }
  }

  if (debug) {
    // Bypass cache and surface the raw payload so we can debug when
    // parsing returns null. Not part of the normal client flow.
    const result = await getCoursePinsWithDiag(tournamentId);
    return NextResponse.json({
      ok: result.sheet != null,
      pins: result.sheet,
      raw: result.raw,
    });
  }

  let fresh: CoursePinSheet | null;
  try {
    fresh = await getCoursePins(tournamentId);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
  if (!fresh) {
    return NextResponse.json(
      { ok: false, error: "no pin data available" },
      { status: 404 },
    );
  }
  // Fill per-round yardage from data/historical/*.json when the
  // orchestrator returned a roundless-only courseStats (2019-2022).
  // A no-op for years already carrying yardsByRound.
  fresh = await augmentYardsFromHistorical(fresh, tournamentId);
  try {
    await redis.set(cacheKey(tournamentId), fresh, { ex: TTL_SECONDS });
  } catch {
    /* write-through failure is not fatal */
  }
  return NextResponse.json({ ok: true, cached: false, pins: fresh });
}
