/**
 * Pardle: Trivia daily picker.
 *
 * Deterministically picks 10 questions from each difficulty's pool
 * per UTC day, then shuffles each question's answer options so the
 * correct answer isn't always in the same position. Same day = same
 * 10 questions for every player worldwide; same day = same option
 * order, so share grids are comparable.
 */

import {
  TRIVIA_QUESTIONS,
  type TriviaDifficulty,
  type TriviaQuestion,
} from "@/lib/data/trivia";

const QUESTIONS_PER_PUZZLE = 10;

export interface DailyTriviaQuestion {
  id: string;
  q: string;
  /** Options re-ordered for display. */
  options: [string, string, string, string];
  /** Index of the correct option after shuffling. */
  correctIndex: 0 | 1 | 2 | 3;
  /** Optional one-line fact shown on reveal. */
  fact?: string;
}

export interface DailyTrivia {
  dayNumber: number;
  difficulty: TriviaDifficulty;
  questions: DailyTriviaQuestion[];
}

// Mulberry32 — small, deterministic PRNG seeded from (day, difficulty).
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

function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DIFFICULTY_SALT: Record<TriviaDifficulty, number> = {
  easy: 1,
  medium: 17,
  hard: 53,
};

export function generateDailyTrivia(
  dayNumber: number,
  difficulty: TriviaDifficulty,
): DailyTrivia {
  const pool = TRIVIA_QUESTIONS.filter((q) => q.difficulty === difficulty);
  if (pool.length < QUESTIONS_PER_PUZZLE) {
    throw new Error(
      `Trivia pool for ${difficulty} has only ${pool.length} questions — need at least ${QUESTIONS_PER_PUZZLE}.`,
    );
  }

  const seed = dayNumber * 1009 + DIFFICULTY_SALT[difficulty];
  const rand = seededRandom(seed);

  const picked = shuffle(pool, rand).slice(0, QUESTIONS_PER_PUZZLE);

  const questions: DailyTriviaQuestion[] = picked.map((q) => {
    // Shuffle the 4 options so the correct answer isn't always at the
    // same index. Track where the correct one ended up.
    const correctText = q.options[q.correct];
    const optionRand = seededRandom(seed + hashString(q.id));
    const shuffled = shuffle(q.options, optionRand);
    const newCorrect = shuffled.indexOf(correctText) as 0 | 1 | 2 | 3;
    return {
      id: q.id,
      q: q.q,
      options: shuffled as [string, string, string, string],
      correctIndex: newCorrect,
      fact: q.fact,
    };
  });

  return { dayNumber, difficulty, questions };
}

function hashString(s: string): number {
  // djb2 — stable, no crypto, fits in 32 bits.
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export type { TriviaDifficulty };
