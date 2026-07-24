/**
 * Per-event bet impact — quantify how much each shot moved each of
 * the user's tracked bets, in £.
 *
 * Used by FeedClient to render "🚀 +£42 your outright" / "💀 −£18
 * your outright" chips on the events that actually matter. Only the
 * direct path uses precise data baked onto the event row by the
 * engine (oddsBefore/After, top10Before/After). Indirect impact
 * (competitor's shot moves your guy's prob) is estimated from the
 * leaderboard + market-redistribution maths.
 */

import type { FeedEvent, FeedRow } from "@/lib/feed/types";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import type { TrackedBet } from "./bet-shared";
import {
  formatBetCurrency,
  normaliseBetCurrency,
  type BetCurrency,
} from "@/lib/format/bet-currency";
import {
  projectShotOnHole,
  type PlayerSkill,
} from "@/lib/bet-model/shot-projection";
import {
  projectRoundTotal,
  roundScoreProb,
} from "@/lib/bet-model/bet-projection";

export interface EventBetImpact {
  /** Which bet this impact is for. Multiple bets can be impacted by
   *  one event; the caller picks the headline (biggest |deltaValue|). */
  bet: TrackedBet;
  /** Signed change in bet value, in £. Positive = bet is worth more
   *  after this event than before. */
  deltaValue: number;
  /** Signed change in win probability (0..1, percentage points). */
  deltaProb: number;
  /** Direct = event happened to the bet's player; indirect = event
   *  happened to a competitor whose result moved the bet's prob. */
  source: "direct" | "indirect";
  /** Win prob BEFORE this event (0..1). Set whenever we can compute
   *  it — outright + top-finish always have it via oddsBefore/topBefore
   *  fields on the event; round-score gets it via the pre-shot
   *  projection. Rendered as "12% → 18%" in the chip. */
  probBefore?: number;
  /** Win prob AFTER this event (0..1). See probBefore. */
  probAfter?: number;
  /** True when the prob move is BIG enough to warrant an emphasised
   *  chip treatment (bigger type, "!!"). Threshold: |Δp| ≥ 3pp OR
   *  |Δp/p_before| ≥ 30 %. */
  isBigMove?: boolean;
}

/** Big-move thresholds — a chip is "loud" when either absolute or
 *  relative movement crosses these. Tuned by feel; adjust if the
 *  chip fires too often or feels too muted. */
const BIG_ABS_PROB_DELTA = 0.03;
const BIG_REL_PROB_DELTA = 0.3;

function classifyBigMove(
  probBefore: number | undefined,
  probAfter: number | undefined,
): boolean {
  if (typeof probBefore !== "number" || typeof probAfter !== "number") return false;
  const abs = Math.abs(probAfter - probBefore);
  if (abs >= BIG_ABS_PROB_DELTA) return true;
  if (probBefore > 0 && abs / probBefore >= BIG_REL_PROB_DELTA) return true;
  return false;
}

/** Heuristic prob shift per stroke vs par on a round-score bet. A
 *  birdie ≈ 6pp swing in a typical round-score distribution. Tuned
 *  to feel right against the model's own pricing — refine later if
 *  it produces consistently off PnL figures. */
const STROKE_PROB_DELTA = 0.06;

/** Render threshold — chip only fires when |deltaValue| meets BOTH
 *  the absolute floor (£1) AND a relative floor (5% of stake). Stops
 *  noisy half-quid shifts from spamming every feed row. */
const MATERIAL_ABS_GBP = 1.0;
const MATERIAL_REL_OF_STAKE = 0.05;

export function isMaterialImpact(
  bet: TrackedBet,
  deltaValue: number,
): boolean {
  const abs = Math.abs(deltaValue);
  if (abs < MATERIAL_ABS_GBP) return false;
  if (abs < bet.stake * MATERIAL_REL_OF_STAKE) return false;
  return true;
}

function parseLbPos(s: string): number | null {
  if (!s) return null;
  const m = s.match(/^T?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Quick lookup: is `pid` currently inside the top-N of the
 *  leaderboard? Used to gate indirect-impact computations to events
 *  that come from real contenders rather than mid-pack noise. */
function topNIds(
  leaderboard: CachedLeaderboardRow[],
  n: number,
): Set<string> {
  const sorted = [...leaderboard].sort((a, b) => {
    const pa = parseLbPos(a.position) ?? 999;
    const pb = parseLbPos(b.position) ?? 999;
    return pa - pb;
  });
  return new Set(sorted.slice(0, n).map((r) => r.playerId));
}

function impactForOutright(
  event: FeedEvent,
  bet: TrackedBet & { kind: "outright" },
  currentOdds: Record<string, number>,
  leaderboardTop10: Set<string>,
): EventBetImpact | null {
  if (event.playerId === bet.playerId) {
    // Direct — the engine already attached precise before/after.
    if (
      typeof event.oddsBefore !== "number" ||
      typeof event.oddsAfter !== "number"
    ) {
      return null;
    }
    const probBefore = 1 / event.oddsBefore;
    const probAfter = 1 / event.oddsAfter;
    const deltaProb = probAfter - probBefore;
    const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
    return {
      bet,
      deltaProb,
      deltaValue,
      source: "direct",
      probBefore,
      probAfter,
      isBigMove: classifyBigMove(probBefore, probAfter),
    };
  }
  // Indirect — the event player is a top-10 competitor. Estimate the
  // bet player's shift via field-redistribution: when player A's prob
  // goes from p1 to p2, everyone else's collective prob goes from
  // (1−p1) to (1−p2). Your guy's share scales by (1−p2)/(1−p1), so:
  //   yourPreProb / yourPostProb = (1−p1)/(1−p2)
  //   Δprob ≈ yourPostProb × (1 − (1−p1)/(1−p2))
  if (!leaderboardTop10.has(event.playerId)) return null;
  if (
    typeof event.oddsBefore !== "number" ||
    typeof event.oddsAfter !== "number"
  ) {
    return null;
  }
  const yourCurrent = currentOdds[bet.playerId];
  if (!Number.isFinite(yourCurrent) || yourCurrent <= 1) return null;
  const yourPostProb = 1 / yourCurrent;
  const p1 = 1 / event.oddsBefore;
  const p2 = 1 / event.oddsAfter;
  if (p2 >= 0.999) return null; // event player effectively won
  const factor = (1 - p1) / (1 - p2);
  const yourPreProb = yourPostProb * factor;
  const deltaProb = yourPostProb - yourPreProb;
  const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
  return {
    bet,
    deltaProb,
    deltaValue,
    source: "indirect",
    probBefore: yourPreProb,
    probAfter: yourPostProb,
    isBigMove: classifyBigMove(yourPreProb, yourPostProb),
  };
}

function impactForTopFinish(
  event: FeedEvent,
  bet: TrackedBet & { kind: "top-finish" },
): EventBetImpact | null {
  // Only direct (event happened to the bet's player) and only
  // top-10 cutoff — the engine doesn't pre-compute top5/top20 deltas.
  if (event.playerId !== bet.playerId) return null;
  if (bet.cutoff !== 10) return null;
  if (
    typeof event.top10Before !== "number" ||
    typeof event.top10After !== "number"
  ) {
    return null;
  }
  const probBefore = event.top10Before;
  const probAfter = event.top10After;
  const deltaProb = probAfter - probBefore;
  const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
  return {
    bet,
    deltaProb,
    deltaValue,
    source: "direct",
    probBefore,
    probAfter,
    isBigMove: classifyBigMove(probBefore, probAfter),
  };
}

function impactForRoundScore(
  event: FeedEvent,
  bet: TrackedBet & { kind: "round-score" },
  playerSkill?: PlayerSkill,
  contextRows?: FeedRow[],
  holeAvgToPar?: Record<number, number>,
  roundPar?: number,
): EventBetImpact | null {
  // Round-score is direct-only by user instruction — a competitor's
  // shot doesn't affect your player's round total.
  if (event.playerId !== bet.playerId) return null;
  // Only score the event for the round this bet covers. Resolve the
  // bet's round from bet.round → placement.round; if neither is
  // set (very old legacy bet), don't apply impact at all rather
  // than letting events from any round bleed in.
  const targetRound = bet.round ?? bet.placement?.round ?? null;
  if (targetRound == null) return null;
  if (event.round !== targetRound) return null;

  // Preferred path: use the shot projection + all rows for this
  // (player, round) to compute a proper before/after win probability
  // against the bet's line. Falls back to par-anchored delta when
  // we don't have context rows.
  const canProject = event.type === "shot" && event.imgSourced && contextRows;
  if (canProject) {
    const proj = projectShotOnHole(event, playerSkill ?? {});
    if (!proj) return null;
    if (proj.isHoled) return null;
    // Two projections: one that INCLUDES this shot's expected vs-par
    // for the current hole, one that treats the hole as par-anchored
    // (as if the shot hadn't happened yet). The difference in resulting
    // round-total → the delta on win prob.
    const afterProjection = projectRoundTotal({
      rows: contextRows,
      playerId: bet.playerId,
      round: targetRound,
      skill: playerSkill,
      // Per-round par when we know it (baked into snap); default 72
      // for majors/legacy events without the map. Same for holeAvgToPar
      // — pass through when the caller supplied it so the impact chip
      // uses the same live-first fallback (current round ≥15 samples
      // → prev round → prev year → par) as the round-score bet detail
      // page + tee-time chart.
      roundPar: roundPar ?? 72,
      holeAvgToPar,
    });
    // The "before" total = after - shot's contribution to the hole.
    // Rebuilding a whole projection twice is expensive; short-circuit
    // by subtracting expectedVsPar from the after total.
    const beforeTotal =
      afterProjection.expectedRoundTotal - proj.expectedVsPar;
    const beforeProjection = {
      ...afterProjection,
      expectedRoundTotal: beforeTotal,
    };
    const probAfter = roundScoreProb({
      projection: afterProjection,
      line: bet.line,
      side: bet.side,
    });
    const probBefore = roundScoreProb({
      projection: beforeProjection,
      line: bet.line,
      side: bet.side,
    });
    const deltaProb = probAfter - probBefore;
    const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
    return {
      bet,
      deltaProb,
      deltaValue,
      source: "direct",
      probBefore,
      probAfter,
      isBigMove: classifyBigMove(probBefore, probAfter),
    };
  }

  // Fallback: score events — hole completed, use par-anchored delta.
  if (event.type === "score") {
    if (typeof event.strokes !== "number" || typeof event.par !== "number") {
      return null;
    }
    const diff = event.strokes - event.par;
    if (diff === 0) return null;
    const sideMult = bet.side === "under" ? 1 : -1;
    const deltaProb = -diff * sideMult * STROKE_PROB_DELTA;
    const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
    return { bet, deltaProb, deltaValue, source: "direct" };
  }

  // Fallback: shot events without context — use the shot's expectedVsPar
  // as a rough impact estimate (par-anchored calibration).
  if (event.type === "shot" && event.imgSourced) {
    const proj = projectShotOnHole(event, playerSkill ?? {});
    if (!proj || proj.isHoled) return null;
    if (Math.abs(proj.expectedVsPar) < 0.2) return null;
    const sideMult = bet.side === "under" ? 1 : -1;
    const deltaProb = -proj.expectedVsPar * sideMult * STROKE_PROB_DELTA;
    const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
    return { bet, deltaProb, deltaValue, source: "direct" };
  }

  return null;
}

/**
 * Compute the impact of a single feed event on a single tracked bet.
 * Returns null when there's nothing actionable (event isn't relevant
 * to the bet, or required data is missing). Caller is responsible for
 * filtering by `isMaterialImpact` and picking the headline bet when
 * multiple are impacted.
 */
export function computeBetImpact(
  event: FeedEvent,
  bet: TrackedBet,
  data: {
    currentOdds: Record<string, number>;
    leaderboard: CachedLeaderboardRow[];
    /** Optional player skill lookup (DG per-round SG). Used by the
     *  round-score shot-projection path so a McIlroy approach benefits
     *  from his sg_app numbers instead of tour-average defaults. */
    playerSkill?: Record<string, PlayerSkill>;
    /** Optional full row window for context — passed through to
     *  round-score projection so we get proper before/after prob
     *  computations. Absent means the round-score chip falls back
     *  to par-anchored delta only. */
    contextRows?: FeedRow[];
    /** Optional per-round per-hole expected score-to-par map. When
     *  provided, the round-score impact uses the SAME live-first
     *  fallback (current round ≥15 samples → prev round → prev year
     *  → par) as the round-score bet detail page + tee-time chart.
     *  Absent means the impact chip falls back to hardcoded par 4. */
    holeAvgToParByRound?: Record<number, Record<number, number>>;
    /** Optional per-round par lookup for the current tournament. When
     *  provided, we use it instead of the hardcoded 72 default. */
    roundParByRound?: Record<number, number>;
  },
): EventBetImpact | null {
  if (bet.kind === "outright") {
    return impactForOutright(
      event,
      bet,
      data.currentOdds,
      topNIds(data.leaderboard, 10),
    );
  }
  if (bet.kind === "top-finish") {
    return impactForTopFinish(event, bet);
  }
  if (bet.kind === "round-score") {
    const skill = data.playerSkill?.[bet.playerId];
    const targetRound = bet.round ?? bet.placement?.round ?? null;
    const holeAvgToPar =
      targetRound != null
        ? data.holeAvgToParByRound?.[targetRound]
        : undefined;
    const roundPar =
      targetRound != null ? data.roundParByRound?.[targetRound] : undefined;
    return impactForRoundScore(
      event,
      bet,
      skill,
      data.contextRows,
      holeAvgToPar,
      roundPar,
    );
  }
  // winning-score: skip for v1. A single event rarely has a clean
  // attributable impact on the full-field distribution, and the
  // calculations would compound estimate-on-estimate.
  return null;
}

/**
 * For one event, find the most-impactful bet across all of the
 * user's tracked bets. Returns null when nothing material happened.
 */
/** Minimum prob move (in raw prob units, 0..1) that qualifies an
 *  impact for chip display when we have prob-based data. 1 pp is the
 *  floor — anything less is imperceptible; the £-based gate takes
 *  over for events without direct probability data. */
const MATERIAL_ABS_PROB_DELTA = 0.01;

export function headlineImpactForEvent(
  event: FeedEvent,
  bets: TrackedBet[],
  data: {
    currentOdds: Record<string, number>;
    leaderboard: CachedLeaderboardRow[];
    playerSkill?: Record<string, PlayerSkill>;
    contextRows?: FeedRow[];
    /** Per-round per-hole expected score-to-par (from feed snap).
     *  When provided, round-score impact chips use the same live-first
     *  fallback (current round ≥15 samples → prev round → prev year →
     *  par) as the bet detail page + tee-time chart. */
    holeAvgToParByRound?: Record<number, Record<number, number>>;
    /** Per-round par lookup for the current tournament (from feed
     *  snap). When present, replaces the hardcoded 72 default. */
    roundParByRound?: Record<number, number>;
  },
): EventBetImpact | null {
  let best: EventBetImpact | null = null;
  for (const bet of bets) {
    // Skip settled bets — they no longer move with the leaderboard,
    // and surfacing "+$600 on your bet" for a settled R1 round-score
    // when the player birdies R2 was both wrong and confusing.
    if (bet.settledAt != null) continue;
    const imp = computeBetImpact(event, bet, data);
    if (!imp) continue;
    // Prob-based materiality when we have before/after. Falls back
    // to the £-based gate for impacts without probability data.
    if (
      typeof imp.probBefore === "number" &&
      typeof imp.probAfter === "number"
    ) {
      if (Math.abs(imp.probAfter - imp.probBefore) < MATERIAL_ABS_PROB_DELTA) {
        continue;
      }
    } else if (!isMaterialImpact(bet, imp.deltaValue)) {
      continue;
    }
    if (!best || Math.abs(imp.deltaValue) > Math.abs(best.deltaValue)) {
      best = imp;
    }
  }
  return best;
}

/** Currency-aware compact impact formatter for feed-row chips.
 *  Was GBP-hardcoded; now reads currency off the bet carrying
 *  the impact and falls back to GBP for legacy bets without the
 *  field. Uses no decimals at ≥10 units to keep chip width
 *  manageable on mobile. Minus uses U+2212 (true minus) for
 *  visual balance against +. */
export function formatImpactCurrency(
  deltaValue: number,
  currency?: BetCurrency,
): string {
  const cur = normaliseBetCurrency(currency);
  const abs = Math.abs(deltaValue);
  const sign = deltaValue >= 0 ? "+" : "−";
  const unsigned = formatBetCurrency(abs, cur, {
    maximumFractionDigits: abs >= 10 ? 0 : abs < 1 ? 2 : 1,
    minimumFractionDigits: 0,
  });
  return `${sign}${unsigned}`;
}

/** @deprecated kept for any straggling callers; prefer
 *  formatImpactCurrency(amount, bet.currency). */
export function formatImpactGbp(deltaValue: number): string {
  return formatImpactCurrency(deltaValue, "GBP");
}

/** Short label for the bet kind, used inline on the impact chip. */
export function betKindShortLabel(bet: TrackedBet): string {
  if (bet.kind === "outright") return "outright";
  if (bet.kind === "top-finish") return `Top ${bet.cutoff}`;
  if (bet.kind === "round-score") return "round bet";
  return "bet";
}
