/**
 * Pardle: Faces — daily face-blend puzzle picker.
 *
 * Two players' Wikipedia headshots are blended into one ambiguous face
 * via stacked images + mix-blend-mode. The player has to identify both
 * pros from the merged image.
 *
 * Pool is restricted to recognisable pros (S/A/B tier) WITH a
 * non-null Wikipedia imageUrl — anyone the player wouldn't have heard
 * of, or anyone we have no photo for, is skipped.
 *
 * The puzzle for each UTC day is the same for every player.
 */

import { GOLFERS } from "@/lib/data/golfers";
import {
  PGA_TOUR_IDS,
  pgaTourHeadshotUrl,
} from "@/lib/data/pga-tour-ids";
import type { Golfer } from "@/lib/game/types";

export const TOTAL_GUESSES = 4;

/** Number of blended-face puzzles in a daily round. */
export const PUZZLES_PER_DAY = 6;

/** All pros eligible for face puzzles. Restricted to S/A/B tier pros
 * with a known PGA Tour ID — this guarantees we can fetch a face-cropped
 * headshot from PGA Tour's Cloudinary endpoint so both faces actually
 * line up when blended. Wikipedia thumbnails (which we still use for the
 * other games) crop too inconsistently for the blend to work. */
export function facesPool(): Golfer[] {
  return GOLFERS.filter(
    (g) =>
      (g.tier === "S" || g.tier === "A" || g.tier === "B") &&
      PGA_TOUR_IDS[g.id] !== undefined,
  );
}

/** Face-cropped headshot URL for a golfer. Always uses PGA Tour's
 * Cloudinary `g_face:center` transform so faces line up regardless of
 * the source photo. Returns null only if the golfer is missing from the
 * `PGA_TOUR_IDS` map — which the Faces pool filter rules out. */
export function headshotUrl(golfer: Golfer): string | null {
  return pgaTourHeadshotUrl(golfer.id);
}

export interface FacesPuzzle {
  dayNumber: number;
  /** Both pros to guess. Order is arbitrary — the player can name them
   *  in either slot. */
  left: Golfer;
  right: Golfer;
}

// Mulberry32 — deterministic PRNG seeded from day index.
function seededRandom(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickDailyPair(dayNumber: number): FacesPuzzle {
  const pool = facesPool();
  if (pool.length < 2) {
    throw new Error(
      `Faces pool has only ${pool.length} eligible pros — need at least 2.`,
    );
  }
  // Seed the RNG from the day index so today's pair is stable.
  const rand = seededRandom(dayNumber * 7919 + 13);
  const a = Math.floor(rand() * pool.length);
  let b = Math.floor(rand() * pool.length);
  while (b === a) b = (b + 1) % pool.length;
  return { dayNumber, left: pool[a], right: pool[b] };
}

/**
 * Pick the day's full set of N face puzzles. All 2N pros across the set
 * are distinct — we shuffle the pool deterministically and take pairs
 * off the top — so no pro appears twice in the same day's puzzle set.
 *
 * Used by the solo 6-puzzle mode and the multiplayer duel (which seeds
 * the same shuffle from a per-room seed so all players see the same
 * puzzles in the same order).
 */
export function pickPuzzleSet(args: {
  /** Either a day number (solo) or a room seed (multiplayer). */
  seed: number;
  count?: number;
}): FacesPuzzle[] {
  const count = args.count ?? PUZZLES_PER_DAY;
  const pool = facesPool();
  if (pool.length < count * 2) {
    throw new Error(
      `Faces pool has ${pool.length} eligible pros — need at least ${count * 2} for ${count} puzzles.`,
    );
  }
  const rand = seededRandom(args.seed * 7919 + 13);
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const puzzles: FacesPuzzle[] = [];
  for (let i = 0; i < count; i++) {
    puzzles.push({
      dayNumber: args.seed,
      left: shuffled[i * 2],
      right: shuffled[i * 2 + 1],
    });
  }
  return puzzles;
}

/** Normalise a typed guess for case- + diacritic-insensitive matching. */
export function normaliseGuess(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Is `guess` an acceptable rendering of `golfer`'s name? */
export function matchesGolfer(guess: string, golfer: Golfer): boolean {
  const g = normaliseGuess(guess);
  if (g.length === 0) return false;
  return normaliseGuess(golfer.name) === g;
}
