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
  // v8 — v7 was populated during the deploy window BEFORE the
  // regenerated JSONs with pinsByRoundByHole reached the serverless
  // bundle, so the merge no-op'd and the cache stored replicated
  // pins across R1-R4. Bump so a fresh compute reads the now-in-
  // bundle JSONs and swaps in real per-round pins.
  return `feed:pins:v8:${tournamentId}`;
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
  /** Per-round per-hole pin coords from shotDetailsV3. Raw frame —
   *  the pin-birdies aggregator's affine calibration transforms them
   *  into the enhanced-frame green image at render time. Populated
   *  for every season 2019+ once the fetch script is re-run. */
  pinsByRoundByHole?: Record<string, Record<string, { x: number; y: number }>>;
}

/** Detects the "cached during a deploy window before the JSON
 *  landed" failure mode: a cache row where every hole's
 *  pinByRound is fully replicated across R1-R4, but the current
 *  historical JSON on disk has real per-round pins that would
 *  have replaced them. In that case we discard the cache and
 *  force a fresh compute. Safe to skip when the JSON doesn't
 *  carry pinsByRoundByHole (older writes or non-3M events). */
async function cachedSheetLooksStale(
  sheet: CoursePinSheet,
  tournamentId: string,
): Promise<boolean> {
  const ref = historicalRefFor(tournamentId);
  if (!ref) return false;
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
    return false;
  }
  const perRound = hist.pinsByRoundByHole ?? null;
  if (!perRound) return false;
  // Does the JSON carry any (round, hole) with real per-round pin?
  let anyPerRound = false;
  for (const byHole of Object.values(perRound)) {
    if (byHole && Object.keys(byHole).length > 0) {
      anyPerRound = true;
      break;
    }
  }
  if (!anyPerRound) return false;
  // Is every hole's cached pinByRound fully replicated across R1-R4?
  // If yes AND the JSON has per-round data, the cache is stale.
  const allReplicated = sheet.holes.every((h) => {
    const entries = Object.entries(h.pinByRound);
    if (entries.length < 2) return true; // insufficient data — treat as OK
    const first = entries[0][1];
    for (let i = 1; i < entries.length; i++) {
      const p = entries[i][1];
      if (
        Math.abs(p.x - first.x) > 0.001 ||
        Math.abs(p.y - first.y) > 0.001
      ) {
        return false;
      }
    }
    return true;
  });
  return allReplicated;
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
  // Per-round pin coords from shotDetailsV3, indexed as
  // `${round}:${hole}` for parity with the yardage map above.
  // Only useful for 2019-2022 where courseStats gave us just one
  // roundless pin per hole — the parser replicated it to R1-R4,
  // so pinByRound entries currently coincide across rounds. We
  // overwrite those replicated coords with the real per-round
  // pins so downstream rendering (both solo mode and the birdie
  // aggregator) sees distinct positions.
  const pinsByRoundHole = new Map<
    string,
    { x: number; y: number }
  >();
  const perRound = hist.pinsByRoundByHole ?? null;
  if (perRound) {
    for (const [rStr, byHole] of Object.entries(perRound)) {
      const round = Number(rStr);
      if (!Number.isFinite(round)) continue;
      for (const [hStr, coord] of Object.entries(byHole ?? {})) {
        const hole = Number(hStr);
        if (!Number.isFinite(hole)) continue;
        if (
          typeof coord?.x === "number" &&
          typeof coord?.y === "number" &&
          Number.isFinite(coord.x) &&
          Number.isFinite(coord.y)
        ) {
          pinsByRoundHole.set(`${round}:${hole}`, { x: coord.x, y: coord.y });
        }
      }
    }
  }

  if (yardsByRoundHole.size === 0 && pinsByRoundHole.size === 0) return sheet;

  // Detect the "roundless-replicated" case per hole — every round
  // is present in pinByRound but they all coincide. That's the
  // signal that our historical per-round pins are strictly better
  // than what the orchestrator gave us for this hole. Holes with
  // genuinely distinct per-round pinByRound coords (2023+) keep
  // the orchestrator values.
  function pinByRoundIsReplicated(
    hole: CoursePinSheet["holes"][number],
  ): boolean {
    const entries = Object.entries(hole.pinByRound);
    if (entries.length < 2) return false;
    const first = entries[0][1];
    for (let i = 1; i < entries.length; i++) {
      const p = entries[i][1];
      if (Math.abs(p.x - first.x) > 0.001 || Math.abs(p.y - first.y) > 0.001) {
        return false;
      }
    }
    return true;
  }

  const nextHoles = sheet.holes.map((holePin) => {
    let changed = false;
    // Yardage merge — unchanged from before, fills only empty slots.
    const yardsByRound = { ...(holePin.yardsByRound ?? {}) };
    for (const r of [1, 2, 3, 4]) {
      if (yardsByRound[r]) continue;
      const y = yardsByRoundHole.get(`${r}:${holePin.holeNumber}`);
      if (y != null) {
        yardsByRound[r] = y;
        changed = true;
      }
    }
    // Pin merge — overwrite the replicated roundless pin with the
    // real per-round pins when we have them AND the current
    // pinByRound is all-coincident (parser had nothing better to
    // work with). Real per-round data (2023+) stays authoritative.
    let pinByRound = holePin.pinByRound;
    if (pinsByRoundHole.size > 0 && pinByRoundIsReplicated(holePin)) {
      const next: typeof pinByRound = {};
      let anyReplaced = false;
      for (const r of [1, 2, 3, 4]) {
        const perRoundPin = pinsByRoundHole.get(
          `${r}:${holePin.holeNumber}`,
        );
        if (perRoundPin) {
          // Raw frame — no frameEnh flag; the birdie aggregator's
          // affine fit will transform these to enhanced frame.
          next[r] = { x: perRoundPin.x, y: perRoundPin.y };
          anyReplaced = true;
        } else if (holePin.pinByRound[r]) {
          next[r] = holePin.pinByRound[r];
        }
      }
      if (anyReplaced) {
        pinByRound = next;
        changed = true;
      }
    }
    return changed ? { ...holePin, yardsByRound, pinByRound } : holePin;
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
  //
  // Defensive: reject a cached sheet whose pinByRound looks
  // "replicated" (all four rounds coincide) IF a historical file
  // that could have supplied real per-round pins exists on disk.
  // That guards against cache poisoning during deploy windows
  // when the code+data land in different commits — a fresh
  // compute against the current bundle takes over automatically.
  if (!debug) {
    try {
      const cached = await redis.get<CoursePinSheet>(cacheKey(tournamentId));
      if (cached) {
        const stale = await cachedSheetLooksStale(cached, tournamentId);
        if (!stale) {
          return NextResponse.json({ ok: true, cached: true, pins: cached });
        }
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
