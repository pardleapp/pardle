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
const KEY_ARCHETYPE = (courseName: string) =>
  `course-history:archetype:v1:${slugify(courseName)}`;

/** Minimum tee shots a player needs before we trust their profile. */
const MIN_SHOTS_PER_PLAYER = 100;
/** How many outperformers we include in the group. Big enough to
 *  average out noise, small enough that they're actually top-of-list. */
const OUTPERFORMER_TOP_N = 20;
/** Min rounds at the target course for a player to be eligible as an
 *  outperformer — smaller samples are too noisy at this stage. */
const MIN_ROUNDS_AT_COURSE = 8;
/** z-score threshold for "distinguishing" a dimension. */
const Z_THRESHOLD = 0.5;

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
  groupMean: number;
  tourMean: number;
  tourStd: number;
  /** z = (group − tour) / tourStd. Positive = the outperformer group
   *  is HIGHER than tour average on this dimension. */
  zScore: number;
  /** Rough English interpretation ("faster ball speed", "flatter
   *  trajectory", etc.) so the UI can render a sentence without
   *  hard-coding. */
  interpretation: string;
}

export interface CourseArchetypeResponse {
  courseName: string;
  outperformerSample: number;
  playersMatched: number;
  playersUnmatched: string[];
  distinguishing: ArchetypeDimensionRow[];
  /** The top-N outperformers we grouped, with their profile-mean
   *  values on every dimension. UI can render as a small table. */
  sample: Array<{
    name: string;
    playerId: string;
    roundsAtCourse: number;
    outperformanceSgOtt: number;
    stats: Partial<Record<ProfileDimension, number>>;
  }>;
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

  // Top-N OTT outperformers with enough rounds to matter.
  const outperformers = [...history.players]
    .filter((p) => p.roundsPlayed >= MIN_ROUNDS_AT_COURSE)
    .sort((a, b) => b.outperformanceSgOtt - a.outperformanceSgOtt)
    .slice(0, OUTPERFORMER_TOP_N);

  const sample: CourseArchetypeResponse["sample"] = [];
  const matchedProfiles: PlayerDrivingProfile[] = [];
  const unmatchedNames: string[] = [];

  for (const p of outperformers) {
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
    matchedProfiles.push(profile);
    const stats: Partial<Record<ProfileDimension, number>> = {};
    for (const d of PROFILE_DIMENSIONS) {
      stats[d] = profile.stats[d]?.mean;
    }
    sample.push({
      name: p.name,
      playerId: pid,
      roundsAtCourse: p.roundsPlayed,
      outperformanceSgOtt: p.outperformanceSgOtt,
      stats,
    });
  }

  if (matchedProfiles.length < 4) return null;

  // Compute group means per dimension and z-scores.
  const rows: ArchetypeDimensionRow[] = [];
  for (const d of PROFILE_DIMENSIONS) {
    const vals = matchedProfiles
      .map((p) => p.stats[d]?.mean)
      .filter((v): v is number => Number.isFinite(v));
    if (vals.length === 0) continue;
    const groupMean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const t = tourStats[d];
    if (!t || t.tourStd <= 0) continue;
    const z = (groupMean - t.tourMean) / t.tourStd;
    const meta = DIM_META[d];
    rows.push({
      dim: d,
      label: meta.label,
      unit: meta.unit,
      groupMean,
      tourMean: t.tourMean,
      tourStd: t.tourStd,
      zScore: z,
      interpretation: meta.higherIs(z >= 0 ? 1 : -1),
    });
  }
  // Sort by magnitude of z-score descending — the strongest signals
  // come first — and filter to only the distinguishing traits.
  const distinguishing = rows
    .filter((r) => Math.abs(r.zScore) >= Z_THRESHOLD)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  const response: CourseArchetypeResponse = {
    courseName: cleanCourse,
    outperformerSample: outperformers.length,
    playersMatched: matchedProfiles.length,
    playersUnmatched: unmatchedNames,
    distinguishing,
    sample,
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
