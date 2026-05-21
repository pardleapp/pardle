/**
 * Redis cache for DataGolf historical-event data. Used by the
 * per-tournament drill-down page that powers the clickable
 * recent-form rows on a player profile.
 *
 * Two endpoints, two caches:
 *   - event-list (~all events ever, ~150 KB) — 24h TTL
 *   - rounds (one event, ~50 KB) — 30d TTL (completed events
 *     don't change; we cache aggressively)
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import {
  getHistoricalEventList,
  getHistoricalRounds,
  type DGHistoricalEvent,
  type DGHistoricalRoundsPayload,
} from "@/lib/golf-api/datagolf";

const redis = Redis.fromEnv();

const EVENT_LIST_TTL_S = 24 * 60 * 60;
const ROUNDS_TTL_S = 30 * 24 * 60 * 60;

function eventListKey(tour: string) {
  return `dg:hist:event-list:${tour}`;
}
function roundsKey(tour: string, eventId: number, year: number) {
  return `dg:hist:rounds:${tour}:${year}:${eventId}`;
}

export async function getCachedHistoricalEventList(
  tour: string = "pga",
): Promise<DGHistoricalEvent[]> {
  const k = eventListKey(tour);
  const cached = await redis.get<DGHistoricalEvent[]>(k);
  if (cached) return cached;
  let fresh: DGHistoricalEvent[] = [];
  try {
    fresh = await getHistoricalEventList(tour);
  } catch (err) {
    console.error("[historical-cache] event-list fetch failed", err);
    return [];
  }
  await redis.set(k, fresh, { ex: EVENT_LIST_TTL_S });
  return fresh;
}

export async function getCachedHistoricalRounds(
  eventId: number,
  year: number,
  tour: string = "pga",
): Promise<DGHistoricalRoundsPayload | null> {
  const k = roundsKey(tour, eventId, year);
  const cached = await redis.get<DGHistoricalRoundsPayload>(k);
  if (cached) return cached;
  try {
    const fresh = await getHistoricalRounds(eventId, year, tour);
    await redis.set(k, fresh, { ex: ROUNDS_TTL_S });
    return fresh;
  } catch (err) {
    console.error(
      `[historical-cache] rounds fetch failed for ${tour}/${year}/${eventId}`,
      err,
    );
    return null;
  }
}

/** Build a lookup map: normalised tournament_name → { event_id, year }. */
function normaliseTournamentName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bpresented by\b.*$/i, "") // strip sponsor tails
    .replace(/[^a-z0-9]/g, "");
}

export async function resolveEventId(
  tournamentName: string,
  year: number,
  tour: string = "pga",
): Promise<{ eventId: number; year: number } | null> {
  const list = await getCachedHistoricalEventList(tour);
  const target = normaliseTournamentName(tournamentName);
  // Prefer the same-year match; fall back to any-year if the input
  // year doesn't have a hit (covers stale recent-form rows).
  const sameYear = list.find(
    (e) =>
      e.calendar_year === year &&
      normaliseTournamentName(e.event_name) === target,
  );
  if (sameYear) return { eventId: sameYear.event_id, year: sameYear.calendar_year };
  const anyYear = list.find(
    (e) => normaliseTournamentName(e.event_name) === target,
  );
  if (anyYear) return { eventId: anyYear.event_id, year: anyYear.calendar_year };
  return null;
}

/**
 * Bulk-resolve a list of (tournament_name, year) pairs to DG event
 * IDs in one event-list fetch. Used by the player page to attach
 * clickable links to each recent-form row.
 */
export async function bulkResolveEventIds(
  pairs: Array<{ tournament: string; year: number }>,
  tour: string = "pga",
): Promise<Record<string, { eventId: number; year: number }>> {
  if (pairs.length === 0) return {};
  const list = await getCachedHistoricalEventList(tour);
  const byNorm = new Map<
    string,
    Array<{ eventId: number; year: number }>
  >();
  for (const e of list) {
    const k = normaliseTournamentName(e.event_name);
    const arr = byNorm.get(k) ?? [];
    arr.push({ eventId: e.event_id, year: e.calendar_year });
    byNorm.set(k, arr);
  }
  const out: Record<string, { eventId: number; year: number }> = {};
  for (const p of pairs) {
    const key = `${p.year}|${p.tournament}`;
    const candidates = byNorm.get(normaliseTournamentName(p.tournament)) ?? [];
    const sameYear = candidates.find((c) => c.year === p.year);
    if (sameYear) {
      out[key] = sameYear;
    } else if (candidates.length > 0) {
      out[key] = candidates[0];
    }
  }
  return out;
}
