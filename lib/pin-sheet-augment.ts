/**
 * Shared augmentation for CoursePinSheet objects returned by
 * getCoursePins. Merges per-round yardage AND per-round pin coords
 * from data/historical/*.json into the orchestrator's response.
 *
 * Why this exists: for 2019-2022 editions, orchestrator's courseStats
 * only ships ONE roundless pin per hole, which the parser replicates
 * across R1-R4. Without this augment step, every round's pin dot
 * lands on top of every other round's — the four coloured dots in
 * the birdie-history modal cluster in one spot instead of scattering
 * across the green. shotDetailsV3 has the real per-round pins going
 * back to ~2017; the fetch script pulls them into pinsByRoundByHole
 * on the historical JSONs, and this augment merges them into the
 * live CoursePinSheet shape at request time.
 *
 * Previously this lived inline in app/api/course-pins/route.ts. Was
 * extracted into a shared module so /api/course-pin-birdies (which
 * also reads pins via getCoursePins and previously cached the raw
 * unaugmented result) can apply the same fix — otherwise the pin
 * cache stayed populated with replicated coords and pre-2023 birdie
 * modals kept showing the four-dot cluster bug.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CoursePinSheet } from "@/lib/golf-api/pgatour";

/** Family/year mapping so we can resolve tournamentId → historical
 *  slug/year (e.g. { slug: "3m-open", year: 2020 }). Returns null
 *  when the tournamentId doesn't fit our historical family scheme
 *  — the augmentation quietly no-ops for those. */
export function historicalRefFor(
  tournamentId: string,
): { slug: string; year: number } | null {
  // 3M Open family — R{year}525 for every edition since 2019.
  const m3m = tournamentId.match(/^R(\d{4})525$/);
  if (m3m) return { slug: "3m-open", year: Number(m3m[1]) };
  return null;
}

/** Historical file shape (matches scripts/fetch-3m-historical.mjs +
 *  the /api/course-pin-birdies HistPayload). Kept in this shared
 *  module so both consumers use the same view of the data. */
interface HistHole {
  strokes: number;
  par: number;
  yards?: number | null;
}
interface HistRound {
  holes?: Record<string, HistHole> | null;
}
interface HistPlayer {
  rounds?: Record<string, HistRound>;
}
export interface HistFile {
  players?: HistPlayer[];
  /** Per-round per-hole pin coords from shotDetailsV3. Raw frame —
   *  the pin-birdies aggregator's affine calibration transforms them
   *  into the enhanced-frame green image at render time. Populated
   *  for every season 2019+ once the fetch script is re-run. */
  pinsByRoundByHole?: Record<string, Record<string, { x: number; y: number }>>;
}

/** Read the historical JSON for a tournamentId. Returns null when
 *  the tournament isn't in the historical family or the file is
 *  missing / malformed — callers should treat that as "no augment
 *  data available" and pass the sheet through unchanged. */
async function loadHistoricalFile(
  tournamentId: string,
): Promise<{ ref: { slug: string; year: number }; hist: HistFile } | null> {
  const ref = historicalRefFor(tournamentId);
  if (!ref) return null;
  const filePath = path.join(
    process.cwd(),
    "data",
    "historical",
    `${ref.slug}-${ref.year}.json`,
  );
  try {
    const text = await readFile(filePath, "utf-8");
    return { ref, hist: JSON.parse(text) as HistFile };
  } catch {
    return null;
  }
}

/** Detects the "cached during a deploy window before the JSON
 *  landed" failure mode: a cache row where every hole's
 *  pinByRound is fully replicated across R1-R4, but the current
 *  historical JSON on disk has real per-round pins that would
 *  have replaced them. In that case we discard the cache and
 *  force a fresh compute. Safe to skip when the JSON doesn't
 *  carry pinsByRoundByHole (older writes or non-3M events). */
export async function cachedSheetLooksStale(
  sheet: CoursePinSheet,
  tournamentId: string,
): Promise<boolean> {
  const loaded = await loadHistoricalFile(tournamentId);
  if (!loaded) return false;
  const perRound = loaded.hist.pinsByRoundByHole ?? null;
  if (!perRound) return false;
  let anyPerRound = false;
  for (const byHole of Object.values(perRound)) {
    if (byHole && Object.keys(byHole).length > 0) {
      anyPerRound = true;
      break;
    }
  }
  if (!anyPerRound) return false;
  const allReplicated = sheet.holes.every((h) => {
    const entries = Object.entries(h.pinByRound);
    if (entries.length < 2) return true;
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

/** Merge per-round per-hole yardage AND per-round pin coords from
 *  the historical JSON into the pin sheet. Only overwrites entries
 *  that are missing (yardage) or all-coincident (pins). A year that
 *  already has per-round yardage/pins in the orchestrator (2023+)
 *  stays authoritative.
 *
 *  Call this once on any CoursePinSheet before caching or returning
 *  it — the two current callers (/api/course-pins and
 *  /api/course-pin-birdies) both need it, and doing it in a shared
 *  helper avoids the failure mode where one route caches the raw
 *  unaugmented result and poisons the cache for the other. */
export async function augmentYardsFromHistorical(
  sheet: CoursePinSheet,
  tournamentId: string,
): Promise<CoursePinSheet> {
  const loaded = await loadHistoricalFile(tournamentId);
  if (!loaded) return sheet;
  const hist = loaded.hist;
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

  const pinsByRoundHole = new Map<string, { x: number; y: number }>();
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
          pinsByRoundHole.set(`${round}:${hole}`, {
            x: coord.x,
            y: coord.y,
          });
        }
      }
    }
  }

  if (yardsByRoundHole.size === 0 && pinsByRoundHole.size === 0) return sheet;

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
    const yardsByRound = { ...(holePin.yardsByRound ?? {}) };
    for (const r of [1, 2, 3, 4]) {
      if (yardsByRound[r]) continue;
      const y = yardsByRoundHole.get(`${r}:${holePin.holeNumber}`);
      if (y != null) {
        yardsByRound[r] = y;
        changed = true;
      }
    }
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
          // affine fit transforms these to the enhanced frame.
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
