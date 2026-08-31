/**
 * Builds the lookup maps the SharpSports parser needs to resolve raw
 * name strings into Pardle IDs.
 *
 * Two maps:
 *
 *   1. **Golfer roster** — name → { dgId, pgaId }. Sources:
 *      - `preds/skill-ratings` on DataGolf gives (dg_id, name) for
 *        every tour-active player (~440). Refreshes weekly.
 *      - PGA orchestrator field-updates give (dg_id, player_num) per
 *        week where player_num IS the orchestrator playerId. We cache
 *        a rolling merge across recent events so pgaId gets filled
 *        for any player who's played the tour recently.
 *
 *   2. **Tournament roster** — normalised-name → { pgaId, dgEventId,
 *      dgYear, startDate }. Sources:
 *      - PGA orchestrator schedule (upcoming + completed) for pgaId +
 *        startDate.
 *      - DG historical-raw-data event-list for dgEventId + dgYear.
 *      Names come out as e.g. "The Masters 2024" from both, we key by
 *      the same `normaliseTournamentName()` the parser uses.
 *
 * Both maps get cached in Redis with a 6h TTL — long enough that we
 * don't hit DG on every webhook, short enough that new events land
 * within a few hours of them appearing on the schedule.
 */

import { Redis } from "@upstash/redis";
import { getSchedule } from "@/lib/golf-api/pgatour";
import {
  getSkillRatings,
  getHistoricalEventList,
} from "@/lib/golf-api/datagolf";
import {
  normName,
  normaliseTournamentName,
  type GolferLookupEntry,
  type TournamentLookupEntry,
} from "./parser";

const redis = (() => {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
})();

const CACHE_TTL = 6 * 60 * 60;
const KEY_GOLFERS = "sharpsports:lookups:golfers:v1";
const KEY_TOURNAMENTS = "sharpsports:lookups:tournaments:v1";
const KEY_PGA_ID_INDEX = "sharpsports:lookups:pgaid-by-dg:v1";

/** Serialisable shape for the Redis blob — Maps don't survive JSON
 *  round-tripping so we store arrays and rebuild on read. */
interface GolferBlob {
  entries: Array<[string, GolferLookupEntry]>;
}
interface TournamentBlob {
  entries: Array<[string, TournamentLookupEntry]>;
}

/** Merge a per-event field-update roster into the persistent
 *  dg_id → pga_playerId cache. Callers who already fetch
 *  field-updates for their own use (feed engine etc.) can pass the
 *  slice through here so the pgaId side of the golfer lookup stays
 *  fresh across events.
 *
 *  Idempotent — same input, same output; no-ops when redis is off. */
export async function mergePgaIdIndex(
  entries: Array<{ dgId: number; pgaId: string }>,
): Promise<void> {
  if (!redis || entries.length === 0) return;
  const existing = (await redis.get<Record<string, string>>(KEY_PGA_ID_INDEX)) ?? {};
  let dirty = false;
  for (const e of entries) {
    const k = String(e.dgId);
    if (existing[k] !== e.pgaId) {
      existing[k] = e.pgaId;
      dirty = true;
    }
  }
  if (dirty) {
    await redis.set(KEY_PGA_ID_INDEX, existing, { ex: 90 * 24 * 60 * 60 });
  }
}

async function loadPgaIdIndex(): Promise<Record<string, string>> {
  if (!redis) return {};
  return (await redis.get<Record<string, string>>(KEY_PGA_ID_INDEX)) ?? {};
}

/** Build the name → { dgId, pgaId } map. Cached in Redis 6h. */
export async function getGolferLookup(): Promise<
  Map<string, GolferLookupEntry>
> {
  if (redis) {
    const cached = await redis.get<GolferBlob>(KEY_GOLFERS).catch(() => null);
    if (cached?.entries) return new Map(cached.entries);
  }
  const [skills, pgaIndex] = await Promise.all([
    getSkillRatings().catch(() => []),
    loadPgaIdIndex(),
  ]);
  const map = new Map<string, GolferLookupEntry>();
  for (const s of skills) {
    // DG returns "Last, First" — flipName is applied inside
    // getSkillRatings already, so `name` is "First Last".
    const dgIdNum = Number(s.dgId);
    if (!Number.isFinite(dgIdNum)) continue;
    const pgaId = pgaIndex[String(dgIdNum)] ?? null;
    const entry: GolferLookupEntry = {
      displayName: s.name,
      dgId: dgIdNum,
      pgaId,
    };
    map.set(normName(s.name), entry);
  }
  if (redis) {
    await redis
      .set(KEY_GOLFERS, { entries: [...map.entries()] } satisfies GolferBlob, {
        ex: CACHE_TTL,
      })
      .catch(() => null);
  }
  return map;
}

/** Build the normalised-name → tournament lookup. Cached 6h. */
export async function getTournamentLookup(): Promise<
  Map<string, TournamentLookupEntry>
> {
  if (redis) {
    const cached = await redis
      .get<TournamentBlob>(KEY_TOURNAMENTS)
      .catch(() => null);
    if (cached?.entries) return new Map(cached.entries);
  }

  const [schedule, dgEvents] = await Promise.all([
    getSchedule().catch(() => ({ upcoming: [], completed: [] })),
    getHistoricalEventList("pga").catch(() => []),
  ]);

  // DG catalog: key by "name YYYY" so we can find "The Masters 2024"
  // by trying variants.
  const dgByYearName = new Map<string, { eventId: number; year: number }>();
  for (const e of dgEvents) {
    if (typeof e.event_id !== "number" || typeof e.calendar_year !== "number") continue;
    const k = normaliseTournamentName(`${e.event_name} ${e.calendar_year}`);
    dgByYearName.set(k, { eventId: e.event_id, year: e.calendar_year });
  }

  const map = new Map<string, TournamentLookupEntry>();
  // Every scheduled event → include year in the key so "The Masters
  // 2024" and "The Masters 2025" don't collide.
  for (const t of [...schedule.upcoming, ...schedule.completed]) {
    const startDate = new Date(t.startDate).toISOString().slice(0, 10);
    const year = new Date(t.startDate).getUTCFullYear();
    const nameYear = `${t.name} ${year}`;
    const key = normaliseTournamentName(nameYear);
    const dgHit = dgByYearName.get(key);
    map.set(key, {
      displayName: nameYear,
      pgaId: t.id,
      dgEventId: dgHit?.eventId ?? null,
      dgYear: dgHit?.year ?? year,
      startDate,
    });
    // Also register the bare name (without year) so book strings
    // like "The Masters 2024 Markets" or event names that duplicate
    // the year still resolve.
    map.set(normaliseTournamentName(t.name), {
      displayName: nameYear,
      pgaId: t.id,
      dgEventId: dgHit?.eventId ?? null,
      dgYear: dgHit?.year ?? year,
      startDate,
    });
  }

  if (redis) {
    await redis
      .set(
        KEY_TOURNAMENTS,
        { entries: [...map.entries()] } satisfies TournamentBlob,
        { ex: CACHE_TTL },
      )
      .catch(() => null);
  }
  return map;
}

/** Convenience — build both lookups in parallel. */
export async function buildParseContext(): Promise<{
  golfers: Map<string, GolferLookupEntry>;
  tournaments: Map<string, TournamentLookupEntry>;
}> {
  const [golfers, tournaments] = await Promise.all([
    getGolferLookup(),
    getTournamentLookup(),
  ]);
  return { golfers, tournaments };
}
