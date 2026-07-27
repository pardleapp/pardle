/**
 * Course-history data layer.
 *
 * Given an event id (which corresponds to a PGA Tour recurring event
 * like the 3M Open, event 525), pull DataGolf's per-round historical
 * SG breakdown across the years we care about, aggregate per player,
 * and combine with the player's current-season SG baseline to derive
 * a course-fit signal (SG:OTT+APP at course vs SG:OTT+APP baseline).
 *
 * The tool's insight: elite players have high SG everywhere. What
 * matters for course-fit is whether they OUTPERFORM their baseline
 * at a specific venue. If Scheffler averages +2.0 SG:OTT+APP overall
 * but +2.8 at TPC Twin Cities, that +0.8 is course fit. If he
 * averages +1.5 there, that's a course drag.
 *
 * We focus on OTT + APP only per Tom's brief — those two SG buckets
 * carry the strongest course-fit signal (the ballstriking skills a
 * course rewards or penalises) and the least noise (putting on
 * short-term greens is mostly regression).
 *
 * Redis cache: per-(eventId, year) DataGolf payload keyed with a 30d
 * TTL. Historical events are immutable once completed, so a long TTL
 * is safe. Aggregated per-course response is cached shorter (24h) so
 * a mid-week reflow of the current tournament picks up new rounds.
 */

import { Redis } from "@upstash/redis";
import {
  getHistoricalEventList,
  getHistoricalRounds,
  type DGHistoricalEvent,
  type DGHistoricalRound,
} from "@/lib/golf-api/datagolf";

const redis = (() => {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
})();

const CACHE_TTL_ROUND = 30 * 24 * 60 * 60; // 30 days for historical event data
const CACHE_TTL_EVENT_LIST = 24 * 60 * 60; // 24h for the event list
const CACHE_TTL_AGGREGATE = 6 * 60 * 60; // 6h for the per-course aggregation
const CACHE_TTL_BASELINE_DONE = 30 * 24 * 60 * 60; // 30d for completed-year baselines
const CACHE_TTL_BASELINE_LIVE = 6 * 60 * 60; // 6h for the current in-progress year

const CURRENT_YEAR = 2026;

// v2 = round records now carry the normalised course_name
// (aliases + suffix-stripping) so PGA Championship / U.S. Open years
// at existing venues merge into the same course-index entry.
const KEY_ROUND = (eventId: number, year: number) =>
  `course-history:round:v2:${eventId}:${year}`;
const KEY_EVENT_LIST = "course-history:event-list:pga";
// v3 = course-based aggregation (was event-based v2). Some events
// change courses year to year (The Open, various signature events),
// so we now group by course_name instead of event_id.
const KEY_AGGREGATE_COURSE = (courseName: string) =>
  `course-history:agg-course:v3:${slugify(courseName)}`;
const KEY_YEAR_BASELINE = (year: number) =>
  `course-history:year-baseline:${year}`;
/** Course index mapping course_name → occurrences (event, year, round
 *  count). Populated incrementally as we fetch event data.
 *  v2 = bumped from v1 which was cached partially-populated due to
 *  the old 60s warmup timeout being hit before every event landed. */
const KEY_COURSE_INDEX = "course-history:course-index:v5";

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Concurrency limit when fanning out getHistoricalRounds calls for
 *  a cold-cache year baseline. Kept modest to be nice to DataGolf. */
const FETCH_CONCURRENCY = 20;

async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function pull() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    () => pull(),
  );
  await Promise.all(runners);
  return out;
}

/** Historical years we look back over. 2019 is where DataGolf's
 *  full SG-by-category coverage is reliable across PGA events. */
export const HISTORICAL_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

interface RoundRecord {
  dgId: number;
  playerName: string;
  courseName: string;
  year: number;
  round: 1 | 2 | 3 | 4;
  sgOtt: number;
  sgApp: number;
}

/** Per-player aggregated stats at a single course. */
export interface PlayerCourseStats {
  dgId: number;
  name: string;
  roundsPlayed: number;
  yearsPlayed: number;
  courseName: string;
  /** Average SG:OTT across the player's rounds at this course. */
  atCourseSgOtt: number;
  /** Average SG:APP across the player's rounds at this course. */
  atCourseSgApp: number;
  /** Sum: how the player has actually ballstruck at this course. */
  atCourseCombined: number;
  /** Player's current-season SG:OTT baseline. */
  baselineSgOtt: number;
  /** Player's current-season SG:APP baseline. */
  baselineSgApp: number;
  /** Sum: how the player usually ballstrikes. */
  baselineCombined: number;
  /** at-course − baseline for each bucket. Positive = course lifts,
   *  negative = course drags. */
  outperformanceSgOtt: number;
  outperformanceSgApp: number;
  outperformanceCombined: number;
}

/** Response shape from the course-history endpoint. */
export interface CourseHistoryResponse {
  /** Legacy: -1 when the aggregation was course-based (the common
   *  path). Retained for backwards-compat with any old-shape callers. */
  eventId: number;
  /** Display label — the primary hosting event name, or "X + N more"
   *  when the course has been used by multiple events. */
  eventName: string;
  courseName: string;
  yearsCovered: number[];
  players: PlayerCourseStats[];
  cachedAt: string;
  /** All PGA events that have used this course in HISTORICAL_YEARS.
   *  Rendered as chips beneath the course-name header on the client. */
  hostingEvents?: string[];
}

// ── Cached fetchers ────────────────────────────────────────────────

/** Fetch (and cache) DataGolf's historical event list. Used to build
 *  the searchable dropdown of PGA events on the client. */
export async function getCachedEventList(): Promise<DGHistoricalEvent[]> {
  if (redis) {
    const cached = await redis
      .get<DGHistoricalEvent[]>(KEY_EVENT_LIST)
      .catch(() => null);
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;
  }
  const list = await getHistoricalEventList("pga");
  if (redis) {
    await redis
      .set(KEY_EVENT_LIST, list, { ex: CACHE_TTL_EVENT_LIST })
      .catch(() => null);
  }
  return list;
}

/** Per-player accumulator for a single year's baseline: total
 *  SG:OTT + SG:APP across all rounds the player played that year,
 *  broken out by event so we can leave-one-out at the event level
 *  when the target event contaminates the baseline. */
interface YearBaselineRow {
  /** total sum of SG:OTT across all rounds played this year */
  sumOtt: number;
  /** total sum of SG:APP across all rounds played this year */
  sumApp: number;
  /** total rounds played this year (all events) */
  rounds: number;
  /** contribution of a single event to the total, keyed by eventId,
   *  so callers doing leave-one-out can subtract it. */
  byEvent: Record<number, { sumOtt: number; sumApp: number; rounds: number }>;
}

type YearBaseline = Map<number, YearBaselineRow>;

/**
 * Compute (and cache) every PGA player's SG:OTT + SG:APP for one
 * calendar year — used as the "expected" baseline against which
 * we measure at-course outperformance.
 *
 * This is where Tom's per-tournament-recalibration ask lives:
 * a player's baseline changes year to year (rookies improve,
 * veterans decline, swings get rebuilt), so we compute a fresh
 * per-year baseline instead of using a single career average.
 *
 * The row we cache exposes per-event contributions too so the
 * caller can leave-one-out at the target event — that keeps the
 * baseline from being contaminated by the very rounds we're
 * comparing against.
 *
 * First cold hit for a year is expensive (~40 events × ~400ms
 * each ≈ 8-15s with our concurrency cap). Redis caches for 30d
 * once the year is completed, 6h during the in-progress year.
 */
async function getYearlyPlayerBaselines(
  year: number,
): Promise<YearBaseline> {
  // Redis first
  if (redis) {
    const cached = await redis
      .get<Array<[number, number, number, number, Array<[number, number, number, number]>]>>(
        KEY_YEAR_BASELINE(year),
      )
      .catch(() => null);
    if (cached && Array.isArray(cached)) {
      const out: YearBaseline = new Map();
      for (const [dgId, sumOtt, sumApp, rounds, packedEvents] of cached) {
        const byEvent: YearBaselineRow["byEvent"] = {};
        for (const [eventId, eOtt, eApp, eRounds] of packedEvents) {
          byEvent[eventId] = { sumOtt: eOtt, sumApp: eApp, rounds: eRounds };
        }
        out.set(dgId, { sumOtt, sumApp, rounds, byEvent });
      }
      return out;
    }
  }

  // Cold path — fetch all sg-categorised events for that year and
  // aggregate per player. Uses the same Redis-cached per-event data
  // that getCourseHistory uses, so any prior lookups are reused.
  const eventList = await getCachedEventList();
  const yearEvents = eventList.filter(
    (e) =>
      e.calendar_year === year &&
      e.sg_categories === "yes" &&
      typeof e.event_id === "number",
  );
  const perEventRounds = await pMapLimit(
    yearEvents,
    FETCH_CONCURRENCY,
    (ev) => getCachedEventYearRounds(ev.event_id, year, ev.event_name),
  );

  const out: YearBaseline = new Map();
  for (let i = 0; i < yearEvents.length; i++) {
    const eventId = yearEvents[i].event_id;
    for (const r of perEventRounds[i]) {
      const row =
        out.get(r.dgId) ??
        ({
          sumOtt: 0,
          sumApp: 0,
          rounds: 0,
          byEvent: {},
        } as YearBaselineRow);
      row.sumOtt += r.sgOtt;
      row.sumApp += r.sgApp;
      row.rounds += 1;
      const ev = row.byEvent[eventId] ??
        ({ sumOtt: 0, sumApp: 0, rounds: 0 });
      ev.sumOtt += r.sgOtt;
      ev.sumApp += r.sgApp;
      ev.rounds += 1;
      row.byEvent[eventId] = ev;
      out.set(r.dgId, row);
    }
  }

  // Persist compact-packed to Redis. Layout:
  //   [dgId, sumOtt, sumApp, rounds, [[eventId, eOtt, eApp, eRounds], …]]
  if (redis) {
    const packed: Array<[number, number, number, number, Array<[number, number, number, number]>]> = [];
    for (const [dgId, row] of out) {
      const evs: Array<[number, number, number, number]> = [];
      for (const [eIdStr, ev] of Object.entries(row.byEvent)) {
        evs.push([Number(eIdStr), ev.sumOtt, ev.sumApp, ev.rounds]);
      }
      packed.push([dgId, row.sumOtt, row.sumApp, row.rounds, evs]);
    }
    const ttl =
      year < CURRENT_YEAR ? CACHE_TTL_BASELINE_DONE : CACHE_TTL_BASELINE_LIVE;
    await redis
      .set(KEY_YEAR_BASELINE(year), packed, { ex: ttl })
      .catch(() => null);
  }
  return out;
}

/** Course occurrence — one (event, year) that hosted this course. */
export interface CourseOccurrence {
  eventId: number;
  eventName: string;
  year: number;
  rounds: number;
}

/** The full course index — courseName → array of occurrences. */
type CourseIndex = Record<string, CourseOccurrence[]>;

async function getCourseIndex(): Promise<CourseIndex> {
  if (!redis) return {};
  const cached = await redis
    .get<CourseIndex>(KEY_COURSE_INDEX)
    .catch(() => null);
  return cached ?? {};
}

/** Update the course index with a fresh event-year batch of records.
 *  Called as a side effect of `getCachedEventYearRounds`. Idempotent
 *  — replaces existing entries for the same (eventId, year). */
async function updateCourseIndex(
  eventId: number,
  year: number,
  eventName: string,
  records: RoundRecord[],
): Promise<void> {
  if (!redis || records.length === 0) return;
  const perCourse = new Map<string, number>();
  for (const r of records) {
    if (!r.courseName) continue;
    perCourse.set(r.courseName, (perCourse.get(r.courseName) ?? 0) + 1);
  }
  if (perCourse.size === 0) return;
  const index = (await getCourseIndex()) ?? {};
  for (const [courseName, rounds] of perCourse) {
    const existing = index[courseName] ?? [];
    // Remove any prior entry for this (eventId, year) so a repeated
    // fetch just replaces the count instead of duplicating.
    const filtered = existing.filter(
      (e) => !(e.eventId === eventId && e.year === year),
    );
    filtered.push({ eventId, eventName, year, rounds });
    index[courseName] = filtered;
  }
  // TTL: 60 days — the index survives longer than any single
  // event-year cache; it's fine to hold stale entries here.
  await redis
    .set(KEY_COURSE_INDEX, index, { ex: 60 * 24 * 60 * 60 })
    .catch(() => null);
}

/** Fetch (and cache) one event-year historical round dump. Returns
 *  a flat list of round records ready for aggregation. */
async function getCachedEventYearRounds(
  eventId: number,
  year: number,
  eventName?: string,
): Promise<RoundRecord[]> {
  if (redis) {
    const cached = await redis
      .get<RoundRecord[]>(KEY_ROUND(eventId, year))
      .catch(() => null);
    if (cached && Array.isArray(cached)) {
      // Stale-empty-cache guard: if the cached data is empty AND the
      // year is recent, don't trust it — DataGolf may not have posted
      // the event's SG data yet when we last fetched. The window is
      // wide (3 years back) to catch late-season events that DG
      // publishes months after they wrap up.
      if (cached.length === 0 && year >= CURRENT_YEAR - 3) {
        // Fall through to refetch — don't return the empty cache.
      } else {
        // Non-empty or old year — trust the cache. Even on cache hit
        // we opportunistically refresh the course index so a new
        // event-year gets indexed as soon as its data lands.
        if (eventName) {
          await updateCourseIndex(eventId, year, eventName, cached);
        }
        return cached;
      }
    }
  }
  try {
    const payload = await getHistoricalRounds(eventId, year, "pga");
    const records: RoundRecord[] = [];
    const effectiveEventName = eventName ?? payload.event_name ?? "";
    for (const s of payload.scores ?? []) {
      if (!Number.isFinite(s.dg_id)) continue;
      const playerName = flipName(s.player_name);
      for (const rNum of [1, 2, 3, 4] as const) {
        const rd = s[`round_${rNum}` as const] as DGHistoricalRound | undefined;
        if (!rd) continue;
        const sgOtt = typeof rd.sg_ott === "number" ? rd.sg_ott : null;
        const sgApp = typeof rd.sg_app === "number" ? rd.sg_app : null;
        if (sgOtt == null || sgApp == null) continue;
        records.push({
          dgId: s.dg_id,
          playerName,
          courseName: normaliseCourseName(String(rd.course_name ?? "")),
          year,
          round: rNum,
          sgOtt,
          sgApp,
        });
      }
    }
    if (redis) {
      await redis
        .set(KEY_ROUND(eventId, year), records, { ex: CACHE_TTL_ROUND })
        .catch(() => null);
    }
    await updateCourseIndex(eventId, year, effectiveEventName, records);
    return records;
  } catch {
    // Event/year missing (event didn't exist yet, tour rotation, etc.) —
    // cache an empty result briefly so we don't hammer DG.
    if (redis) {
      await redis
        .set(KEY_ROUND(eventId, year), [], { ex: CACHE_TTL_ROUND })
        .catch(() => null);
    }
    return [];
  }
}

/** Turn DataGolf's "Last, First" convention into "First Last". */
function flipName(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s.includes(",")) return s;
  const [last, first] = s.split(",").map((x) => x.trim());
  return `${first} ${last}`.trim();
}

/** DataGolf occasionally embeds an event name into course_name when
 *  the same venue gets a special-event tag (seen at PGA Championship
 *  2025 = "Quail Hollow-PGA Championship" instead of the usual
 *  "Quail Hollow Club"). That splits the aggregate — the same
 *  physical course ends up as two entries.
 *
 *  Normaliser rules:
 *   - Strip a `-<MAJOR>` suffix so major-hosting years merge with
 *     regular-tour years at the same venue.
 *   - Explicit alias map for cases the regex can't handle. */
const COURSE_NAME_ALIASES: Record<string, string> = {
  "Quail Hollow-PGA Championship": "Quail Hollow Club",
};

function normaliseCourseName(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  const alias = COURSE_NAME_ALIASES[s];
  if (alias) return alias;
  const m = s.match(
    /^(.+?)-(PGA Championship|U\.S\. Open|The Open Championship|Ryder Cup|Presidents Cup|Masters Tournament)$/,
  );
  if (m) return m[1].trim();
  return s;
}

// ── Main aggregation ───────────────────────────────────────────────

/** Aggregate all rounds played at a SPECIFIC course (across any event
 *  that hosted it), into per-player course stats. This is the primary
 *  entry point — grouping by course name means a rotating event like
 *  The Open Championship gets split into separate cards for Royal
 *  Troon, St Andrews, Royal Portrush etc. rather than mashing every
 *  venue into one meaningless aggregate.
 *
 *  Uses per-year leave-one-out baselines, but the "left out" set is
 *  every (eventId, year) tuple that used the target course in that
 *  year — so if The Open was at St Andrews in 2015 and 2022, the St
 *  Andrews query subtracts BOTH those (eventId, year) contributions
 *  from each player's per-year baseline. */
export async function getCourseHistoryByCourse(
  courseName: string,
): Promise<CourseHistoryResponse | null> {
  const cleanCourse = courseName.trim();
  if (!cleanCourse) return null;

  if (redis) {
    const cached = await redis
      .get<CourseHistoryResponse>(KEY_AGGREGATE_COURSE(cleanCourse))
      .catch(() => null);
    if (cached && cached.players) return cached;
  }

  // Find which (event, year) tuples hosted this course. If the
  // course-index is empty (nothing cached yet) we can't discover
  // occurrences without fetching every PGA event — the caller
  // should have hit /api/course-history/courses first, which warms
  // the index.
  const index = await getCourseIndex();
  const occurrences = index[cleanCourse];
  if (!occurrences || occurrences.length === 0) return null;

  // Fetch each occurrence's cached rounds and filter to this course.
  const roundBatches = await Promise.all(
    occurrences.map((o) =>
      getCachedEventYearRounds(o.eventId, o.year, o.eventName),
    ),
  );
  const allRounds: RoundRecord[] = [];
  for (const batch of roundBatches) {
    for (const r of batch) {
      if (r.courseName === cleanCourse) allRounds.push(r);
    }
  }
  if (allRounds.length === 0) return null;

  // Which years does the target event actually have data for? Only
  // fetch per-year baselines for those years — the others aren't
  // needed and we don't want to spend the fetch budget on empty
  // years.
  const yearsWithData = Array.from(
    new Set(allRounds.map((r) => r.year)),
  ).sort();

  // Kick off per-year baseline fetches in parallel. Each one may
  // itself fan out ~40 event fetches on cold cache, so the whole
  // block is the expensive part.
  const yearBaselineArr = await Promise.all(
    yearsWithData.map((y) => getYearlyPlayerBaselines(y)),
  );
  const baselinesByYear = new Map<number, YearBaseline>();
  for (let i = 0; i < yearsWithData.length; i++) {
    baselinesByYear.set(yearsWithData[i], yearBaselineArr[i]);
  }

  // For each year, gather the set of eventIds that hosted this
  // course. Baseline for a player-year excludes ALL of those events
  // that year (not just one), so a course that hosted multiple
  // events in a single year is still cleanly separated.
  const excludedByYear = new Map<number, Set<number>>();
  for (const o of occurrences) {
    const set = excludedByYear.get(o.year) ?? new Set<number>();
    set.add(o.eventId);
    excludedByYear.set(o.year, set);
  }

  /** Look up a player's leave-one-out baseline SG:OTT + SG:APP for a
   *  specific year, excluding all events that used the target course
   *  that year. So a Riviera query subtracts BOTH the Genesis
   *  Invitational rounds and any other Riviera-hosted event that
   *  year, leaving only OTHER-COURSE rounds as the baseline. Returns
   *  null if the player has no rounds outside those events that year
   *  — the caller then skips this round for baseline purposes. */
  function leaveOneOutBaseline(
    dgId: number,
    year: number,
  ): { sgOtt: number; sgApp: number } | null {
    const yearBaseline = baselinesByYear.get(year);
    if (!yearBaseline) return null;
    const row = yearBaseline.get(dgId);
    if (!row) return null;
    const excludedEvents = excludedByYear.get(year);
    let excludedOtt = 0;
    let excludedApp = 0;
    let excludedRounds = 0;
    if (excludedEvents) {
      for (const eid of excludedEvents) {
        const evContrib = row.byEvent[eid];
        if (evContrib) {
          excludedOtt += evContrib.sumOtt;
          excludedApp += evContrib.sumApp;
          excludedRounds += evContrib.rounds;
        }
      }
    }
    const otherOtt = row.sumOtt - excludedOtt;
    const otherApp = row.sumApp - excludedApp;
    const otherRounds = row.rounds - excludedRounds;
    if (otherRounds <= 0) return null;
    return {
      sgOtt: otherOtt / otherRounds,
      sgApp: otherApp / otherRounds,
    };
  }

  // Group target-event rounds by player and aggregate.
  interface Bucket {
    dgId: number;
    name: string;
    sumAtOtt: number;
    sumAtApp: number;
    /** Sum of the year-appropriate baseline SG:OTT applied to each
     *  round — divided by rounds later to yield the player's average
     *  baseline across the years they played at this event. */
    sumBaselineOtt: number;
    sumBaselineApp: number;
    rounds: number;
    baselineRounds: number; // rounds where we had a per-year baseline
    years: Set<number>;
    courses: Map<string, number>;
  }
  const byPlayer = new Map<number, Bucket>();
  for (const r of allRounds) {
    let b = byPlayer.get(r.dgId);
    if (!b) {
      b = {
        dgId: r.dgId,
        name: r.playerName,
        sumAtOtt: 0,
        sumAtApp: 0,
        sumBaselineOtt: 0,
        sumBaselineApp: 0,
        rounds: 0,
        baselineRounds: 0,
        years: new Set(),
        courses: new Map(),
      };
      byPlayer.set(r.dgId, b);
    }
    b.sumAtOtt += r.sgOtt;
    b.sumAtApp += r.sgApp;
    b.rounds += 1;
    b.years.add(r.year);
    if (r.courseName) {
      b.courses.set(r.courseName, (b.courses.get(r.courseName) ?? 0) + 1);
    }
    // Baseline for this specific round: the player's year-Y
    // leave-one-out baseline. Applied per round so that a player who
    // came to the event across multiple years gets an average
    // baseline weighted correctly across their year-Y baselines.
    const baseline = leaveOneOutBaseline(r.dgId, r.year);
    if (baseline) {
      b.sumBaselineOtt += baseline.sgOtt;
      b.sumBaselineApp += baseline.sgApp;
      b.baselineRounds += 1;
    }
  }

  // Pick the modal course name across all rounds (handles the rare
  // case where an event moved venues — we take whichever course has
  // the most rounds behind it in this aggregate).
  const courseTallies = new Map<string, number>();
  for (const b of byPlayer.values()) {
    for (const [c, n] of b.courses) {
      courseTallies.set(c, (courseTallies.get(c) ?? 0) + n);
    }
  }
  let modalCourse = "";
  let modalCount = 0;
  for (const [c, n] of courseTallies) {
    if (n > modalCount) {
      modalCourse = c;
      modalCount = n;
    }
  }

  const players: PlayerCourseStats[] = [];
  for (const b of byPlayer.values()) {
    const atOtt = b.sumAtOtt / b.rounds;
    const atApp = b.sumAtApp / b.rounds;
    // Baseline: mean of the player's per-year leave-one-out
    // baselines, weighted by their rounds at the target event that
    // year. If they have zero baseline coverage (all their target-
    // event rounds happened in years they didn't play anywhere else),
    // fall back to 0 — a very rare case for tour regulars.
    const baseOtt =
      b.baselineRounds > 0 ? b.sumBaselineOtt / b.baselineRounds : 0;
    const baseApp =
      b.baselineRounds > 0 ? b.sumBaselineApp / b.baselineRounds : 0;
    // Pick the modal course FROM THIS PLAYER's rounds (falls back to
    // the event-wide modal if the player only has one round).
    let courseName = modalCourse;
    let bestN = 0;
    for (const [c, n] of b.courses) {
      if (n > bestN) {
        courseName = c;
        bestN = n;
      }
    }
    players.push({
      dgId: b.dgId,
      name: b.name,
      roundsPlayed: b.rounds,
      yearsPlayed: b.years.size,
      courseName,
      atCourseSgOtt: atOtt,
      atCourseSgApp: atApp,
      atCourseCombined: atOtt + atApp,
      baselineSgOtt: baseOtt,
      baselineSgApp: baseApp,
      baselineCombined: baseOtt + baseApp,
      outperformanceSgOtt: atOtt - baseOtt,
      outperformanceSgApp: atApp - baseApp,
      outperformanceCombined: atOtt + atApp - (baseOtt + baseApp),
    });
  }

  // Default sort: outperformance descending (best course fit at top).
  players.sort(
    (a, b) => b.outperformanceCombined - a.outperformanceCombined,
  );

  const yearsCovered = Array.from(
    new Set(allRounds.map((r) => r.year)),
  ).sort();

  // Which events have hosted this course? Deduped list for the UI.
  const eventNames = Array.from(
    new Set(occurrences.map((o) => o.eventName).filter(Boolean)),
  ).sort();
  const eventNameLabel =
    eventNames.length === 0
      ? cleanCourse
      : eventNames.length === 1
        ? eventNames[0]
        : `${eventNames[0]} + ${eventNames.length - 1} more`;

  const response: CourseHistoryResponse = {
    eventId: -1,
    eventName: eventNameLabel,
    courseName: cleanCourse,
    yearsCovered,
    players,
    cachedAt: new Date(0).toISOString(),
    hostingEvents: eventNames,
  };

  if (redis) {
    await redis
      .set(KEY_AGGREGATE_COURSE(cleanCourse), response, {
        ex: CACHE_TTL_AGGREGATE,
      })
      .catch(() => null);
  }
  return response;
}

/** One course entry in the searchable list, with metadata for the UI. */
export interface CuratedCourse {
  courseName: string;
  /** Total rounds across all (event, year) occurrences at this course
   *  — a rough "sample size" hint that helps the UI hide venues with
   *  too little data to be useful. */
  totalRounds: number;
  /** Number of distinct years this course has appeared in the
   *  historical window. */
  yearsPresent: number;
  /** Distinct hosting events, alphabetically sorted. */
  hostingEvents: string[];
  /** Most-recent year this course was played. */
  mostRecentYear: number;
}

/** Return the curated course list built from the course index. If the
 *  index is empty (nothing has been cached yet), warms it by fetching
 *  per-year baselines for every HISTORICAL_YEAR — that's the same
 *  fetch fanout that a first `getCourseHistoryByCourse` would trigger,
 *  so callers still hitting the tool cold see a single slow first
 *  request rather than a "no data" screen. */
export async function getCuratedCourses(): Promise<CuratedCourse[]> {
  let index = await getCourseIndex();
  if (Object.keys(index).length === 0) {
    // Cold path — walk the event list, fetch every (event, year)
    // batch's records, and assemble the entire course index in
    // memory, then write it to Redis in ONE shot at the end. The
    // per-call side-effect update in getCachedEventYearRounds races
    // between concurrent workers on the same Redis JSON blob, so a
    // batch build sidesteps that entirely.
    const eventList = await getCachedEventList();
    const pairs: Array<{
      eventId: number;
      eventName: string;
      year: number;
    }> = [];
    for (const e of eventList) {
      if (e.sg_categories !== "yes") continue;
      if (typeof e.event_id !== "number") continue;
      if (
        e.calendar_year < HISTORICAL_YEARS[0] ||
        e.calendar_year > HISTORICAL_YEARS[HISTORICAL_YEARS.length - 1]
      ) {
        continue;
      }
      pairs.push({
        eventId: e.event_id,
        eventName: e.event_name,
        year: e.calendar_year,
      });
    }
    const batches = await pMapLimit(pairs, FETCH_CONCURRENCY, (p) =>
      getCachedEventYearRounds(p.eventId, p.year, p.eventName).then(
        (records) => ({ ...p, records }),
      ),
    );
    // Assemble the index locally (no redis reads/writes in the loop).
    const fresh: CourseIndex = {};
    for (const b of batches) {
      const perCourse = new Map<string, number>();
      for (const r of b.records) {
        if (!r.courseName) continue;
        perCourse.set(
          r.courseName,
          (perCourse.get(r.courseName) ?? 0) + 1,
        );
      }
      for (const [courseName, rounds] of perCourse) {
        const existing = fresh[courseName] ?? [];
        // Deduplicate by (eventId, year) in case the event-list has
        // duplicate entries.
        const filtered = existing.filter(
          (o) => !(o.eventId === b.eventId && o.year === b.year),
        );
        filtered.push({
          eventId: b.eventId,
          eventName: b.eventName,
          year: b.year,
          rounds,
        });
        fresh[courseName] = filtered;
      }
    }
    if (redis) {
      await redis
        .set(KEY_COURSE_INDEX, fresh, { ex: 60 * 24 * 60 * 60 })
        .catch(() => null);
    }
    index = fresh;
  }
  const out: CuratedCourse[] = [];
  for (const [courseName, occs] of Object.entries(index)) {
    const totalRounds = occs.reduce((a, b) => a + b.rounds, 0);
    const yearsPresent = new Set(occs.map((o) => o.year)).size;
    const hostingEvents = Array.from(
      new Set(occs.map((o) => o.eventName).filter(Boolean)),
    ).sort();
    const mostRecentYear = Math.max(...occs.map((o) => o.year));
    out.push({
      courseName,
      totalRounds,
      yearsPresent,
      hostingEvents,
      mostRecentYear,
    });
  }
  return out.sort((a, b) => a.courseName.localeCompare(b.courseName));
}

/** Curated list of PGA Tour recurring events with SG data, sorted by
 *  the most recent year each event was played. Deduplicated by event
 *  id and filtered to events where DG carries SG breakdown. */
export interface CuratedEvent {
  eventId: number;
  eventName: string;
  mostRecentYear: number;
}

export async function getCuratedEvents(): Promise<CuratedEvent[]> {
  const list = await getCachedEventList();
  // Filter to events with SG-by-category and only years we're
  // aggregating over (2019-2025).
  const filtered = list.filter(
    (e) =>
      e.sg_categories === "yes" &&
      typeof e.event_id === "number" &&
      typeof e.calendar_year === "number" &&
      e.calendar_year >= HISTORICAL_YEARS[0] &&
      e.calendar_year <= HISTORICAL_YEARS[HISTORICAL_YEARS.length - 1],
  );
  // De-dupe by event_id, keeping the most recent year we see it in.
  const byId = new Map<number, CuratedEvent>();
  for (const e of filtered) {
    const existing = byId.get(e.event_id);
    if (!existing || existing.mostRecentYear < e.calendar_year) {
      byId.set(e.event_id, {
        eventId: e.event_id,
        eventName: e.event_name,
        mostRecentYear: e.calendar_year,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.eventName.localeCompare(b.eventName),
  );
}
