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

// Kept at v1 — records may contain the raw un-normalised course_name
// from DataGolf. Normalisation happens on READ (see below) so that
// cached data survives a normaliser change without needing a full
// refetch pass.
const KEY_ROUND = (eventId: number, year: number) =>
  `course-history:round:${eventId}:${year}`;
const KEY_EVENT_LIST = "course-history:event-list:pga";
// v9 = field-strength-adjusted outperformance. Every player's SG:OTT
// + SG:APP at the target course is now adjusted by (event field
// strength − tour average field strength) before comparison to their
// year-baseline. Fixes the systematic negative-bias where strong-field
// courses (WGCs, majors, FedExCup Playoffs) showed 70%+ of players as
// underperformers.
const KEY_AGGREGATE_COURSE = (courseName: string) =>
  `course-history:agg-course:v9:${slugify(courseName)}`;
const KEY_YEAR_BASELINE = (year: number) =>
  `course-history:year-baseline:${year}`;
/** Course index mapping course_name → occurrences (event, year, round
 *  count). Populated incrementally as we fetch event data.
 *  v10 = added second-round aliases for Bay Hill, Torrey Pines,
 *  Country Club of Jackson, Dunes, Riviera. Rebuild once more so
 *  those pairs merge in the index and become queryable under
 *  their canonical names. */
const KEY_COURSE_INDEX = "course-history:course-index:v10";

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
    // Belt-and-suspenders: canonicalise on write so even if callers
    // pass in un-normalised records (a race during a deploy
    // transition, or a caller that skipped read-time normalisation)
    // the index only ever grows canonical keys.
    const cn = normaliseCourseName(r.courseName);
    perCourse.set(cn, (perCourse.get(cn) ?? 0) + 1);
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
        // Normalise cached records' course names on read so that
        // records cached before the normaliser existed still return
        // canonical venue names to callers. Zero cost for records
        // that already carry the canonical name.
        const normalised = cached.map((r) =>
          r.courseName && normaliseCourseName(r.courseName) !== r.courseName
            ? { ...r, courseName: normaliseCourseName(r.courseName) }
            : r,
        );
        // Non-empty or old year — trust the cache. Even on cache hit
        // we opportunistically refresh the course index so a new
        // event-year gets indexed as soon as its data lands.
        if (eventName) {
          await updateCourseIndex(eventId, year, eventName, normalised);
        }
        return normalised;
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
  // DataGolf sometimes appends a course-descriptor in parens for the
  // same physical layout in later years, which splits a venue's
  // history into two separate index entries (e.g. Sawgrass 2019-20
  // vs Sawgrass 2021-25). Explicit aliases fold each back to the
  // canonical short name so the forecast + aggregate include the
  // full history.
  "TPC Sawgrass (THE PLAYERS Stadium Course)": "TPC Sawgrass",
  "TPC Scottsdale (Stadium Course)": "TPC Scottsdale",
  "PGA National Resort (The Champion Course)":
    "PGA National Resort (The Champion)",
  // "PGA National (Champion)" = early-years DataGolf label for the
  // same physical course as "PGA National Resort (The Champion)".
  // My initial split-personality scan missed this because the stem
  // differs (National vs National Resort); confirmed a real merge
  // by hosting event (Honda Classic / Cognizant Classic — same tour
  // event, just renamed by sponsor).
  "PGA National (Champion)": "PGA National Resort (The Champion)",
  "Innisbrook Resort (Copperhead Course)": "Innisbrook Resort (Copperhead)",
  // Keene Trace resort variants — Barbasol used to be labelled just
  // "Keene Trace Golf Club" then switched to "(Champions Course)".
  // ISCO's "(Champion Trace)" is the same physical Champion course
  // (the resort's other course, Chatham, doesn't host PGA events).
  "Keene Trace Golf Club (Champions Course)": "Keene Trace Golf Club",
  "Keene Trace Golf Club (Champion Trace)": "Keene Trace Golf Club",
  // Second-round scan turned up five more where DataGolf switches
  // between two labels for the same physical venue mid-history.
  // Merge each pair onto the more-recent (usually more-detailed)
  // canonical label:
  "Bay Hill Club & Lodge": "Arnold Palmer's Bay Hill Club & Lodge",
  "Torrey Pines (South)": "Torrey Pines Golf Course (South Course)",
  "Country Club of Jackson": "The Country Club of Jackson",
  "Dunes Golf and Beach Club": "The Dunes Golf and Beach Club",
  "Riviera Country Club": "The Riviera Country Club",
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
  // Canonicalise the query so a caller that passes an aliased name
  // (e.g. "TPC Sawgrass (THE PLAYERS Stadium Course)") still lands
  // on the merged canonical row rather than a split entry.
  const cleanCourse = normaliseCourseName(courseName.trim());
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
  // the index. Also merge any split-personality keys that
  // canonicalise to the same cleanCourse — a defensive read-time
  // fold that lets pre-fix cached index blobs still resolve
  // correctly.
  const index = await getCourseIndex();
  const occurrences: CourseOccurrence[] = [];
  for (const [key, occs] of Object.entries(index)) {
    if (normaliseCourseName(key) === cleanCourse) {
      occurrences.push(...occs);
    }
  }
  if (occurrences.length === 0) return null;

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

  // ── Field-strength adjustment ─────────────────────────────────────
  // DG's SG numbers are measured vs the FIELD each week. Strong-field
  // events (WGCs, majors, FedExCup Playoffs) produce lower observed
  // SG for the same "true skill" than weak-field opposite events.
  // Without adjusting for this, aggregating a player's rounds at a
  // strong-field course against a baseline that averages all their
  // events (many weak-field) yields a systematic NEGATIVE
  // outperformance — 143 vs 65 under/over on our first audit.
  //
  // The fix: for each event this player played at the target course,
  // measure the event's field strength = mean of its participants'
  // that-year leave-one-out baselines (excluding the event itself,
  // so field strength isn't inflated by whichever star had a hot
  // week). Then adjust the player's raw SG at that round by
  //   adjusted_sg = raw_sg + (event_fs − tour_avg_fs)
  // which centres every round on a common field-strength reference.

  /** Sum of a player's year-baseline totals with a specific event's
   *  contribution subtracted. Nulls when the player has no rounds
   *  outside that event that year. */
  function eventLoocBaselineForFieldStrength(
    yearBaseline: YearBaseline,
    dgId: number,
    excludedEventId: number,
  ): { sgOtt: number; sgApp: number } | null {
    const row = yearBaseline.get(dgId);
    if (!row) return null;
    const ev = row.byEvent[excludedEventId];
    const otherOtt = row.sumOtt - (ev?.sumOtt ?? 0);
    const otherApp = row.sumApp - (ev?.sumApp ?? 0);
    const otherRounds = row.rounds - (ev?.rounds ?? 0);
    if (otherRounds <= 0) return null;
    return {
      sgOtt: otherOtt / otherRounds,
      sgApp: otherApp / otherRounds,
    };
  }

  /** Cache per (eventId, year) → {ott, app, participants}. Built from
   *  the round set for each occurrence: iterate every player who has
   *  ≥1 round at this event-year, look up their year-leave-one-out
   *  baseline (excluding this event), average. */
  const fieldStrengthByOccurrence = new Map<
    string,
    { sgOtt: number; sgApp: number }
  >();
  const occKey = (eid: number, y: number) => `${eid}:${y}`;

  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    const eventRounds = roundBatches[i];
    const yearBaseline = baselinesByYear.get(occ.year);
    if (!yearBaseline) continue;
    // Unique dgIds in this event-year — one contribution per player,
    // no matter how many rounds they played.
    const participantIds = new Set<number>();
    for (const r of eventRounds) participantIds.add(r.dgId);
    let sumOtt = 0;
    let sumApp = 0;
    let n = 0;
    for (const dgId of participantIds) {
      const b = eventLoocBaselineForFieldStrength(
        yearBaseline,
        dgId,
        occ.eventId,
      );
      if (!b) continue;
      sumOtt += b.sgOtt;
      sumApp += b.sgApp;
      n++;
    }
    if (n === 0) continue;
    fieldStrengthByOccurrence.set(occKey(occ.eventId, occ.year), {
      sgOtt: sumOtt / n,
      sgApp: sumApp / n,
    });
  }

  // Tour-average field strength: mean field-strength across every
  // event-year in ALL the year baselines we loaded. Used as the
  // reference point so an "average field" event round gets zero
  // adjustment.
  let tourFsSumOtt = 0;
  let tourFsSumApp = 0;
  let tourFsN = 0;
  for (const [year, yearBaseline] of baselinesByYear) {
    // Every event that appears in a player's byEvent breakdown.
    const eventIds = new Set<number>();
    for (const row of yearBaseline.values()) {
      for (const eid of Object.keys(row.byEvent)) {
        eventIds.add(Number(eid));
      }
    }
    for (const eid of eventIds) {
      const participantIds = new Set<number>();
      for (const [pid, row] of yearBaseline) {
        if (row.byEvent[eid]) participantIds.add(pid);
      }
      let sumOtt = 0;
      let sumApp = 0;
      let n = 0;
      for (const dgId of participantIds) {
        const b = eventLoocBaselineForFieldStrength(yearBaseline, dgId, eid);
        if (!b) continue;
        sumOtt += b.sgOtt;
        sumApp += b.sgApp;
        n++;
      }
      if (n === 0) continue;
      tourFsSumOtt += sumOtt / n;
      tourFsSumApp += sumApp / n;
      tourFsN++;
    }
    void year;
  }
  const tourAvgFsOtt = tourFsN > 0 ? tourFsSumOtt / tourFsN : 0;
  const tourAvgFsApp = tourFsN > 0 ? tourFsSumApp / tourFsN : 0;

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
  // Map each round to its (eventId, year) so we can look up the
  // event's field-strength adjustment. allRounds carries year but
  // not eventId directly (RoundRecord doesn't); reconstruct by
  // matching against roundBatches parallel index.
  const roundEventLookup = new Map<RoundRecord, number>();
  for (let i = 0; i < occurrences.length; i++) {
    for (const r of roundBatches[i]) {
      if (r.courseName === cleanCourse) {
        roundEventLookup.set(r, occurrences[i].eventId);
      }
    }
  }

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
    // Field-strength adjustment: centre this round's SG on the tour
    // average field. If the event was above-average strength, the
    // player's raw SG understates their performance — add the delta
    // back. Below-average strength → subtract.
    const eventId = roundEventLookup.get(r);
    const fs = eventId != null
      ? fieldStrengthByOccurrence.get(occKey(eventId, r.year))
      : undefined;
    const adjOtt = r.sgOtt + (fs ? fs.sgOtt - tourAvgFsOtt : 0);
    const adjApp = r.sgApp + (fs ? fs.sgApp - tourAvgFsApp : 0);
    b.sumAtOtt += adjOtt;
    b.sumAtApp += adjApp;
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
        // Same belt-and-suspenders as updateCourseIndex — the
        // records SHOULD already carry canonical names, but a
        // second normalise here is idempotent and guarantees a
        // clean rebuild even if a transient serves un-normalised
        // records.
        const cn = normaliseCourseName(r.courseName);
        perCourse.set(cn, (perCourse.get(cn) ?? 0) + 1);
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
  // Read-time fold: if the stored index still holds split-personality
  // keys (any legacy blob predating the alias table), merge them
  // together in the output so the UI sees one row per physical
  // venue.
  const merged = new Map<string, CourseOccurrence[]>();
  for (const [courseName, occs] of Object.entries(index)) {
    const cn = normaliseCourseName(courseName);
    const bucket = merged.get(cn) ?? [];
    bucket.push(...occs);
    merged.set(cn, bucket);
  }
  const out: CuratedCourse[] = [];
  for (const [courseName, occs] of merged) {
    if (occs.length === 0) continue;
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
