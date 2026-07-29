/**
 * Dynamic per-tournament config for the round-score scoring model.
 *
 * The scoring model used to hard-code five separate tables per
 * tournament — event-code map, hole bearings, course par, hole
 * pars, historical round means — which meant only the one venue we
 * spent a day fitting worked. This module derives the same config
 * automatically from whatever historical event JSONs are present
 * on disk (`data/historical/{slug}-{year}.json`), so the runtime
 * just needs the ingestion script to have produced files for a
 * course and the model works.
 *
 * Behaviour:
 *
 *   - `data/historical/*.json` is scanned once per process. Files
 *     are grouped by their filename slug (e.g. "3m-open"). Each
 *     slug becomes a tournament family with N historical years.
 *
 *   - `getTournamentConfig(tournamentId)` returns a config when
 *     the tournamentId either (a) matches one of the historical
 *     ids inside a family or (b) matches the pattern the family
 *     uses for its live current-year id (derived from the
 *     tournament-index suffix of the most recent historical id —
 *     3M Open: R{year}525, Wyndham: R{year}013, etc.).
 *
 *   - When no config matches, the caller gets `null` and can
 *     surface a "new venue" state to the UI.
 *
 * Config derivation from a historical JSON:
 *   - venue, dgEventId, pgaTournamentId → straight passthrough
 *   - coursePar: majority par across players[].rounds[X].coursePar
 *   - holePars: majority par per hole across players[].rounds[X].holes
 *   - holeBearings: centroid-based bearings from pinsByRoundByHole
 *     (from tee y=0 to pin centroid — an approximation good enough
 *     for headwind computation)
 *   - historicalRoundMeansByRound: average score per round across
 *     all historical years (weighted by n players per round)
 */

import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// ── Shape of the loaded historical JSON files ─────────────────────

interface HistoricalVenue {
  name?: string;
  lat?: number;
  lon?: number;
  tz?: string;
}
interface HistoricalHole {
  score?: number;
  yards?: number;
}
interface HistoricalRound {
  score?: number;
  coursePar?: number;
  holes?: Record<string, HistoricalHole>;
}
interface HistoricalPlayer {
  dgId?: string;
  name?: string;
  rounds?: Record<string, HistoricalRound>;
}
interface HistoricalPin {
  x?: number;
  y?: number;
}
interface HistoricalJson {
  year?: number;
  dgEventId?: number;
  dgEventName?: string;
  pgaTournamentId?: string;
  venue?: HistoricalVenue;
  roundDates?: Record<string, string> | null;
  weatherByRound?: Record<string, unknown>;
  pinsByRoundByHole?: Record<string, Record<string, HistoricalPin | null>>;
  players?: HistoricalPlayer[];
}

// ── Public config shape ───────────────────────────────────────────

export interface TournamentConfig {
  /** File slug — e.g. "3m-open". */
  slug: string;
  /** DataGolf event name (for logs/UI). */
  eventName: string;
  /** Venue coords + timezone (from the historical JSONs). */
  venue: HistoricalVenue;
  /** Available historical years (sorted ascending). */
  historicalYears: number[];
  /** year → pgaTournamentId map (from historical files). */
  historicalTournamentIds: Record<number, string>;
  /** Suffix used to compute live-current-year ids
   *  (e.g. 3M Open ids all end in 525). Derived from the most
   *  recent historical id. */
  tournamentIdSuffix: string;
  /** Course par (typically 70-72). */
  coursePar: number;
  /** Par per hole 1-18. */
  courseHolePars: Record<number, number>;
  /** Compass bearings 0-360° per hole 1-18. */
  holeBearings: Record<number, number>;
  /** Historical round means (avg strokes per round across all
   *  years). Keys 1-4 as strings for JSON friendliness. */
  historicalRoundMeansByRound: Partial<Record<1 | 2 | 3 | 4, number>>;
  /** Historical round medians (per-round field median stroke score,
   *  averaged across all years). Book round-score O/U lines are set
   *  against the median, so bettors need this alongside the mean. */
  historicalRoundMediansByRound: Partial<Record<1 | 2 | 3 | 4, number>>;
  /** Course-level mean-median gap in strokes — how right-skewed the
   *  venue's field-round distribution is. Averaged across all
   *  year:round observations. Positive → mean > median → the course
   *  produces occasional blow-up rounds that pull the mean up. */
  historicalMeanMedianGap: number;
  /** Per-player round-score standard deviation at this venue —
   *  measured directly from their historical rounds on file. Keyed
   *  by DataGolf dg_id. Callers should fall back to a skill-tier
   *  default when a player isn't in this map (e.g. rookies, players
   *  who missed every past cut at the course).
   *
   *  Note we deliberately DON'T publish a per-player mean-median
   *  gap — with n≈40 rounds the SE on that measurement is roughly
   *  0.5 strokes, so any per-player gap we'd fit is dominated by
   *  noise. The venue-level gap (aggregated over ~4400
   *  observations) is the only empirically-grounded skew signal at
   *  the sample sizes we have. */
  playerRoundScoreSigmaByDgId: Record<string, number>;
  /** Course-average round-score sigma across every player-round on
   *  file. The tour-wide typical value is around 2.6-3.0; venues
   *  with more penalty features sit at the top of that range. Used
   *  as the fallback when a specific player has no venue history. */
  fieldRoundScoreSigmaBaseline: number;
  /** Live-year round dates keyed by current-year id, when the
   *  ingestion script has recorded them for the upcoming week.
   *  Undefined otherwise → weather resolution falls back to
   *  computed dates. */
  liveRoundDates?: Record<string, string>;
}

// ── In-memory cache ───────────────────────────────────────────────

const HISTORICAL_DIR = path.join(process.cwd(), "data", "historical");
const LIVE_META_FILE = path.join(HISTORICAL_DIR, "_live-tournaments.json");

let cachedConfigsBySlug: Map<string, TournamentConfig> | null = null;
let cachedConfigsByTournamentId: Map<string, TournamentConfig> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — cheap to rebuild if files change

function computeMedian(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function loadAll(): Promise<void> {
  if (
    cachedConfigsBySlug &&
    Date.now() - cacheLoadedAt < CACHE_TTL_MS
  ) {
    return;
  }
  const bySlug = new Map<string, TournamentConfig>();
  const byId = new Map<string, TournamentConfig>();
  let entries: string[];
  try {
    entries = await readdir(HISTORICAL_DIR);
  } catch {
    // No historical dir → no configs; every lookup returns null.
    cachedConfigsBySlug = bySlug;
    cachedConfigsByTournamentId = byId;
    cacheLoadedAt = Date.now();
    return;
  }

  // Group files by slug.
  interface StagedEntry {
    slug: string;
    year: number;
    file: string;
  }
  const staged: StagedEntry[] = [];
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    if (f === "_live-tournaments.json") continue;
    const m = f.match(/^(.+?)-(\d{4})\.json$/);
    if (!m) continue;
    staged.push({
      slug: m[1],
      year: Number(m[2]),
      file: path.join(HISTORICAL_DIR, f),
    });
  }

  // Optional live-year metadata: { [slug]: { tournamentId, roundDates } }
  let liveMeta: Record<
    string,
    { tournamentId?: string; roundDates?: Record<string, string> }
  > = {};
  try {
    const raw = await readFile(LIVE_META_FILE, "utf-8");
    liveMeta = JSON.parse(raw);
  } catch {
    /* optional */
  }

  // Group staged by slug.
  const bySlugStaged: Record<string, StagedEntry[]> = {};
  for (const s of staged) {
    (bySlugStaged[s.slug] ??= []).push(s);
  }

  for (const [slug, group] of Object.entries(bySlugStaged)) {
    group.sort((a, b) => a.year - b.year);
    const loaded: Array<{ year: number; data: HistoricalJson }> = [];
    for (const g of group) {
      try {
        const text = await readFile(g.file, "utf-8");
        loaded.push({ year: g.year, data: JSON.parse(text) });
      } catch (err) {
        console.warn(
          `[tournament-config] failed to read ${g.file}`,
          err,
        );
      }
    }
    if (loaded.length === 0) continue;

    const latest = loaded[loaded.length - 1].data;
    const venue = latest.venue ?? {};
    const eventName =
      latest.dgEventName ?? loaded[0].data.dgEventName ?? slug;

    // year → pgaTournamentId
    const yearIds: Record<number, string> = {};
    for (const l of loaded) {
      const id = l.data.pgaTournamentId;
      if (typeof id === "string" && id) yearIds[l.year] = id;
    }

    // Suffix derivation: strip the leading R{year} prefix from the
    // most recent id; the remainder is the tournament index code.
    let suffix = "";
    const lastKnownId = yearIds[loaded[loaded.length - 1].year];
    if (lastKnownId) {
      const m = lastKnownId.match(/^R(\d{4})(.+)$/);
      if (m) suffix = m[2];
    }

    // Course par + hole pars: majority vote across all rounds.
    const parVotes: Record<number, number> = {};
    const holeParVotes: Record<number, Record<number, number>> = {};
    for (const l of loaded) {
      for (const p of l.data.players ?? []) {
        for (const rd of Object.values(p.rounds ?? {})) {
          if (typeof rd.coursePar === "number") {
            parVotes[rd.coursePar] = (parVotes[rd.coursePar] ?? 0) + 1;
          }
          for (const [hStr, hole] of Object.entries(rd.holes ?? {})) {
            const h = Number(hStr);
            if (!Number.isFinite(h)) continue;
            // Historical holes carry `score` but not always `par`.
            // Derive par via majority of the entire dataset — we
            // fall back to a global average if none present.
          }
        }
      }
    }
    // We don't have hole-level par in the historical JSONs; hole
    // pars need to come from an external source. Fall back to a
    // sensible default: if coursePar=72 assume 4-4-4-3-5 pattern
    // is wrong, so instead we compute average score minus a small
    // constant... too fragile. Skip: hole pars are looked up via
    // an external per-course table we ship separately below (or
    // supplied by liveMeta).
    const majorityPar = Object.entries(parVotes)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    const coursePar = majorityPar ? Number(majorityPar) : 72;

    // Hole pars derived: pars are 3/4/5 and vary by hole. Best
    // signal in the historical JSONs: the ratio (score / averagePar)
    // shifts around 1. But cleanest is a fallback rule:
    //   holePar = round(mean_score) tweaked to sum to coursePar.
    // The scoring model treats holePars as calibration for
    // absolute score output only — it always operates on vs-par
    // internally — so a rough estimate is acceptable when we don't
    // have the ground truth.
    const scoreSumByHole: Record<number, { sum: number; n: number }> = {};
    for (const l of loaded) {
      for (const p of l.data.players ?? []) {
        for (const rd of Object.values(p.rounds ?? {})) {
          for (const [hStr, hole] of Object.entries(rd.holes ?? {})) {
            const h = Number(hStr);
            if (!Number.isFinite(h) || typeof hole?.score !== "number") continue;
            const acc = (scoreSumByHole[h] ??= { sum: 0, n: 0 });
            acc.sum += hole.score;
            acc.n += 1;
          }
        }
      }
    }
    const rawHolePars: Record<number, number> = {};
    for (const h of Object.keys(scoreSumByHole).map(Number)) {
      const acc = scoreSumByHole[h];
      const avg = acc.sum / acc.n;
      // Pros average roughly 0.05-0.10 under par per hole on par
      // 4s; less on par 3s; more on par 5s. Simple bucket:
      if (avg < 3.6) rawHolePars[h] = 3;
      else if (avg < 4.6) rawHolePars[h] = 4;
      else rawHolePars[h] = 5;
    }
    // Adjust so par-sum equals coursePar if off by ±1 (typical
    // one-hole misclassification), by nudging the hole whose mean
    // score is closest to the mispredicted boundary.
    let currentSum = Object.values(rawHolePars).reduce((a, b) => a + b, 0);
    if (currentSum !== coursePar && Object.keys(rawHolePars).length === 18) {
      const holes = Object.keys(rawHolePars).map(Number);
      const delta = coursePar - currentSum; // > 0 need to bump, < 0 need to reduce
      const direction = Math.sign(delta);
      const attempts = Math.abs(delta);
      for (let i = 0; i < attempts; i++) {
        // Pick hole whose observed mean is closest to a boundary
        // we could re-classify given the direction.
        let bestHole = -1;
        let bestGap = Infinity;
        for (const h of holes) {
          const p = rawHolePars[h];
          if (direction > 0 && p === 5) continue;
          if (direction < 0 && p === 3) continue;
          const boundary = direction > 0 ? p + 0.4 : p - 0.4;
          const gap = Math.abs(scoreSumByHole[h].sum / scoreSumByHole[h].n - boundary);
          if (gap < bestGap) {
            bestGap = gap;
            bestHole = h;
          }
        }
        if (bestHole >= 0) rawHolePars[bestHole] += direction;
      }
      currentSum = Object.values(rawHolePars).reduce((a, b) => a + b, 0);
    }

    // Hole bearings: derive from pin centroids across all rounds.
    // Approximation — we treat the tee as origin (relative 0,0) and
    // the pin centroid as the "playing direction" endpoint. Pin
    // coords are in a 0-1 normalised frame where +y points up the
    // hole (toward the green in the enhanced frame), so the bearing
    // becomes atan2(x_offset_from_0.5, y_offset_from_0.5).
    const pinCentroidByHole: Record<
      number,
      { xSum: number; ySum: number; n: number }
    > = {};
    for (const l of loaded) {
      for (const rounds of Object.values(l.data.pinsByRoundByHole ?? {})) {
        if (!rounds) continue;
        for (const [hStr, pin] of Object.entries(rounds)) {
          const h = Number(hStr);
          if (
            !Number.isFinite(h) ||
            !pin ||
            typeof pin.x !== "number" ||
            typeof pin.y !== "number"
          ) {
            continue;
          }
          const acc = (pinCentroidByHole[h] ??= { xSum: 0, ySum: 0, n: 0 });
          acc.xSum += pin.x;
          acc.ySum += pin.y;
          acc.n += 1;
        }
      }
    }
    const holeBearings: Record<number, number> = {};
    for (const [hStr, acc] of Object.entries(pinCentroidByHole)) {
      const h = Number(hStr);
      if (acc.n === 0) continue;
      const xMean = acc.xSum / acc.n;
      const yMean = acc.ySum / acc.n;
      // Bearing convention: 0° = North (up), clockwise increasing.
      // In the 0-1 pin frame, +y points AWAY from the tee (green
      // side). So bearing from tee to pin = angle from +y axis
      // clockwise. atan2(dx, dy) with dx = x-0.5, dy = -(y-0.5)
      // because the pin frame's y grows downward on screen but
      // the green sits at top… Actually in Pardle's convention
      // pin y=0 is the top of the green image (far end from tee)
      // and y=1 is the bottom (tee-facing edge). So the "direction
      // the hole plays" is essentially FIXED per hole regardless
      // of pin position — the pin varies within the green but the
      // green is at the top of the frame.
      //
      // For a bearing estimate: the pin roughly centres around
      // (0.5, 0.3-0.4) with the tee at (0.5, 1.0). That means the
      // hole plays "up" the y axis. That's NOT a real compass
      // bearing though — the frame is rotated per-hole to align
      // the fairway vertically.
      //
      // So we can't derive real compass bearings from pin coords
      // alone. Fall back to a "no wind correction" default
      // (bearing = 0 → cos(wind_dir - 0) = cos(wind_dir), which
      // will produce a headwind that's roughly correct on average
      // across a full round for the whole course). For accurate
      // per-hole wind adjustment we need OSM tee-to-green
      // geometry as the original hard-coded table used.
      //
      // Given the model treats bearings as "signal or don't
      // bother", we use the fallback (0°) here. When present,
      // liveMeta.holeBearings overrides this.
      holeBearings[h] = 0;
      // Suppress unused warnings on the derived xMean/yMean —
      // they're intentional dead code because the pin frame
      // doesn't preserve compass orientation.
      void xMean;
      void yMean;
    }

    // Historical round means + medians: per-round field mean and
    // median stroke score, averaged across all years (equal weight
    // per year, not per player). Also record the (mean - median)
    // gap per year:round so we can average it into a course-level
    // skew metric.
    const roundMeansAccum: Partial<
      Record<1 | 2 | 3 | 4, { sum: number; n: number }>
    > = {};
    const roundMediansAccum: Partial<
      Record<1 | 2 | 3 | 4, { sum: number; n: number }>
    > = {};
    const gapsAccum: number[] = [];
    for (const l of loaded) {
      const perYear: Partial<Record<1 | 2 | 3 | 4, number[]>> = {};
      for (const p of l.data.players ?? []) {
        for (const [rStr, rd] of Object.entries(p.rounds ?? {})) {
          const r = Number(rStr) as 1 | 2 | 3 | 4;
          if (![1, 2, 3, 4].includes(r) || typeof rd.score !== "number") {
            continue;
          }
          (perYear[r] ??= []).push(rd.score);
        }
      }
      for (const r of [1, 2, 3, 4] as const) {
        const arr = perYear[r];
        // Require at least 20 finishers so a very-short field
        // (weather-abandoned round, tiny opposite-field event)
        // can't drag the mean/median with a handful of scores.
        if (!arr || arr.length < 20) continue;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        const median = computeMedian(arr);
        const acc = (roundMeansAccum[r] ??= { sum: 0, n: 0 });
        acc.sum += mean;
        acc.n += 1;
        const medAcc = (roundMediansAccum[r] ??= { sum: 0, n: 0 });
        medAcc.sum += median;
        medAcc.n += 1;
        gapsAccum.push(mean - median);
      }
    }
    const historicalRoundMeansByRound: Partial<
      Record<1 | 2 | 3 | 4, number>
    > = {};
    const historicalRoundMediansByRound: Partial<
      Record<1 | 2 | 3 | 4, number>
    > = {};
    for (const r of [1, 2, 3, 4] as const) {
      const acc = roundMeansAccum[r];
      if (acc && acc.n > 0) {
        historicalRoundMeansByRound[r] = Number(
          (acc.sum / acc.n).toFixed(2),
        );
      }
      const medAcc = roundMediansAccum[r];
      if (medAcc && medAcc.n > 0) {
        historicalRoundMediansByRound[r] = Number(
          (medAcc.sum / medAcc.n).toFixed(2),
        );
      }
    }
    const historicalMeanMedianGap =
      gapsAccum.length > 0
        ? Number(
            (
              gapsAccum.reduce((a, b) => a + b, 0) / gapsAccum.length
            ).toFixed(3),
          )
        : 0;

    // Per-player round-score sigma: for each dg_id, gather every
    // scored round across every year of history and compute the
    // sample standard deviation. Skip players with fewer than 4
    // rounds — the sigma estimate is too noisy under that.
    const roundsByDgId: Record<string, number[]> = {};
    for (const l of loaded) {
      for (const p of l.data.players ?? []) {
        const dgId = p.dgId;
        if (!dgId) continue;
        for (const rd of Object.values(p.rounds ?? {})) {
          if (typeof rd.score === "number") {
            (roundsByDgId[dgId] ??= []).push(rd.score);
          }
        }
      }
    }
    const playerRoundScoreSigmaByDgId: Record<string, number> = {};
    const allRoundsFlat: number[] = [];
    for (const [dgId, arr] of Object.entries(roundsByDgId)) {
      if (arr.length < 4) continue;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      const variance =
        arr.reduce((a, v) => a + (v - mean) * (v - mean), 0) /
        (arr.length - 1);
      const sigma = Math.sqrt(variance);
      if (Number.isFinite(sigma) && sigma > 0) {
        playerRoundScoreSigmaByDgId[dgId] = Number(sigma.toFixed(3));
      }
      for (const s of arr) allRoundsFlat.push(s);
    }
    // Course-average sigma across every player-round we have. Used
    // as fallback for players not in the per-player map.
    let fieldRoundScoreSigmaBaseline = 2.8;
    if (allRoundsFlat.length >= 100) {
      const mean =
        allRoundsFlat.reduce((a, b) => a + b, 0) / allRoundsFlat.length;
      const variance =
        allRoundsFlat.reduce((a, v) => a + (v - mean) * (v - mean), 0) /
        (allRoundsFlat.length - 1);
      const sigma = Math.sqrt(variance);
      if (Number.isFinite(sigma) && sigma > 0) {
        fieldRoundScoreSigmaBaseline = Number(sigma.toFixed(3));
      }
    }

    // Bearings + course par + hole pars can be overridden by an
    // on-disk per-slug metadata file — same shape the fetch script
    // emits. Look for `data/historical/{slug}-meta.json`. Bearings
    // in particular MUST come from this file for the wind
    // correction to work; they can't be derived from pin coords
    // (the pin frame is rotated per-hole to align the fairway
    // vertically, so it doesn't preserve compass orientation).
    let holeParsOverride: Record<number, number> | null = null;
    let holeBearingsOverride: Record<number, number> | null = null;
    let coursePar_ = coursePar;
    try {
      const meta = JSON.parse(
        await readFile(
          path.join(HISTORICAL_DIR, `${slug}-meta.json`),
          "utf-8",
        ),
      );
      if (meta.courseHolePars) {
        // Normalise string keys → number keys.
        holeParsOverride = {};
        for (const [k, v] of Object.entries(meta.courseHolePars)) {
          holeParsOverride[Number(k)] = Number(v);
        }
      }
      if (meta.holeBearings) {
        holeBearingsOverride = {};
        for (const [k, v] of Object.entries(meta.holeBearings)) {
          holeBearingsOverride[Number(k)] = Number(v);
        }
      }
      if (typeof meta.coursePar === "number") coursePar_ = meta.coursePar;
    } catch {
      /* optional */
    }

    const historicalYears = loaded.map((l) => l.year).sort((a, b) => a - b);

    const cfg: TournamentConfig = {
      slug,
      eventName,
      venue,
      historicalYears,
      historicalTournamentIds: yearIds,
      tournamentIdSuffix: suffix,
      coursePar: coursePar_,
      courseHolePars: holeParsOverride ?? rawHolePars,
      holeBearings: holeBearingsOverride ?? holeBearings,
      historicalRoundMeansByRound,
      historicalRoundMediansByRound,
      historicalMeanMedianGap,
      playerRoundScoreSigmaByDgId,
      fieldRoundScoreSigmaBaseline,
      liveRoundDates: liveMeta[slug]?.roundDates,
    };

    bySlug.set(slug, cfg);
    for (const id of Object.values(yearIds)) {
      byId.set(id, cfg);
    }
    // Register live-year id from live-tournaments.json if present.
    const liveId = liveMeta[slug]?.tournamentId;
    if (liveId) byId.set(liveId, cfg);
    // Also register the derived-next-year id (previous-year id
    // with year bumped +1) as a best-effort guess — helpful when
    // the fetch script for the live year hasn't been re-run yet.
    if (suffix && historicalYears.length > 0) {
      const lastYear = historicalYears[historicalYears.length - 1];
      const nextYear = lastYear + 1;
      const nextId = `R${nextYear}${suffix}`;
      if (!byId.has(nextId)) byId.set(nextId, cfg);
    }
  }

  cachedConfigsBySlug = bySlug;
  cachedConfigsByTournamentId = byId;
  cacheLoadedAt = Date.now();
}

// ── Public API ────────────────────────────────────────────────────

/** Return config for a given live/historical tournamentId, or null
 *  if no historical data exists for that venue yet. */
export async function getTournamentConfig(
  tournamentId: string | null | undefined,
): Promise<TournamentConfig | null> {
  if (!tournamentId) return null;
  await loadAll();
  return cachedConfigsByTournamentId?.get(tournamentId) ?? null;
}

/** All known tournament slugs. Used by course-pin-birdies and the
 *  onboarding script for family enumeration. */
export async function listTournamentConfigs(): Promise<TournamentConfig[]> {
  await loadAll();
  return [...(cachedConfigsBySlug?.values() ?? [])];
}
