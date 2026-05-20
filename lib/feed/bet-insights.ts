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

interface InsightInputs {
  bet: TrackedBet;
  leaderboard: LeaderboardLite[];
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
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

function holesRemainingTotal(state: PlayerRoundState | undefined): number {
  if (!state) return 0;
  // Current round's remaining + 18 per round not yet played.
  const roundsLeft = Math.max(0, 4 - state.currentRound);
  return state.holesRemaining + roundsLeft * 18;
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
  let bestRivalToPar: number | null = null;
  let bestRivalName: string | null = null;
  for (const row of args.leaderboard) {
    if (row.playerId === bet.playerId) continue;
    const tp = parseToPar(row.total);
    if (tp === null) continue;
    if (bestRivalToPar === null || tp < bestRivalToPar) {
      bestRivalToPar = tp;
      bestRivalName = row.displayName;
    }
  }
  if (bestRivalToPar === null) return null;

  const remaining = holesRemainingTotal(
    args.playerRoundStates[bet.playerId],
  );
  const playerName = me.displayName;

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
        lead >= 3
          ? "Just needs to stay upright — comfortable cushion"
          : `${bestRivalName ?? "Field"} ${plural(lead, "stroke")} back and closest`,
      status: "favourable",
    };
  }

  // Tied with the closest rival.
  if (deficit === 0) {
    return {
      headline: `${playerName} tied for the lead with ${plural(remaining, "hole")} to play`,
      hint: bestRivalName
        ? `Level with ${bestRivalName} — one birdie ahead of the field and ${playerName} is out front`
        : undefined,
      status: "favourable",
    };
  }
  const gap = deficit;

  // Behind — need to make up ground.
  // Crude framing: each "birdie ahead of the leader" closes one stroke.
  const birdiesNeeded = gap;
  const realisticBirdies = Math.min(remaining, 8); // pros rarely make >8 birdies
  const longShot = birdiesNeeded > Math.floor(realisticBirdies / 2);

  // Try to pick a textual sense of "how hard": 1 stroke back = easy,
  // 2-3 back = "feasible", 4+ back = "needs a charge".
  let headline: string;
  let hint: string | undefined;
  if (gap === 1) {
    headline = `${playerName} 1 stroke back with ${plural(remaining, "hole")} left`;
    hint = "One birdie ahead of the leader and it's even";
  } else if (gap <= 3) {
    headline = `${playerName} ${gap} strokes back with ${plural(remaining, "hole")} left`;
    hint = `Roughly ${plural(gap, "birdie")} ahead of the leader's pace to tie`;
  } else {
    headline = `${playerName} ${gap} back with ${plural(remaining, "hole")} left — needs a charge`;
    hint = `Looking at ${plural(gap, "birdie")} ahead of the leader's remaining holes`;
  }
  return {
    headline,
    hint,
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

  // Already inside the cut — comfort or coast message.
  if (myPos <= cutoff) {
    if (remaining === 0) {
      return {
        headline: `${playerName} finished ${me.position}. Bet wins.`,
        status: "settled",
      };
    }
    // How much room is there? Find the player one outside top-N.
    const bubble = args.leaderboard.find((r) => {
      const p = parsePosition(r.position);
      return p === cutoff + 1 || (p ?? 99) > cutoff;
    });
    const bubbleToPar = bubble ? parseToPar(bubble.total) : null;
    const cushion = bubbleToPar !== null ? bubbleToPar - myToPar : null;
    if (cushion !== null && cushion >= 0) {
      return {
        headline: `${playerName} is ${me.position} with a ${cushion}-stroke cushion outside Top ${cutoff}`,
        hint: `${plural(remaining, "hole")} left to defend the position`,
        status: cushion >= 2 ? "favourable" : "needs-work",
      };
    }
    return {
      headline: `${playerName} is currently ${me.position} (inside Top ${cutoff}) with ${plural(remaining, "hole")} left`,
      status: "favourable",
    };
  }

  // Outside the cut — need to climb. Estimate the strokes-gap to
  // top-N's CURRENT score.
  const lastInside = args.leaderboard
    .filter((r) => {
      const p = parsePosition(r.position);
      return p !== null && p <= cutoff;
    })
    .sort((a, b) => {
      // worst player still inside the cut
      const aP = parseToPar(a.total) ?? 99;
      const bP = parseToPar(b.total) ?? 99;
      return aP - bP;
    })
    .at(-1);
  const cutoffToPar = lastInside ? parseToPar(lastInside.total) : null;
  if (cutoffToPar === null) {
    return {
      headline: `${playerName} sits ${me.position} — needs to climb into Top ${cutoff}`,
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
    // Tied with the cut player
    return {
      headline: `${playerName} tied with the Top ${cutoff} cut line — ${plural(remaining, "hole")} left to break free`,
      status: "needs-work",
    };
  }
  if (gap === 1) {
    return {
      headline: `${playerName} 1 stroke off Top ${cutoff} — one birdie in the next ${plural(remaining, "hole")} does it`,
      status: "needs-work",
    };
  }
  if (gap <= 3) {
    return {
      headline: `${playerName} ${gap} strokes off Top ${cutoff} with ${plural(remaining, "hole")} left`,
      hint: `Needs about ${plural(gap, "birdie")} more than the cut-line players`,
      status: "needs-work",
    };
  }
  return {
    headline: `${playerName} ${gap} strokes off Top ${cutoff} — needs a strong finish`,
    hint: `${plural(remaining, "hole")} left to climb ${gap} shots`,
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
