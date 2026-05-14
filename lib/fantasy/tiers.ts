/**
 * Tier assignment — splits a ranked field into A/B/C/D buckets.
 *
 * Tier bounds come from TIER_RANK_BOUNDS in types.ts:
 *   A = field rank 1–10
 *   B = 11–30
 *   C = 31–60
 *   D = 61+
 *
 * Pure functions — safe to use on client or server.
 */

import {
  type RankedGolfer,
} from "@/lib/golf-api/datagolf";
import { type Tier, TIER_RANK_BOUNDS } from "./types";

export interface TieredGolfer extends RankedGolfer {
  tier: Tier;
}

export function tierForRank(rank: number): Tier {
  for (const tier of ["A", "B", "C", "D"] as Tier[]) {
    const [lo, hi] = TIER_RANK_BOUNDS[tier];
    if (rank >= lo && rank <= hi) return tier;
  }
  return "D";
}

/** Annotate a ranked field with tier labels. */
export function assignTiers(field: RankedGolfer[]): TieredGolfer[] {
  return field.map((g) => ({ ...g, tier: tierForRank(g.fieldRank) }));
}

/** Group a tiered field into { A: [...], B: [...], C: [...], D: [...] }. */
export function groupByTier(
  field: TieredGolfer[],
): Record<Tier, TieredGolfer[]> {
  const out: Record<Tier, TieredGolfer[]> = { A: [], B: [], C: [], D: [] };
  for (const g of field) out[g.tier].push(g);
  return out;
}
