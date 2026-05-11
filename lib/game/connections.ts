/**
 * Pardle: Connections — golf edition (V2).
 *
 * The V1 generator built categories from orthogonal attribute axes
 * (country × majors × age × Ryder Cup), which meant every famous player
 * satisfied multiple categories at once. The puzzle had no single
 * "correct" answer because Rory could equally well be "Northern Irish",
 * "5+ Ryder Cups", "Multi-major winner", or "In their 30s" — all true.
 *
 * V2 fixes this with two changes:
 *
 *   1. Categories come from a hand-curated library of specific,
 *      discrete groupings (won the Masters, surname starts with M,
 *      from Australia, etc.) — see connections-library.ts.
 *
 *   2. STRICT non-overlap is enforced per puzzle. After picking 4
 *      categories, we verify that each category has ≥4 members
 *      that don't appear in any of the other 3 categories' full
 *      member lists. Then we pick those non-overlapping members so
 *      every chosen golfer belongs to EXACTLY ONE category for this
 *      puzzle. Rory could be the "Northern Irish" answer one day and
 *      the "5+ Ryder Cups" answer another, but never both in the
 *      same puzzle.
 *
 * Generation remains deterministic per UTC day via Mulberry32 seeded
 * from dayNumber.
 */

import { GOLFERS } from "@/lib/data/golfers";
import { CATEGORY_LIBRARY, type CategoryDef } from "./connections-library";
import {
  type ConnectionsCategory,
  type ConnectionsPuzzle,
  DIFFICULTY_ORDER,
  type ConnectionsDifficulty,
} from "./connections-types";

export type {
  ConnectionsCategory,
  ConnectionsPuzzle,
  ConnectionsDifficulty,
} from "./connections-types";
export { DIFFICULTY_ORDER } from "./connections-types";

// Mulberry32 — small, fast, deterministic PRNG.
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

/**
 * Given 4 chosen categories, return the per-category list of members
 * that ONLY belong to that category (not in any of the other 3's full
 * member lists). Returns null if any category has fewer than 4 unique
 * members — puzzle invalid.
 */
function uniqueMembersPerCategory(
  chosen: CategoryDef[],
): string[][] | null {
  const fullSets = chosen.map((c) => new Set(c.memberIds));
  const result: string[][] = [];
  for (let i = 0; i < chosen.length; i++) {
    const own = chosen[i];
    const uniqueToThis: string[] = [];
    for (const id of own.memberIds) {
      let appearsElsewhere = false;
      for (let j = 0; j < chosen.length; j++) {
        if (j === i) continue;
        if (fullSets[j].has(id)) {
          appearsElsewhere = true;
          break;
        }
      }
      if (!appearsElsewhere) uniqueToThis.push(id);
    }
    if (uniqueToThis.length < 4) return null;
    result.push(uniqueToThis);
  }
  return result;
}

export function generatePuzzle(dayNumber: number): ConnectionsPuzzle {
  const byDifficulty: Record<ConnectionsDifficulty, CategoryDef[]> = {
    yellow: [],
    green: [],
    blue: [],
    purple: [],
  };
  for (const c of CATEGORY_LIBRARY) byDifficulty[c.difficulty].push(c);

  // Sanity-check the library has at least one category per difficulty.
  for (const d of DIFFICULTY_ORDER) {
    if (byDifficulty[d].length === 0) {
      throw new Error(
        `Connections category library missing entries for difficulty: ${d}`,
      );
    }
  }

  // Try up to N seed offsets until we find a 4-tuple with strict
  // non-overlap. Library is sized so this usually succeeds in 1-2
  // attempts; the loop is a safety net.
  for (let attempt = 0; attempt < 200; attempt++) {
    const rand = seededRandom(dayNumber * 1009 + attempt);

    // For each difficulty, shuffle candidates and walk through them
    // in order, picking the first that doesn't break non-overlap.
    const chosen: CategoryDef[] = [];
    let aborted = false;
    for (const diff of DIFFICULTY_ORDER) {
      const shuffled = shuffle(byDifficulty[diff], rand);
      let picked: CategoryDef | null = null;
      for (const candidate of shuffled) {
        const others = new Set(
          chosen.flatMap((c) => c.memberIds),
        );
        const availableInCandidate = candidate.memberIds.filter(
          (id) => !others.has(id),
        );
        if (availableInCandidate.length < 4) continue;
        // Tentatively accept — final non-overlap check happens
        // below across all 4 categories together.
        picked = candidate;
        break;
      }
      if (!picked) {
        aborted = true;
        break;
      }
      chosen.push(picked);
    }
    if (aborted || chosen.length !== 4) continue;

    const uniqueMembers = uniqueMembersPerCategory(chosen);
    if (!uniqueMembers) continue;

    // Pick 4 members per category (seeded shuffle). Guaranteed
    // non-overlapping because uniqueMembersPerCategory removed any
    // golfer that appeared in another category's full list.
    const finalCategories: ConnectionsCategory[] = chosen.map((c, i) => {
      const members = shuffle(uniqueMembers[i], rand).slice(0, 4);
      return {
        label: c.label,
        difficulty: c.difficulty,
        memberIds: members,
      };
    });

    // Sanity check: every member appears in exactly one category.
    const seen = new Set<string>();
    for (const cat of finalCategories) {
      for (const id of cat.memberIds) {
        if (seen.has(id)) {
          // Shouldn't happen given uniqueMembersPerCategory, but
          // belt-and-braces — skip this attempt if it does.
          aborted = true;
          break;
        }
        seen.add(id);
      }
      if (aborted) break;
    }
    if (aborted) continue;

    const byId = new Map(GOLFERS.map((g) => [g.id, g] as const));
    const allIds = finalCategories.flatMap((c) => c.memberIds);
    const items = shuffle(allIds, rand).map((id) => {
      const g = byId.get(id);
      if (!g) {
        throw new Error(
          `Connections category references unknown golfer id: ${id}`,
        );
      }
      return { id, name: g.name };
    });

    return {
      dayNumber,
      items,
      categories: finalCategories,
    };
  }

  throw new Error(
    `Could not generate a Connections puzzle for day ${dayNumber} after 200 attempts`,
  );
}
