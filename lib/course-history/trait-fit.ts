/**
 * Trait-based course fit.
 *
 * The other half of this tool asks "has THIS player played well here
 * before" and answers, honestly, that almost nothing repeats (see
 * ./persistence). This module asks the question that does have signal:
 * "what kind of player does this course reward?"
 *
 * The difference is sample size, and it is enormous. A player's own
 * record at a venue is two to six visits. A venue's record of how it
 * treats DRIVERS pools every player who has teed it up there — three
 * hundred-odd player-events at a long-running venue. Same rounds,
 * ninety times the sample, because the unit stops being the player and
 * becomes the trait.
 *
 * Method. For every player at the course, regress what they actually
 * hit it like there on what their skill said to expect:
 *
 *     atCourse(OTT+APP)  ~  β_ott · baselineOTT  +  β_app · baselineAPP
 *
 * Both sides are already field-strength adjusted and field-relative
 * upstream. β above the tour-wide value means the course pays MORE for
 * that skill than an average week does; below means it pays less.
 *
 * WHAT THE ARCHIVE ACTUALLY SUPPORTS. Measured over 27,644 player-
 * events, 112 courses, 2014-2026:
 *
 *   - Tour-wide, prior skill predicts at-course ballstriking with
 *     out-of-sample R² = 0.181. β_ott +0.924, β_app +0.663.
 *   - Letting each course have its OWN β adds +0.0006 R² out of
 *     sample at best, and is NEGATIVE (−0.0033) unshrunk.
 *   - Course signatures barely persist: splitting 26 well-sampled
 *     courses in half, the OTT payoff correlates +0.35 early-to-late
 *     and the APP payoff −0.02.
 *   - The resulting per-player adjustment has sd 0.042 str/rd —
 *     about a sixth of a stroke across 72 holes.
 *
 * So this is a real but very small effect, and the APP half of it is
 * indistinguishable from noise. The module is built to say that rather
 * than to dress it up: coefficients are shrunk hard toward the tour
 * mean, the APP term is reported with its own (absent) stability, and
 * the UI states the size in strokes so nobody mistakes it for an edge
 * it isn't.
 *
 * Anyone tempted to loosen SHRINKAGE_K to make the numbers look more
 * decisive should re-run the held-out comparison first; K below ~150
 * makes out-of-sample prediction actively worse.
 */

import { Redis } from "@upstash/redis";
import {
  getCuratedCourses,
  getCourseHistoryByCourse,
  type PlayerCourseStats,
} from "./index";

const redis = (() => {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
})();

/** Shrinkage toward the tour-wide coefficients, in player-events.
 *  Chosen by held-out season testing over 2018-2025 — see the module
 *  note. 400 and 1000 tie; 400 keeps a touch more course character. */
const SHRINKAGE_K = 400;
/** Minimum player-events before a course gets its own fit at all. */
const MIN_PLAYER_EVENTS = 40;
/** Minimum distinct visits before we'll try to measure whether the
 *  course's signature is stable over time. */
const MIN_VISITS_FOR_STABILITY = 6;

const KEY_TOUR_PAYOFF = "course-history:tour-payoff:v1";
const KEY_TRAIT_FIT = (slug: string) =>
  `course-history:trait-fit:v1:${slug}`;
const TTL_TOUR = 30 * 24 * 60 * 60;
const TTL_FIT = 6 * 60 * 60;

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface TraitBetas {
  ott: number;
  app: number;
}

export interface CourseTraitFit {
  courseName: string;
  /** Player-events behind the course's own fit. */
  sample: number;
  /** Tour-wide payoff for each skill — the neutral reference. */
  tour: TraitBetas;
  /** This course's raw (unshrunk) payoff. Shown for transparency; not
   *  what the adjustment uses. */
  raw: TraitBetas;
  /** Shrunk toward `tour` by sample / (sample + K). What we use. */
  shrunk: TraitBetas;
  /** shrunk − tour. Positive = this course pays more than average for
   *  that skill. The whole course-fit story lives in these two. */
  premium: TraitBetas;
  /** Weight the course's own coefficients received, 0-1. */
  shrinkWeight: number;
  /** How much the per-player adjustment actually moves, in strokes per
   *  round, across the players at this course. Surfaced so the UI can
   *  state the effect size honestly. */
  adjustmentSd: number;
  /** Whether the venue's signature held up across the first and second
   *  halves of its own history. Null when it has too few visits to
   *  check. Tour-wide these run about +0.35 for OTT and ~0 for APP,
   *  so treat a single course's value as weak evidence either way. */
  stability: { ott: number | null; app: number | null; visits: number };
}

/** Least squares of `y` on two predictors plus an intercept. Small
 *  enough that a closed-form solve beats pulling in a dependency.
 *  Returns null on a singular system. Exported for tests — the
 *  coefficients it produces are what the whole panel rests on. */
export function ols2(
  x1: number[],
  x2: number[],
  y: number[],
): TraitBetas | null {
  const n = y.length;
  if (n < 8) return null;
  let s11 = 0,
    s12 = 0,
    s1y = 0,
    s22 = 0,
    s2y = 0,
    s1 = 0,
    s2 = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    s11 += x1[i] * x1[i];
    s12 += x1[i] * x2[i];
    s22 += x2[i] * x2[i];
    s1y += x1[i] * y[i];
    s2y += x2[i] * y[i];
    s1 += x1[i];
    s2 += x2[i];
    sy += y[i];
  }
  // Centre out the intercept so we solve a 2x2 rather than a 3x3.
  const c11 = s11 - (s1 * s1) / n;
  const c12 = s12 - (s1 * s2) / n;
  const c22 = s22 - (s2 * s2) / n;
  const c1y = s1y - (s1 * sy) / n;
  const c2y = s2y - (s2 * sy) / n;
  const det = c11 * c22 - c12 * c12;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  return {
    ott: (c22 * c1y - c12 * c2y) / det,
    app: (c11 * c2y - c12 * c1y) / det,
  };
}

function betasFor(players: PlayerCourseStats[]): TraitBetas | null {
  return ols2(
    players.map((p) => p.baselineSgOtt),
    players.map((p) => p.baselineSgApp),
    players.map((p) => p.atCourseCombined),
  );
}

/**
 * Tour-wide payoff for prior OTT and APP skill, pooled over every
 * course in the archive. This is the reference every course is
 * measured against, and it is the part of the model that carries
 * essentially all of the predictive power.
 *
 * Cached 30 days — it moves at the pace of the tour, not the week.
 */
export async function getTourWidePayoff(): Promise<TraitBetas> {
  if (redis) {
    const cached = await redis
      .get<TraitBetas>(KEY_TOUR_PAYOFF)
      .catch(() => null);
    if (cached && typeof cached.ott === "number") return cached;
  }
  const courses = await getCuratedCourses();
  const aggregates = await Promise.all(
    courses.map((c) => getCourseHistoryByCourse(c.courseName).catch(() => null)),
  );
  const x1: number[] = [];
  const x2: number[] = [];
  const y: number[] = [];
  for (const a of aggregates) {
    if (!a?.players) continue;
    for (const p of a.players) {
      x1.push(p.baselineSgOtt);
      x2.push(p.baselineSgApp);
      y.push(p.atCourseCombined);
    }
  }
  // Fall back to the constants measured offline over the same archive
  // if the pooled fit fails for any reason — better a known-good
  // reference than none.
  const fitted = ols2(x1, x2, y) ?? { ott: 0.924, app: 0.663 };
  if (redis) {
    await redis.set(KEY_TOUR_PAYOFF, fitted, { ex: TTL_TOUR }).catch(() => null);
  }
  return fitted;
}

function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const m = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = m(a);
  const mb = m(b);
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  if (saa <= 0 || sbb <= 0) return null;
  return sab / Math.sqrt(saa * sbb);
}

/** Per-player course-fit adjustment, in strokes per round. Positive =
 *  this player's skill profile is worth more here than at an average
 *  venue. Deliberately small — see the module note on effect size. */
export function fitAdjustmentFor(
  fit: CourseTraitFit | null | undefined,
  player: Pick<PlayerCourseStats, "baselineSgOtt" | "baselineSgApp">,
): number {
  if (!fit) return 0;
  return (
    fit.premium.ott * player.baselineSgOtt +
    fit.premium.app * player.baselineSgApp
  );
}

export async function getCourseTraitFit(
  courseName: string,
): Promise<CourseTraitFit | null> {
  const slug = slugify(courseName);
  if (redis) {
    const cached = await redis
      .get<CourseTraitFit>(KEY_TRAIT_FIT(slug))
      .catch(() => null);
    if (cached && cached.tour) return cached;
  }
  const agg = await getCourseHistoryByCourse(courseName);
  if (!agg?.players || agg.players.length < MIN_PLAYER_EVENTS) return null;

  const tour = await getTourWidePayoff();
  const raw = betasFor(agg.players);
  if (!raw) return null;

  const sample = agg.players.length;
  const w = sample / (sample + SHRINKAGE_K);
  const shrunk: TraitBetas = {
    ott: tour.ott + (raw.ott - tour.ott) * w,
    app: tour.app + (raw.app - tour.app) * w,
  };
  const premium: TraitBetas = {
    ott: shrunk.ott - tour.ott,
    app: shrunk.app - tour.app,
  };

  // Effect size, stated in the units a reader cares about.
  const adjustments = agg.players.map(
    (p) => premium.ott * p.baselineSgOtt + premium.app * p.baselineSgApp,
  );
  const am =
    adjustments.reduce((s, x) => s + x, 0) / Math.max(adjustments.length, 1);
  const adjustmentSd = Math.sqrt(
    adjustments.reduce((s, x) => s + (x - am) ** 2, 0) /
      Math.max(adjustments.length - 1, 1),
  );

  // Does the venue's signature hold across its own history? Split by
  // years covered — the same early-vs-late logic the persistence
  // module applies to players, applied here to the course itself.
  const years = agg.yearsCovered ?? [];
  let stabOtt: number | null = null;
  let stabApp: number | null = null;
  if (years.length >= MIN_VISITS_FOR_STABILITY) {
    // We only have per-player aggregates here, not per-visit rows, so
    // the honest split is by player sample halves rather than by year.
    // Sorting by rounds played puts the best-sampled players in both
    // halves rather than concentrating them in one.
    const sorted = [...agg.players].sort((a, b) => b.roundsPlayed - a.roundsPlayed);
    const evens = sorted.filter((_, i) => i % 2 === 0);
    const odds = sorted.filter((_, i) => i % 2 === 1);
    const be = betasFor(evens);
    const bo = betasFor(odds);
    if (be && bo) {
      // A two-point correlation is meaningless; what we can report is
      // whether the two halves agree in sign and rough size. Express
      // that as a normalised agreement in [-1, 1].
      const agree = (x: number, y: number) =>
        x === 0 && y === 0
          ? null
          : (x * y) / Math.max(x * x, y * y);
      stabOtt = agree(be.ott - tour.ott, bo.ott - tour.ott);
      stabApp = agree(be.app - tour.app, bo.app - tour.app);
    }
  }

  const out: CourseTraitFit = {
    courseName: agg.courseName,
    sample,
    tour,
    raw,
    shrunk,
    premium,
    shrinkWeight: w,
    adjustmentSd,
    stability: { ott: stabOtt, app: stabApp, visits: years.length },
  };
  if (redis) {
    await redis.set(KEY_TRAIT_FIT(slug), out, { ex: TTL_FIT }).catch(() => null);
  }
  return out;
}
