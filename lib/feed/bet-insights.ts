/**
 * "What needs to happen" insight engine — given a live (unsettled)
 * bet, return one or two short, plain-English sentences telling the
 * user exactly what would flip it from losing to winning right now.
 *
 *   Outright:    "Fleetwood needs to gain 3 shots in his remaining 6 holes —
 *                 roughly two birdies vs the leader"
 *   Top-finish:  "1 stroke off Top 5 — needs a single birdie in the next 8 holes"
 *   Round-score: "Already on track — par the last 6 holes to be under 67.5"
 *   Winning-sc:  "Leader on pace for 268 — needs to drop 3+ strokes for over 270.5 to win"
 *
 * Pure function: takes the same live-feed data BetDetail already has
 * on hand. No I/O.
 */

import type {
  TrackedBet,
  OutrightBet,
  RoundScoreBet,
  TopFinishBet,
  WinningScoreBet,
  PlayerRoundState,
  TournamentProjection,
} from "../../app/live/bet-shared";

export interface BetInsight {
  /** Headline sentence: what needs to happen for the bet to land. */
  headline: string;
  /** Optional secondary line: where to look / how plausible. */
  hint?: string;
  /** Optional broad-stroke status — used to colour the card. */
  status: "favourable" | "needs-work" | "long-shot" | "settled" | "neutral";
}

interface LeaderboardLite {
  playerId: string;
  displayName: string;
  position: string;
  /** "+3", "-1", "E", "—", or "". */
  total: string;
  thru: string;
  playerState?: string;
}

/**
 * Tournament-to-date strokes-gained breakdown for one player.
 * Values are per-round averages vs the field (positive = better).
 * Any sub-component may be null if DataGolf hasn't reported it yet
 * (first holes of R1 are typically null).
 */
export interface SgBreakdown {
  total: number | null;
  /** Off the tee. */
  ott: number | null;
  /** Approach. */
  app: number | null;
  /** Around the green. */
  arg: number | null;
  putt: number | null;
}

interface InsightInputs {
  bet: TrackedBet;
  leaderboard: LeaderboardLite[];
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
  /** Per-player tournament-to-date SG breakdown, keyed by playerId.
   *  Optional: when absent the insight falls back to a non-SG hint. */
  playerSgBreakdown?: Record<string, SgBreakdown>;
}

// ── helpers ────────────────────────────────────────────────────────

function parseToPar(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === "" || t === "—" || t === "-") return null;
  if (t.toUpperCase() === "E") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parsePosition(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /^T?(\d+)$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function plural(n: number, single: string, multi?: string): string {
  return `${n} ${n === 1 ? single : multi ?? `${single}s`}`;
}

/** Attributive form: "4-stroke cushion" rather than "4 strokes cushion".
 *  Used when the count + unit modify a following noun. */
function adjectival(n: number, single: string): string {
  return `${n}-${single}`;
}

function holesRemainingTotal(state: PlayerRoundState | undefined): number {
  if (!state) return 0;
  // Current round's remaining + 18 per round not yet played.
  const roundsLeft = Math.max(0, 4 - state.currentRound);
  return state.holesRemaining + roundsLeft * 18;
}

const SG_CATEGORIES: Array<{
  key: "ott" | "app" | "arg" | "putt";
  /** Natural-language fragment for "...on the greens", "...off the tee", etc. */
  phrase: string;
  /** Short label used standalone ("Approach", "Putting"). */
  label: string;
}> = [
  { key: "ott", phrase: "off the tee", label: "Driving" },
  { key: "app", phrase: "on approach", label: "Approach" },
  { key: "arg", phrase: "around the green", label: "Short game" },
  { key: "putt", phrase: "on the greens", label: "Putting" },
];

function formatSg(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r >= 0 ? "+" : ""}${r.toFixed(1)}`;
}

/**
 * Pick the SG category that explains the deficit best:
 *   1. The category where the rival has the biggest edge over the bet
 *      player (positive gap). If we can identify one, frame it as
 *      "where the shots have leaked".
 *   2. Fall back to the bet player's worst category (most negative SG)
 *      — frame as "where they're losing strokes to the field".
 *
 * Returns null when no SG data is available either side.
 */
function sgLeakHint(
  me: SgBreakdown | undefined,
  rival: SgBreakdown | undefined,
  meName: string,
  rivalName: string | null,
): string | undefined {
  if (!me) return undefined;
  // Try gap-vs-rival first when we have both sides.
  if (rival && rivalName) {
    let bestGap = -Infinity;
    let bestCat: (typeof SG_CATEGORIES)[number] | null = null;
    let bestMe = 0;
    let bestRival = 0;
    for (const c of SG_CATEGORIES) {
      const mv = me[c.key];
      const rv = rival[c.key];
      if (mv == null || rv == null) continue;
      const gap = rv - mv;
      if (gap > bestGap) {
        bestGap = gap;
        bestCat = c;
        bestMe = mv;
        bestRival = rv;
      }
    }
    // Only surface if the gap is meaningful (>0.4 SG/round) — otherwise
    // a near-zero gap reads as forced narrative.
    if (bestCat && bestGap >= 0.4) {
      return `${rivalName} ${formatSg(bestRival)} SG ${bestCat.phrase} this week vs ${meName} ${formatSg(bestMe)} — biggest gap to close`;
    }
  }
  // Fall back to me's worst category (most negative SG).
  let worstVal = Infinity;
  let worstCat: (typeof SG_CATEGORIES)[number] | null = null;
  for (const c of SG_CATEGORIES) {
    const mv = me[c.key];
    if (mv == null) continue;
    if (mv < worstVal) {
      worstVal = mv;
      worstCat = c;
    }
  }
  if (worstCat && worstVal < -0.2) {
    return `${worstCat.label} has been the leak (${formatSg(worstVal)} SG/round this week)`;
  }
  return undefined;
}

/**
 * Identify the bet player's *best* SG category — used for "this is
 * the engine" hints when they're already favoured (leading / inside
 * the cut with cushion).
 */
function sgEngineHint(me: SgBreakdown | undefined): string | undefined {
  if (!me) return undefined;
  let bestVal = -Infinity;
  let bestCat: (typeof SG_CATEGORIES)[number] | null = null;
  for (const c of SG_CATEGORIES) {
    const mv = me[c.key];
    if (mv == null) continue;
    if (mv > bestVal) {
      bestVal = mv;
      bestCat = c;
    }
  }
  if (bestCat && bestVal >= 0.5) {
    return `${bestCat.label} ${formatSg(bestVal)} SG/round has been the engine this week`;
  }
  return undefined;
}

// ── per-kind insight composers ────────────────────────────────────

function outrightInsight(
  bet: OutrightBet,
  args: InsightInputs,
): BetInsight | null {
  const me = args.leaderboard.find((r) => r.playerId === bet.playerId);
  if (!me) return null;
  const myToPar = parseToPar(me.total);
  const myPos = parsePosition(me.position);
  if (myToPar === null) return null;

  // "Gap" should always be measured against the strongest *competitor*,
  // never against the bet's own player — otherwise a solo leader's
  // bet card reads "leading by 0" because the position-1 lookup
  // returned themselves. Take the best to-par among everyone else.
  let rival: LeaderboardLite | null = null;
  let bestRivalToPar: number | null = null;
  for (const row of args.leaderboard) {
    if (row.playerId === bet.playerId) continue;
    const tp = parseToPar(row.total);
    if (tp === null) continue;
    if (bestRivalToPar === null || tp < bestRivalToPar) {
      bestRivalToPar = tp;
      rival = row;
    }
  }
  if (bestRivalToPar === null || !rival) return null;

  const remaining = holesRemainingTotal(
    args.playerRoundStates[bet.playerId],
  );
  const playerName = me.displayName;
  const rivalName = rival.displayName;
  const meSg = args.playerSgBreakdown?.[bet.playerId];
  const rivalSg = args.playerSgBreakdown?.[rival.playerId];

  // Negative = bet player is ahead of the field; positive = behind.
  const deficit = myToPar - bestRivalToPar;

  // Tournament's over for this player.
  if (remaining === 0) {
    if (deficit < 0 || (deficit === 0 && myPos === 1)) {
      return {
        headline: `${playerName} won. Bet's settled.`,
        status: "settled",
      };
    }
    return {
      headline: `${playerName} finished ${deficit} stroke${deficit === 1 ? "" : "s"} back. Out of reach.`,
      status: "long-shot",
    };
  }

  // Leading the field outright.
  if (deficit < 0) {
    const lead = Math.abs(deficit);
    return {
      headline: `${playerName} leading by ${plural(lead, "stroke")} with ${plural(remaining, "hole")} to play`,
      hint:
        sgEngineHint(meSg) ??
        (lead >= 3
          ? `${rivalName} the closest threat, ${plural(lead, "stroke")} back`
          : `${rivalName} ${plural(lead, "stroke")} back and closing`),
      status: "favourable",
    };
  }

  // Tied with the closest rival.
  if (deficit === 0) {
    return {
      headline: `${playerName} tied with ${rivalName} for the lead, ${plural(remaining, "hole")} to play`,
      hint: sgEngineHint(meSg),
      status: "favourable",
    };
  }

  // Behind — needs to make up ground. Frame as "play these N holes
  // X shots better than [rival]" — that's the actual ask.
  const gap = deficit;
  const realisticBirdies = Math.min(remaining, 8);
  const longShot = gap > Math.floor(realisticBirdies / 2);

  let headline: string;
  if (gap === 1) {
    headline = `${playerName} 1 stroke back — needs to play these ${plural(remaining, "hole")} one shot better than ${rivalName}`;
  } else if (gap <= 3) {
    headline = `${playerName} ${gap} strokes back — needs to outscore ${rivalName} by ${gap} over the last ${plural(remaining, "hole")}`;
  } else {
    headline = `${playerName} ${gap} back with ${plural(remaining, "hole")} left — needs a real charge to catch ${rivalName}`;
  }
  return {
    headline,
    hint: sgLeakHint(meSg, rivalSg, playerName, rivalName),
    status: longShot ? "long-shot" : "needs-work",
  };
}

function topFinishInsight(
  bet: TopFinishBet,
  args: InsightInputs,
): BetInsight | null {
  const me = args.leaderboard.find((r) => r.playerId === bet.playerId);
  if (!me) return null;
  const myPos = parsePosition(me.position);
  const myToPar = parseToPar(me.total);
  if (myPos === null || myToPar === null) return null;

  const cutoff = bet.cutoff;
  const playerName = me.displayName;
  const remaining = holesRemainingTotal(
    args.playerRoundStates[bet.playerId],
  );
  const meSg = args.playerSgBreakdown?.[bet.playerId];

  // Already inside the cut — comfort or coast message.
  if (myPos <= cutoff) {
    if (remaining === 0) {
      return {
        headline: `${playerName} finished ${me.position}. Bet wins.`,
        status: "settled",
      };
    }
    // How much room is there? Find the first player outside top-N.
    const bubble = args.leaderboard.find((r) => {
      const p = parsePosition(r.position);
      return p === cutoff + 1 || (p ?? 99) > cutoff;
    });
    const bubbleToPar = bubble ? parseToPar(bubble.total) : null;
    const bubbleSg = bubble
      ? args.playerSgBreakdown?.[bubble.playerId]
      : undefined;
    const cushion = bubbleToPar !== null ? bubbleToPar - myToPar : null;
    if (cushion !== null && cushion >= 0) {
      const engine = sgEngineHint(meSg);
      return {
        headline: `${playerName} ${me.position} with a ${adjectival(cushion, "stroke")} cushion over the cut line, ${plural(remaining, "hole")} left`,
        hint:
          engine ??
          (bubble
            ? `${bubble.displayName} the closest threat from outside Top ${cutoff}`
            : undefined),
        status: cushion >= 2 ? "favourable" : "needs-work",
      };
    }
    return {
      headline: `${playerName} ${me.position} (inside Top ${cutoff}), ${plural(remaining, "hole")} left to defend`,
      hint: sgEngineHint(meSg),
      status: "favourable",
    };
    void bubbleSg;
  }

  // Outside the cut — need to climb. Find the worst player still
  // inside the cut (highest to-par) — that's who they need to leapfrog.
  const lastInside = args.leaderboard
    .filter((r) => {
      const p = parsePosition(r.position);
      return p !== null && p <= cutoff;
    })
    .sort((a, b) => {
      const aP = parseToPar(a.total) ?? 99;
      const bP = parseToPar(b.total) ?? 99;
      return aP - bP;
    })
    .at(-1);
  const cutoffToPar = lastInside ? parseToPar(lastInside.total) : null;
  const cutoffSg = lastInside
    ? args.playerSgBreakdown?.[lastInside.playerId]
    : undefined;
  if (cutoffToPar === null) {
    return {
      headline: `${playerName} ${me.position} — needs to climb into Top ${cutoff}`,
      status: "needs-work",
    };
  }
  const gap = myToPar - cutoffToPar;

  if (remaining === 0) {
    return {
      headline: `${playerName} finished ${me.position} (outside Top ${cutoff}). Bet lost.`,
      status: "settled",
    };
  }
  if (gap <= 0) {
    return {
      headline: `${playerName} tied with the Top ${cutoff} cut line — ${plural(remaining, "hole")} left to break free`,
      hint: sgLeakHint(meSg, cutoffSg, playerName, lastInside?.displayName ?? "cut-line player"),
      status: "needs-work",
    };
  }
  if (gap === 1) {
    return {
      headline: `${playerName} 1 stroke off Top ${cutoff} — needs to play these ${plural(remaining, "hole")} one shot better than the cut line`,
      hint: sgLeakHint(meSg, cutoffSg, playerName, lastInside?.displayName ?? "cut-line player"),
      status: "needs-work",
    };
  }
  if (gap <= 3) {
    return {
      headline: `${playerName} ${gap} strokes off Top ${cutoff} — needs to outscore the cut line by ${gap} over the last ${plural(remaining, "hole")}`,
      hint: sgLeakHint(meSg, cutoffSg, playerName, lastInside?.displayName ?? "cut-line player"),
      status: "needs-work",
    };
  }
  return {
    headline: `${playerName} ${gap} back from Top ${cutoff} — needs a real charge over the last ${plural(remaining, "hole")}`,
    hint: sgLeakHint(meSg, cutoffSg, playerName, lastInside?.displayName ?? "cut-line player"),
    status: "long-shot",
  };
}

function roundScoreInsight(
  bet: RoundScoreBet,
  args: InsightInputs,
): BetInsight | null {
  const state = args.playerRoundStates[bet.playerId];
  if (!state) return null;
  const targetRound = bet.round ?? state.currentRound;
  const roundSnap = state.rounds[targetRound];
  if (!roundSnap) return null;
  // Not yet started.
  if (roundSnap.status === "not-started") {
    const par = roundSnap.roundPar || 70;
    const cushion = bet.line - par;
    return {
      headline:
        bet.side === "under"
          ? `R${targetRound} hasn't started — needs to shoot under ${bet.line}`
          : `R${targetRound} hasn't started — needs to shoot at least ${bet.line}`,
      hint:
        cushion > 0 && bet.side === "under"
          ? `${cushion >= 0.5 ? "+" : ""}${cushion} stroke${Math.abs(cushion) === 1 ? "" : "s"} vs par — needs ${plural(Math.ceil(par - bet.line + 0.5), "birdie")} more than bogeys`
          : undefined,
      status: "neutral",
    };
  }
  // Completed.
  if (roundSnap.status === "complete") {
    const finalStrokes = roundSnap.strokes;
    const won =
      bet.side === "under"
        ? finalStrokes < bet.line
        : finalStrokes >= bet.line;
    return {
      headline: `${won ? "Final " : "Final "}R${targetRound}: ${finalStrokes}. Bet ${won ? "won" : "lost"}.`,
      status: "settled",
    };
  }
  // In progress — interesting case.
  const { holesPlayed, holesRemaining, strokes, parRemaining } = roundSnap;
  // Strokes the player can still take and stay under (for under bets).
  const playerName = (
    args.leaderboard.find((r) => r.playerId === bet.playerId)?.displayName ??
    bet.playerName
  );
  if (bet.side === "under") {
    const remainingBudget = bet.line - strokes;
    if (remainingBudget <= 0) {
      // Already broken the line on the under side.
      return {
        headline: `${playerName} already at ${strokes} thru ${holesPlayed} — under ${bet.line} no longer possible`,
        status: "long-shot",
      };
    }
    // Need to play remaining holesRemaining at avg <= remainingBudget/holesRemaining
    const avgNeeded = remainingBudget / holesRemaining;
    const parAvg = parRemaining / holesRemaining;
    const diff = parAvg - avgNeeded; // positive = need to beat par
    if (diff < 0) {
      return {
        headline: `${playerName} on cruise — needs to average ${avgNeeded.toFixed(1)} on remaining ${plural(holesRemaining, "hole")} (par is ${parAvg.toFixed(1)})`,
        status: "favourable",
      };
    }
    const needBirdies = Math.ceil(diff * holesRemaining);
    return {
      headline: `${playerName} needs ${plural(needBirdies, "more birdie")} in ${plural(holesRemaining, "hole")} to be under ${bet.line}`,
      hint: `Currently ${strokes} thru ${holesPlayed} — needs to play remaining ${plural(holesRemaining, "hole")} in ${(remainingBudget - parRemaining).toFixed(0)} under par`,
      status: needBirdies <= 2 ? "needs-work" : "long-shot",
    };
  }
  // Over side
  const needAtLeast = bet.line - strokes;
  if (needAtLeast <= parRemaining - 4) {
    return {
      headline: `${playerName} on track to shoot over ${bet.line} (currently ${strokes} thru ${holesPlayed})`,
      status: "favourable",
    };
  }
  return {
    headline: `${playerName} ${strokes} thru ${holesPlayed} — needs to play remaining ${plural(holesRemaining, "hole")} in ${needAtLeast.toFixed(0)} or more`,
    status: "needs-work",
  };
}

function winningScoreInsight(
  bet: WinningScoreBet,
  args: InsightInputs,
): BetInsight | null {
  if (!args.tournamentProjections) return null;
  // Find the leader and their projected/actual total.
  const leader = args.leaderboard.find(
    (r) => r.position === "1" || r.position === "T1",
  );
  if (!leader) return null;
  const proj = args.tournamentProjections[leader.playerId];
  if (!proj || !Number.isFinite(proj.mean)) return null;
  const projectedWinner = Math.round(proj.mean);
  if (bet.side === "under") {
    const diff = projectedWinner - bet.line;
    if (diff < 0) {
      return {
        headline: `Projected winner total ${projectedWinner} — already under ${bet.line}`,
        hint: `${leader.displayName} on pace; line ${Math.abs(diff)} away from being safe`,
        status: "favourable",
      };
    }
    return {
      headline: `Projected winner total ${projectedWinner} — needs to drop ${diff}+ for under ${bet.line}`,
      status: diff <= 2 ? "needs-work" : "long-shot",
    };
  }
  const diff = bet.line - projectedWinner;
  if (diff < 0) {
    return {
      headline: `Projected winner total ${projectedWinner} — already over ${bet.line}`,
      status: "favourable",
    };
  }
  return {
    headline: `Projected winner total ${projectedWinner} — line ${bet.line} needs the field to give back ${diff}+`,
    status: diff <= 2 ? "needs-work" : "long-shot",
  };
}

// ── public entry point ────────────────────────────────────────────

export function computeBetInsight(args: InsightInputs): BetInsight | null {
  // Settled bets get a one-line "this happened" instead of a path.
  const settledTitle = (won: boolean) =>
    won ? "Bet won — final result locked in" : "Bet lost — tournament done";
  // Try the per-kind composer.
  const bet = args.bet;
  if (bet.kind === "outright") return outrightInsight(bet, args);
  if (bet.kind === "top-finish") return topFinishInsight(bet, args);
  if (bet.kind === "round-score") return roundScoreInsight(bet, args);
  if (bet.kind === "winning-score") return winningScoreInsight(bet, args);
  return null;
  void settledTitle; // reserved for future settled-bet variants
}
