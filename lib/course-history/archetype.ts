/**
 * Course archetype computation.
 *
 * Given a course, identifies which physical ballstriking traits
 * characterise the players who OUTPERFORM their baseline at that
 * course. Idea: at Torrey Pines, high-ball-speed players (Potgieter,
 * Knapp, Woodland) tend to outperform — the tool surfaces that so a
 * user can spot the "type" of player who fits the venue.
 *
 * Algorithm:
 *   1. Take the top-N OTT outperformers at the target course (from
 *      the course-history aggregate), filtered to a minimum-rounds
 *      threshold for signal.
 *   2. Look up each player's off-the-tee ball-flight profile (from
 *      the existing tee-shots store).
 *   3. For each physical dimension (ball speed, carry, apex, spin,
 *      shape, etc.), compare the outperformer group's mean to the
 *      tour-wide mean+std.
 *   4. Report dimensions where the group is materially different
 *      from tour average (|z| ≥ 0.5), sorted by magnitude.
 *
 * Cached in Redis: 6h TTL. Cold-cache computation is dominated by the
 * tour-stats build (walks every ≥100-shot player), so subsequent
 * requests for different courses share that work.
 */

import { Redis } from "@upstash/redis";
import {
  getTeeShots,
  getPlayerName,
  listRankedPlayers,
} from "@/lib/feed/tee-shots-store";
import {
  buildProfile,
  PROFILE_DIMENSIONS,
  type PlayerDrivingProfile,
  type ProfileDimension,
} from "@/lib/feed/tee-shots-profile";
import { getCourseHistoryByCourse } from "./index";

const redis = (() => {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
})();

const CACHE_TTL_TOUR_STATS = 24 * 60 * 60;
const CACHE_TTL_ARCHETYPE = 6 * 60 * 60;
const KEY_TOUR_STATS = "course-history:tour-stats:v1";
// v2 = archetype now uses BOTH extremes (top outperformers vs bottom
// underperformers) with delta signals, not just top-vs-tour. Bumped
// to invalidate the old v1 aggregates.
const KEY_ARCHETYPE = (courseName: string) =>
  `course-history:archetype:v2:${slugify(courseName)}`;

/** Minimum tee shots a player needs before we trust their profile. */
const MIN_SHOTS_PER_PLAYER = 100;
/** Min rounds at the target course for a player to be included in
 *  the regression pool. Small samples wash out the correlation. */
const MIN_ROUNDS_AT_COURSE = 8;
/** How many top and bottom players we surface as tangible "here's
 *  who's on each end" context alongside the regression result. */
const EXTREME_TAIL_N = 10;
/** Correlation threshold for calling a non-priority dimension
 *  "distinguishing". Priority dimensions (ball speed, apex, shape)
 *  are ALWAYS reported regardless of correlation. */
const CORRELATION_THRESHOLD = 0.15;

/** Priority dimensions per Tom's brief: the three ball-flight
 *  properties that most obviously index course fit. Always shown in
 *  the archetype panel even when the correlation is modest, because
 *  they're the story the user is here for. */
const PRIORITY_DIMENSIONS: ProfileDimension[] = [
  "ballSpeed",
  "apexHeight",
  "curve",
];

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface TourStatsRow {
  dim: ProfileDimension;
  tourMean: number;
  tourStd: number;
  samplePlayers: number;
}
type TourStats = Record<ProfileDimension, TourStatsRow>;

/** Build the tour-wide mean + standard deviation for each ball-flight
 *  dimension by walking every ≥MIN_SHOTS player and pulling their
 *  profile mean into a tour distribution. Cached 24h. */
async function getTourStats(): Promise<TourStats | null> {
  if (redis) {
    const cached = await redis
      .get<TourStats>(KEY_TOUR_STATS)
      .catch(() => null);
    if (cached) return cached;
  }
  const ranked = await listRankedPlayers(600);
  const eligible = ranked.filter((r) => r.shotCount >= MIN_SHOTS_PER_PLAYER);
  if (eligible.length === 0) return null;

  const perDim: Record<ProfileDimension, number[]> = Object.fromEntries(
    PROFILE_DIMENSIONS.map((d) => [d, [] as number[]]),
  ) as Record<ProfileDimension, number[]>;

  for (const p of eligible) {
    const records = await getTeeShots(p.playerId);
    if (!records || records.length === 0) continue;
    const name = (await getPlayerName(p.playerId)) ?? p.playerId;
    const prof = buildProfile(p.playerId, name, records, 0);
    for (const d of PROFILE_DIMENSIONS) {
      const v = prof.stats[d]?.mean;
      if (Number.isFinite(v)) perDim[d].push(v);
    }
  }

  const stats = {} as TourStats;
  for (const d of PROFILE_DIMENSIONS) {
    const arr = perDim[d];
    if (arr.length < 3) {
      stats[d] = { dim: d, tourMean: 0, tourStd: 0, samplePlayers: arr.length };
      continue;
    }
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance =
      arr.reduce((a, v) => a + (v - mean) ** 2, 0) / arr.length;
    stats[d] = {
      dim: d,
      tourMean: mean,
      tourStd: Math.sqrt(variance),
      samplePlayers: arr.length,
    };
  }
  if (redis) {
    await redis
      .set(KEY_TOUR_STATS, stats, { ex: CACHE_TTL_TOUR_STATS })
      .catch(() => null);
  }
  return stats;
}

/** Normalise a display name for cross-source matching — lower-case,
 *  strip suffixes like "Jr.", "III", and non-word characters. Handles
 *  the two DataGolf → PGA Tour name variants that show up: "T.J. Chu"
 *  vs "TJ Chu", "Peter Malnati" vs "Peter Malnati Jr." and similar. */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface ArchetypeDimensionRow {
  dim: ProfileDimension;
  /** Human-friendly label. */
  label: string;
  /** Human-friendly unit. */
  unit: string;
  /** Weighted Pearson r across ALL matched players — correlation of
   *  outperformanceSgOtt with this dimension's value, weighted by
   *  rounds played at the course. |r| between 0 (no signal) and 1
   *  (perfect). Sign carries meaning: positive = higher value tracks
   *  higher outperformance. */
  correlation: number;
  /** N players in the correlation (both course-history & tee-shot
   *  data available). */
  n: number;
  /** Mean and std for the whole player pool used in the correlation
   *  — helps callers see the working range. */
  poolMean: number;
  poolStd: number;
  /** Tangible context: mean of the TOP N and BOTTOM N players by
   *  outperformanceSgOtt within the matched pool. Same signal as the
   *  correlation, easier to read as a headline number. */
  topTailMean: number;
  bottomTailMean: number;
  /** (topTailMean − bottomTailMean) / tourStd — standardised gap
   *  between the extreme tails. */
  standardizedTailGap: number;
  tourMean: number;
  tourStd: number;
  /** English interpretation from the higher-outperformance side. */
  interpretation: string;
  /** True when this is a Tom-flagged priority dimension (ballSpeed,
   *  apexHeight, curve) — the UI can render it always, even if
   *  correlation is modest. */
  isPriority: boolean;
}

interface SamplePlayer {
  name: string;
  playerId: string;
  roundsAtCourse: number;
  outperformanceSgOtt: number;
  stats: Partial<Record<ProfileDimension, number>>;
}

export interface CourseArchetypeResponse {
  courseName: string;
  /** How many course-history eligible players we had (before
   *  matching to tee-shot profiles). */
  eligiblePlayers: number;
  /** How many made it into the correlation pool. */
  matchedPlayers: number;
  unmatchedNames: string[];
  /** Dimensions sorted by |correlation| — priority dimensions
   *  first (always present), then non-priority above the threshold. */
  distinguishing: ArchetypeDimensionRow[];
  /** Top N by outperformance for context; bottom N by same. Every
   *  entry is a matched player with their profile-stat means so the
   *  UI can eyeball the pattern. */
  outperformerTail: SamplePlayer[];
  underperformerTail: SamplePlayer[];
}

const DIM_META: Record<ProfileDimension, { label: string; unit: string; higherIs: (dir: 1 | -1) => string }> = {
  ballSpeed: {
    label: "Ball speed",
    unit: "mph",
    higherIs: (d) => (d > 0 ? "faster ball speed" : "slower ball speed"),
  },
  carry: {
    label: "Carry distance",
    unit: "yd",
    higherIs: (d) => (d > 0 ? "longer carry" : "shorter carry"),
  },
  apexHeight: {
    label: "Apex height",
    unit: "ft",
    higherIs: (d) => (d > 0 ? "higher apex" : "flatter/lower apex"),
  },
  verticalLaunchAngle: {
    label: "Launch angle",
    unit: "°",
    higherIs: (d) => (d > 0 ? "higher launch" : "lower launch"),
  },
  horizontalLaunchAngle: {
    label: "Aim direction",
    unit: "°",
    higherIs: (d) => (d > 0 ? "aim right of average" : "aim left of average"),
  },
  curve: {
    label: "Shot curve",
    unit: "yd",
    higherIs: (d) =>
      d > 0 ? "more right-drift (fade bias)" : "more left-drift (draw bias)",
  },
  carrySide: {
    label: "Landing side",
    unit: "yd",
    higherIs: (d) =>
      d > 0 ? "landing right of aim" : "landing left of aim",
  },
  launchSpin: {
    label: "Spin rate",
    unit: "rpm",
    higherIs: (d) => (d > 0 ? "higher spin" : "lower spin"),
  },
  sideSpin: {
    label: "Side spin",
    unit: "rpm",
    higherIs: (d) => (d > 0 ? "fade side-spin" : "draw side-spin"),
  },
};

/** Build (or serve cached) the course archetype for a specific
 *  course. Returns null when we don't have enough matched players
 *  to make a meaningful signal. */
export async function getCourseArchetype(
  courseName: string,
): Promise<CourseArchetypeResponse | null> {
  const cleanCourse = courseName.trim();
  if (!cleanCourse) return null;
  if (redis) {
    const cached = await redis
      .get<CourseArchetypeResponse>(KEY_ARCHETYPE(cleanCourse))
      .catch(() => null);
    if (cached) return cached;
  }

  const [history, tourStats, ranked] = await Promise.all([
    getCourseHistoryByCourse(cleanCourse),
    getTourStats(),
    listRankedPlayers(600),
  ]);
  if (!history || !tourStats) return null;

  // Build a name → playerId lookup from the tee-shot ranked list.
  const nameToId = new Map<string, string>();
  await Promise.all(
    ranked.map(async (r) => {
      const name = await getPlayerName(r.playerId);
      if (!name) return;
      nameToId.set(normaliseName(name), r.playerId);
    }),
  );

  // Every course-history player with enough rounds to be worth
  // scoring — from this pool we take everyone with a tee-shot profile
  // and regress outperformance against each ball-flight dimension.
  const eligible = history.players.filter(
    (p) => p.roundsPlayed >= MIN_ROUNDS_AT_COURSE,
  );

  interface MatchedPoint {
    name: string;
    playerId: string;
    roundsAtCourse: number;
    outperformanceSgOtt: number;
    stats: Partial<Record<ProfileDimension, number>>;
  }
  const matched: MatchedPoint[] = [];
  const unmatchedNames: string[] = [];
  const seenProfiles: PlayerDrivingProfile[] = [];

  for (const p of eligible) {
    const pid = nameToId.get(normaliseName(p.name));
    if (!pid) {
      unmatchedNames.push(p.name);
      continue;
    }
    const records = await getTeeShots(pid);
    if (!records || records.length < MIN_SHOTS_PER_PLAYER) {
      unmatchedNames.push(p.name);
      continue;
    }
    const profile = buildProfile(pid, p.name, records, 0);
    seenProfiles.push(profile);
    const stats: Partial<Record<ProfileDimension, number>> = {};
    for (const d of PROFILE_DIMENSIONS) {
      stats[d] = profile.stats[d]?.mean;
    }
    matched.push({
      name: p.name,
      playerId: pid,
      roundsAtCourse: p.roundsPlayed,
      outperformanceSgOtt: p.outperformanceSgOtt,
      stats,
    });
  }

  // Need enough data points for the regression to be meaningful.
  if (matched.length < 10) return null;

  /** Weighted Pearson correlation between two arrays. Weights are
   *  the players' rounds played at the course — a player with 20
   *  rounds is a more reliable data point than one with 8. */
  function weightedPearson(
    xs: number[],
    ys: number[],
    ws: number[],
  ): { r: number; xMean: number; xStd: number; yMean: number; yStd: number } {
    const sumW = ws.reduce((a, b) => a + b, 0);
    const xMean = xs.reduce((a, x, i) => a + x * ws[i], 0) / sumW;
    const yMean = ys.reduce((a, y, i) => a + y * ws[i], 0) / sumW;
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - xMean;
      const dy = ys[i] - yMean;
      cov += ws[i] * dx * dy;
      vx += ws[i] * dx * dx;
      vy += ws[i] * dy * dy;
    }
    const xStd = Math.sqrt(vx / sumW);
    const yStd = Math.sqrt(vy / sumW);
    const denom = Math.sqrt(vx) * Math.sqrt(vy);
    return {
      r: denom > 0 ? cov / denom : 0,
      xMean,
      xStd,
      yMean,
      yStd,
    };
  }

  // Extreme tails for tangible context alongside the correlation.
  const sortedDesc = [...matched].sort(
    (a, b) => b.outperformanceSgOtt - a.outperformanceSgOtt,
  );
  const outperformerTail = sortedDesc.slice(0, EXTREME_TAIL_N);
  const underperformerTail = sortedDesc.slice(-EXTREME_TAIL_N).reverse();

  // Compute the full-pool correlation + tail contrast per dimension.
  const rows: ArchetypeDimensionRow[] = [];
  for (const d of PROFILE_DIMENSIONS) {
    const isPriority = PRIORITY_DIMENSIONS.includes(d);
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (const p of matched) {
      const y = p.stats[d];
      if (typeof y !== "number") continue;
      xs.push(p.outperformanceSgOtt);
      ys.push(y);
      ws.push(p.roundsAtCourse);
    }
    if (xs.length < 8) continue;
    const { r, yMean, yStd } = weightedPearson(xs, ys, ws);

    const topVals = outperformerTail
      .map((p) => p.stats[d])
      .filter((v): v is number => Number.isFinite(v));
    const botVals = underperformerTail
      .map((p) => p.stats[d])
      .filter((v): v is number => Number.isFinite(v));
    if (topVals.length === 0 || botVals.length === 0) continue;
    const topTailMean =
      topVals.reduce((a, b) => a + b, 0) / topVals.length;
    const bottomTailMean =
      botVals.reduce((a, b) => a + b, 0) / botVals.length;
    const t = tourStats[d];
    if (!t || t.tourStd <= 0) continue;
    const standardizedTailGap = (topTailMean - bottomTailMean) / t.tourStd;

    const meta = DIM_META[d];
    // Interpretation direction from CORRELATION sign (which uses the
    // full pool), fallback to tail gap when r is essentially zero.
    const signalSign = Math.abs(r) > 0.01 ? Math.sign(r) : Math.sign(standardizedTailGap);
    rows.push({
      dim: d,
      label: meta.label,
      unit: meta.unit,
      correlation: r,
      n: xs.length,
      poolMean: yMean,
      poolStd: yStd,
      topTailMean,
      bottomTailMean,
      standardizedTailGap,
      tourMean: t.tourMean,
      tourStd: t.tourStd,
      interpretation: meta.higherIs((signalSign >= 0 ? 1 : -1) as 1 | -1),
      isPriority,
    });
  }
  // Priority dimensions first (in priority order), then non-priority
  // that clear the correlation threshold, sorted by |r|.
  const priority: ArchetypeDimensionRow[] = [];
  const secondary: ArchetypeDimensionRow[] = [];
  for (const r of rows) {
    if (r.isPriority) priority.push(r);
    else if (Math.abs(r.correlation) >= CORRELATION_THRESHOLD) {
      secondary.push(r);
    }
  }
  priority.sort(
    (a, b) =>
      PRIORITY_DIMENSIONS.indexOf(a.dim) -
      PRIORITY_DIMENSIONS.indexOf(b.dim),
  );
  secondary.sort(
    (a, b) => Math.abs(b.correlation) - Math.abs(a.correlation),
  );
  const distinguishing = [...priority, ...secondary];

  const response: CourseArchetypeResponse = {
    courseName: cleanCourse,
    eligiblePlayers: eligible.length,
    matchedPlayers: matched.length,
    unmatchedNames,
    distinguishing,
    outperformerTail,
    underperformerTail,
  };
  if (redis) {
    await redis
      .set(KEY_ARCHETYPE(cleanCourse), response, {
        ex: CACHE_TTL_ARCHETYPE,
      })
      .catch(() => null);
  }
  return response;
}
