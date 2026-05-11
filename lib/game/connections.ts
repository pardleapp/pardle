/**
 * Pardle: Connections — golf edition.
 *
 * 16 golfers per puzzle, hidden in 4 categories of 4 each. The
 * categories are auto-generated from the GOLFERS dataset attributes
 * (country, majors, age, Ryder Cup, PGA wins) so we get an endless
 * supply of daily puzzles with zero hand-curation.
 *
 * Each puzzle has one category per difficulty tier — yellow (easy)
 * through purple (tricky) — mirroring NYT Connections' colour
 * convention so the visual cue is familiar.
 *
 * Generation is deterministic per day: same day = same puzzle for
 * every player worldwide.
 */

import type { Golfer } from "./types";
import { GOLFERS } from "@/lib/data/golfers";

export type ConnectionsDifficulty = "yellow" | "green" | "blue" | "purple";
export const DIFFICULTY_ORDER: ConnectionsDifficulty[] = [
  "yellow",
  "green",
  "blue",
  "purple",
];

export interface ConnectionsCategory {
  label: string;
  difficulty: ConnectionsDifficulty;
  /** golfer ids in this group */
  memberIds: string[];
}

export interface ConnectionsItem {
  id: string;
  name: string;
}

export interface ConnectionsPuzzle {
  dayNumber: number;
  items: ConnectionsItem[]; // 16, shuffled
  categories: ConnectionsCategory[]; // 4, ordered yellow → purple
}

interface CandidateGroup {
  difficulty: ConnectionsDifficulty;
  label: string;
  memberIds: string[];
}

// Mulberry32 — small, fast, deterministic PRNG. We seed it from the
// day index so today's puzzle is identical for everyone, every device.
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

function buildCandidates(): CandidateGroup[] {
  const out: CandidateGroup[] = [];

  // YELLOW (easy) — same country. Most universally recognisable signal.
  const byCountry = new Map<string, Golfer[]>();
  for (const g of GOLFERS) {
    const arr = byCountry.get(g.country) || [];
    arr.push(g);
    byCountry.set(g.country, arr);
  }
  for (const [country, golfers] of byCountry) {
    if (golfers.length >= 4) {
      out.push({
        difficulty: "yellow",
        label: `${country}`,
        memberIds: golfers.map((g) => g.id),
      });
    }
  }

  // GREEN (medium) — majors band. Top players' major counts are
  // well-known; rookies and unproven pros sit in the 0-major bucket.
  const noMajors = GOLFERS.filter((g) => g.majors === 0).map((g) => g.id);
  const oneMajor = GOLFERS.filter((g) => g.majors === 1).map((g) => g.id);
  const twoOrThree = GOLFERS.filter((g) => g.majors >= 2 && g.majors <= 3).map(
    (g) => g.id,
  );
  const fourPlus = GOLFERS.filter((g) => g.majors >= 4).map((g) => g.id);
  if (noMajors.length >= 4) {
    out.push({
      difficulty: "green",
      label: "Yet to win a major",
      memberIds: noMajors,
    });
  }
  if (oneMajor.length >= 4) {
    out.push({
      difficulty: "green",
      label: "One major win",
      memberIds: oneMajor,
    });
  }
  if (twoOrThree.length >= 4) {
    out.push({
      difficulty: "green",
      label: "Two or three majors",
      memberIds: twoOrThree,
    });
  }
  if (fourPlus.length >= 4) {
    out.push({
      difficulty: "green",
      label: "Four or more majors",
      memberIds: fourPlus,
    });
  }

  // BLUE (hard) — age decade. Requires knowing how old each pro is.
  const ages: { label: string; min: number; max: number }[] = [
    { label: "In their 20s", min: 20, max: 29 },
    { label: "In their 30s", min: 30, max: 39 },
    { label: "In their 40s", min: 40, max: 49 },
    { label: "50 and over", min: 50, max: 200 },
  ];
  for (const { label, min, max } of ages) {
    const ids = GOLFERS.filter((g) => g.age >= min && g.age <= max).map(
      (g) => g.id,
    );
    if (ids.length >= 4) {
      out.push({ difficulty: "blue", label, memberIds: ids });
    }
  }

  // PURPLE (very hard) — niche / surprising categories. Players often
  // don't realise who's a Ryder Cup veteran vs a rookie, or that some
  // top names are continentally ineligible for the Cup at all.
  const ryderVets = GOLFERS.filter(
    (g) => g.ryderCup !== null && g.ryderCup >= 5,
  ).map((g) => g.id);
  if (ryderVets.length >= 4) {
    out.push({
      difficulty: "purple",
      label: "Five-plus Ryder Cups",
      memberIds: ryderVets,
    });
  }
  const ryderRookies = GOLFERS.filter(
    (g) => g.ryderCup !== null && g.ryderCup >= 1 && g.ryderCup <= 2,
  ).map((g) => g.id);
  if (ryderRookies.length >= 4) {
    out.push({
      difficulty: "purple",
      label: "One or two Ryder Cup appearances",
      memberIds: ryderRookies,
    });
  }
  const ryderIneligible = GOLFERS.filter((g) => g.ryderCup === null).map(
    (g) => g.id,
  );
  if (ryderIneligible.length >= 4) {
    out.push({
      difficulty: "purple",
      label: "Ineligible for the Ryder Cup",
      memberIds: ryderIneligible,
    });
  }
  const tourLegends = GOLFERS.filter((g) => g.pgaTourWins >= 20).map(
    (g) => g.id,
  );
  if (tourLegends.length >= 4) {
    out.push({
      difficulty: "purple",
      label: "Twenty-plus PGA Tour wins",
      memberIds: tourLegends,
    });
  }

  return out;
}

export function generatePuzzle(dayNumber: number): ConnectionsPuzzle {
  const candidates = buildCandidates();
  const byDifficulty: Record<ConnectionsDifficulty, CandidateGroup[]> = {
    yellow: [],
    green: [],
    blue: [],
    purple: [],
  };
  for (const c of candidates) byDifficulty[c.difficulty].push(c);

  // Try up to N seed offsets — if the first picked categories leave no
  // valid combination of 4 in a downstream difficulty (because the
  // golfer pool was exhausted), reshuffle and try again.
  for (let attempt = 0; attempt < 30; attempt++) {
    const rand = seededRandom(dayNumber * 1009 + attempt);
    const used = new Set<string>();
    const chosen: ConnectionsCategory[] = [];

    for (const diff of DIFFICULTY_ORDER) {
      const shuffled = shuffle(byDifficulty[diff], rand);
      let picked: ConnectionsCategory | null = null;
      for (const candidate of shuffled) {
        const available = candidate.memberIds.filter((id) => !used.has(id));
        if (available.length >= 4) {
          const members = shuffle(available, rand).slice(0, 4);
          picked = {
            difficulty: diff,
            label: candidate.label,
            memberIds: members,
          };
          for (const id of members) used.add(id);
          break;
        }
      }
      if (!picked) break;
      chosen.push(picked);
    }

    if (chosen.length === 4) {
      const byId = new Map(GOLFERS.map((g) => [g.id, g] as const));
      const allIds = chosen.flatMap((c) => c.memberIds);
      const items = shuffle(allIds, rand).map((id) => {
        const g = byId.get(id);
        if (!g) throw new Error(`Unknown golfer id: ${id}`);
        return { id, name: g.name };
      });
      return { dayNumber, items, categories: chosen };
    }
  }

  throw new Error(
    `Could not generate a Connections puzzle for day ${dayNumber}`,
  );
}
