import { describe, expect, it } from "vitest";
import { generateDailyTrivia } from "./trivia";
import { TRIVIA_QUESTIONS, type TriviaDifficulty } from "@/lib/data/trivia";

function poolSize(difficulty: TriviaDifficulty): number {
  return TRIVIA_QUESTIONS.filter((q) => q.difficulty === difficulty).length;
}

function idsFor(day: number, difficulty: TriviaDifficulty): Set<string> {
  return new Set(
    generateDailyTrivia(day, difficulty).questions.map((q) => q.id),
  );
}

describe("trivia daily picker", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    it(`${difficulty}: adjacent days inside a cycle share zero questions`, () => {
      const cycle = Math.floor(poolSize(difficulty) / 10);
      expect(cycle).toBeGreaterThanOrEqual(2);

      for (let cycleStart = 0; cycleStart < 200; cycleStart += cycle) {
        for (let d = cycleStart; d < cycleStart + cycle - 1; d++) {
          const today = idsFor(d, difficulty);
          const tomorrow = idsFor(d + 1, difficulty);
          const overlap = [...today].filter((x) => tomorrow.has(x));
          expect(overlap).toEqual([]);
        }
      }
    });

    it(`${difficulty}: each day picks 10 distinct questions`, () => {
      for (let d = 0; d < 50; d++) {
        const trivia = generateDailyTrivia(d, difficulty);
        expect(trivia.questions).toHaveLength(10);
        const ids = new Set(trivia.questions.map((q) => q.id));
        expect(ids.size).toBe(10);
      }
    });

    it(`${difficulty}: same day produces the same picks (determinism)`, () => {
      for (const d of [1, 7, 42, 365]) {
        const a = idsFor(d, difficulty);
        const b = idsFor(d, difficulty);
        expect([...a].sort()).toEqual([...b].sort());
      }
    });
  }
});
