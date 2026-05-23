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

import type { FeedEvent } from "@/lib/feed/types";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import type { TrackedBet } from "./bet-shared";

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
    return { bet, deltaProb, deltaValue, source: "direct" };
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
  return { bet, deltaProb, deltaValue, source: "indirect" };
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
  const deltaProb = event.top10After - event.top10Before;
  const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
  return { bet, deltaProb, deltaValue, source: "direct" };
}

function impactForRoundScore(
  event: FeedEvent,
  bet: TrackedBet & { kind: "round-score" },
): EventBetImpact | null {
  // Round-score is direct-only by user instruction — a competitor's
  // shot doesn't affect your player's round total.
  if (event.playerId !== bet.playerId) return null;
  // Only completed-hole events have a strokes-vs-par delta we can
  // act on. Position / milestone / putt-poll events don't.
  if (event.type !== "score") return null;
  if (typeof event.strokes !== "number" || typeof event.par !== "number") {
    return null;
  }
  // Only score the event for the round this bet covers. A birdie in
  // R2 doesn't matter for an R3 bet.
  if (bet.round != null && event.round !== bet.round) return null;
  const diff = event.strokes - event.par;
  if (diff === 0) return null; // routine par — no swing
  const sideMult = bet.side === "under" ? 1 : -1;
  const deltaProb = -diff * sideMult * STROKE_PROB_DELTA;
  const deltaValue = bet.stake * bet.oddsTaken * deltaProb;
  return { bet, deltaProb, deltaValue, source: "direct" };
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
    return impactForRoundScore(event, bet);
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
export function headlineImpactForEvent(
  event: FeedEvent,
  bets: TrackedBet[],
  data: {
    currentOdds: Record<string, number>;
    leaderboard: CachedLeaderboardRow[];
  },
): EventBetImpact | null {
  let best: EventBetImpact | null = null;
  for (const bet of bets) {
    const imp = computeBetImpact(event, bet, data);
    if (!imp) continue;
    if (!isMaterialImpact(bet, imp.deltaValue)) continue;
    if (!best || Math.abs(imp.deltaValue) > Math.abs(best.deltaValue)) {
      best = imp;
    }
  }
  return best;
}

/** Pretty-print the £ figure with sign — e.g. "+£42" / "−£18". The
 *  minus uses U+2212 (true minus) for visual balance against +. */
export function formatImpactGbp(deltaValue: number): string {
  const sign = deltaValue >= 0 ? "+" : "−";
  const abs = Math.abs(deltaValue);
  if (abs >= 100) return `${sign}£${Math.round(abs)}`;
  if (abs >= 10) return `${sign}£${abs.toFixed(0)}`;
  return `${sign}£${abs.toFixed(abs < 1 ? 2 : 1)}`;
}

/** Short label for the bet kind, used inline on the impact chip. */
export function betKindShortLabel(bet: TrackedBet): string {
  if (bet.kind === "outright") return "outright";
  if (bet.kind === "top-finish") return `Top ${bet.cutoff}`;
  if (bet.kind === "round-score") return "round bet";
  return "bet";
}
