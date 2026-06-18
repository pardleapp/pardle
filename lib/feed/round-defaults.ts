/**
 * Per-tournament pre-data defaults for the round-score model.
 *
 * On R1 morning (and any other moment when fewer than MIN_SAMPLE
 * players have completed a hole AND no prior round of the same hole
 * has enough samples to fall back to) the field-mean falls back to
 * "0 over par" — i.e. par-anchored. For PGA Tour events that's
 * usually a reasonable starting point, but for major championships
 * (US Open, Masters, The Open, PGA Championship) it badly
 * underestimates scoring: U.S. Open setups routinely play to ~+5
 * over par for the field average.
 *
 * This module returns the default per-hole "over par" the model
 * should use as the field mean before live data takes over. We pick
 * by name match (the orchestrator's tournament_name is stable for
 * majors) and fall back to a small positive number for the typical
 * weekly event. The DataGolf-skill prior (skillPerHole) still
 * subtracts off the field default, so a +3 SG player on a +5 field
 * default projects 18×(par + 5/18 − 3/18) = course par + 2 — which
 * is the "Scheffler 3 better than field" intuition the product owner
 * asked for.
 *
 * Server-only — used by /api/feed and /api/bet/scorecard's hole-
 * stat fallback. Tunable here without redeploying the model code.
 */

import "server-only";

/** "Field's expected total vs par for one round." Positive = harder
 *  than par (defense / firm / windy / rough), negative = scorable. */
const DEFAULT_FIELD_OVER_PAR = 1; // typical PGA Tour event

/** Name-substring → field over-par override. Substring match keeps
 *  this robust to the orchestrator's sponsor-suffix variations
 *  ("the Memorial Tournament presented by Workday" still matches
 *  "Memorial"). Case-insensitive. */
const TOURNAMENT_OVERRIDES: Array<{ match: string; overPar: number }> = [
  // Majors — typically firm + tucked pins + rough; field plays
  // meaningfully over par.
  { match: "U.S. Open", overPar: 5 },
  { match: "US Open", overPar: 5 },
  { match: "The Open Championship", overPar: 3 },
  { match: "Open Championship", overPar: 3 },
  { match: "Masters Tournament", overPar: 2 },
  { match: "PGA Championship", overPar: 3 },
  // Designated events known to play tough (defense, narrow fairways)
  // — bump modestly above the typical-event default.
  { match: "Memorial", overPar: 2 },
  { match: "Players Championship", overPar: 1 },
];

export function fieldOverParForTournament(name: string | null | undefined): number {
  if (!name) return DEFAULT_FIELD_OVER_PAR;
  const lower = name.toLowerCase();
  for (const o of TOURNAMENT_OVERRIDES) {
    if (lower.includes(o.match.toLowerCase())) return o.overPar;
  }
  return DEFAULT_FIELD_OVER_PAR;
}

/** Per-hole mean used as the round-score model fallback when the
 *  current round has no field data yet and no prior round has the
 *  hole well-sampled either. Distributes the per-round over-par
 *  uniformly across 18 holes — first cut. Per-hole difficulty
 *  (par-3 island green vs reachable par-5) is a follow-up if we
 *  ever care to model it. */
export function fallbackHoleMean(tournamentName: string | null | undefined): number {
  return fieldOverParForTournament(tournamentName) / 18;
}
