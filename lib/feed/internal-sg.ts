/**
 * Internal "Pardle SG" estimator — strokes gained vs the current
 * tournament field, computed per hole the player has completed.
 *
 * This is NOT Mark Broadie's per-shot SG (which decomposes into
 * OTT / APP / ARG / PUTT using lie + distance baselines). It's the
 * simplest useful proxy that uses data we already have in hand:
 *
 *   field_expected(round, hole) = par + field_mean(round, hole)
 *   sg(player, round, hole)     = field_expected − player_score
 *
 * Where `field_mean` is the field-wide average (strokes − par) on
 * that hole today, already computed by `computeFieldStats` for the
 * round-score bet model.
 *
 * Sign convention: positive = better than field, matching the
 * standard SG convention.
 *
 * Compared to DataGolf's in-tournament SG, this number updates as
 * fast as the orchestrator polls (~60 s) instead of DataGolf's
 * ~2 min lag plus our 5 min cache. It IS "vs this field" not "vs
 * Tour average" though, so absolute magnitudes won't match — use
 * it as a freshness check, not yet as a wholesale replacement.
 *
 * Server-only.
 */
import "server-only";
import type { FieldHoleStats, PollSnapshot, TournamentPars } from "./store";

const MIN_FIELD_SAMPLE = 6;

export interface InternalSgRound {
  round: number;
  holesPlayed: number;
  sgTotal: number;
  perHole: Record<number, number>;
}

export interface InternalSgPlayer {
  playerId: string;
  rounds: InternalSgRound[];
  /** Sum across every hole the player has completed this tournament. */
  sgTotal: number;
  holesPlayed: number;
  /** Average SG per hole — handy for normalising R1-only vs full-tournament comparisons. */
  sgPerHole: number;
}

export function computeInternalSg(
  snapshot: PollSnapshot | null,
  pars: TournamentPars,
  fieldStats: FieldHoleStats,
  playerId: string,
): InternalSgPlayer | null {
  if (!snapshot) return null;
  const holes = snapshot.holes[playerId];
  if (!holes) return null;
  const rounds: InternalSgRound[] = [];
  let tournamentSg = 0;
  let tournamentHoles = 0;
  for (const [roundStr, byHole] of Object.entries(holes)) {
    const round = Number(roundStr);
    const parsForRound = pars[round] ?? {};
    const statsForRound = fieldStats[round] ?? {};
    const perHole: Record<number, number> = {};
    let sgSum = 0;
    let holesPlayed = 0;
    for (const [holeStr, scoreStr] of Object.entries(byHole)) {
      const hole = Number(holeStr);
      const score = Number(scoreStr);
      const par = parsForRound[hole];
      const stat = statsForRound[hole];
      if (!Number.isFinite(score) || score <= 0) continue;
      // Need enough completions on the hole to trust the field baseline.
      // Small samples (1–5 players) bake in too much noise.
      if (par == null || !stat || stat.count < MIN_FIELD_SAMPLE) continue;
      const sg = par + stat.mean - score;
      perHole[hole] = sg;
      sgSum += sg;
      holesPlayed++;
    }
    if (holesPlayed > 0) {
      rounds.push({ round, holesPlayed, sgTotal: sgSum, perHole });
      tournamentSg += sgSum;
      tournamentHoles += holesPlayed;
    }
  }
  rounds.sort((a, b) => a.round - b.round);
  return {
    playerId,
    rounds,
    sgTotal: tournamentSg,
    holesPlayed: tournamentHoles,
    sgPerHole: tournamentHoles > 0 ? tournamentSg / tournamentHoles : 0,
  };
}

/**
 * Field rank of a player's total internal SG within everyone who's
 * completed at least `minHoles` holes — gives the headline a "3rd of
 * 72" sibling to the DataGolf rank.
 */
export function rankInternalSg(
  snapshot: PollSnapshot | null,
  pars: TournamentPars,
  fieldStats: FieldHoleStats,
  playerId: string,
  minHoles = 9,
): { rank: number; outOf: number } | null {
  if (!snapshot) return null;
  const me = computeInternalSg(snapshot, pars, fieldStats, playerId);
  if (!me || me.holesPlayed < minHoles) return null;
  let better = 0;
  let outOf = 0;
  for (const pid of Object.keys(snapshot.holes)) {
    if (pid === playerId) continue;
    const other = computeInternalSg(snapshot, pars, fieldStats, pid);
    if (!other || other.holesPlayed < minHoles) continue;
    outOf++;
    if (other.sgTotal > me.sgTotal) better++;
  }
  if (outOf === 0) return null;
  return { rank: better + 1, outOf: outOf + 1 };
}
