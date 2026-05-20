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
  /** Per-(round,hole) mean of (strokes − par) across the field this
   *  tournament. Lets the round-score insight name specific holes as
   *  birdie chances or trouble spots. */
  fieldHoleStats?: Record<number, Record<number, { mean: number; count: number }>>;
  /** Per-(round,hole) par values for this tournament's course. */
  tournamentPars?: Record<number, Record<number, number>>;
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

interface UpcomingHole {
  hole: number;
  par: number;
  /** Field's strokes-vs-par mean. Negative = playing easier than par. */
  mean: number;
  count: number;
}

/**
 * Best-effort list of the holes still ahead of the player this round,
 * paired with the field's strokes-vs-par mean and the par value.
 *
 * Assumes straight order: if the player has finished `holesPlayed`,
 * their next hole is `holesPlayed + 1`. That's right for weekend
 * rounds (single tee) and most Thu/Fri tee-1 groups; it's wrong for
 * shotgun-start or tee-10 groups, but those caveats only really bite
 * mid-week — and the worst that happens is we name holes the player
 * won't actually play. Acceptable downside for v1.
 */
function upcomingHoles(
  round: number,
  holesPlayed: number,
  fieldHoleStats: InsightInputs["fieldHoleStats"],
  tournamentPars: InsightInputs["tournamentPars"],
): UpcomingHole[] {
  const roundStats = fieldHoleStats?.[round];
  const roundPars = tournamentPars?.[round];
  if (!roundStats || !roundPars) return [];
  const out: UpcomingHole[] = [];
  for (let h = holesPlayed + 1; h <= 18; h++) {
    const stat = roundStats[h];
    const par = roundPars[h];
    if (!stat || par == null) continue;
    out.push({ hole: h, par, mean: stat.mean, count: stat.count });
  }
  return out;
}

function fmtMean(mean: number): string {
  const r = Math.round(mean * 10) / 10;
  if (r === 0) return "even";
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}`;
}

/**
 * One-sentence summary of how the field is scoring the player's round.
 * Returns null when the sample is too small (early in R1) to read.
 */
function courseToneHint(
  round: number,
  fieldHoleStats: InsightInputs["fieldHoleStats"],
): string | null {
  const roundStats = fieldHoleStats?.[round];
  if (!roundStats) return null;
  const entries = Object.values(roundStats);
  if (entries.length < 9) return null; // need at least half the course
  const totalCount = entries.reduce((s, e) => s + e.count, 0);
  if (totalCount < 100) return null; // ~6 players' worth — too thin
  const weighted = entries.reduce((s, e) => s + e.mean * e.count, 0);
  const meanPerHole = weighted / totalCount;
  const fullRound = meanPerHole * 18;
  // ~0.05 strokes/hole = ~1 stroke over the round, the readable bar
  if (Math.abs(meanPerHole) < 0.04) {
    return "Course playing close to par overall today";
  }
  return `Course playing ${fmtMean(fullRound)} over par for the field today`;
}

/**
 * Pick the most exploitable holes still ahead. Under bets care about
 * the easiest holes (lowest mean); over bets care about the hardest.
 * Returns up to `n` holes ordered by usefulness for the side.
 */
function pickStandoutHoles(
  upcoming: UpcomingHole[],
  side: "under" | "over",
  n: number,
): UpcomingHole[] {
  if (upcoming.length === 0) return [];
  const sorted = [...upcoming].sort((a, b) =>
    side === "under" ? a.mean - b.mean : b.mean - a.mean,
  );
  return sorted.slice(0, Math.min(n, sorted.length));
}

function describeHole(h: UpcomingHole, side: "under" | "over"): string {
  // For under-bets call out par-5s explicitly — they're naturally the
  // easiest scoring holes regardless of field mean. For over-bets,
  // any hole playing notably over par is the headline.
  const meaningful =
    side === "under" ? h.mean <= -0.05 : h.mean >= 0.1;
  if (meaningful) {
    return `Hole ${h.hole} (par ${h.par}, playing ${fmtMean(h.mean)})`;
  }
  return `Hole ${h.hole} (par ${h.par})`;
}

/** Render the upcoming-hole list as "Hole 13 (par 5, -0.4) and Hole 16 (par 4)". */
function joinHoles(holes: UpcomingHole[], side: "under" | "over"): string {
  if (holes.length === 0) return "";
  if (holes.length === 1) return describeHole(holes[0], side);
  if (holes.length === 2) {
    return `${describeHole(holes[0], side)} and ${describeHole(holes[1], side)}`;
  }
  const head = holes
    .slice(0, -1)
    .map((h) => describeHole(h, side))
    .join(", ");
  return `${head}, and ${describeHole(holes[holes.length - 1], side)}`;
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
  const playerName = (
    args.leaderboard.find((r) => r.playerId === bet.playerId)?.displayName ??
    bet.playerName
  );

  const upcoming = upcomingHoles(
    targetRound,
    holesPlayed,
    args.fieldHoleStats,
    args.tournamentPars,
  );
  const tone = courseToneHint(targetRound, args.fieldHoleStats);

  if (bet.side === "under") {
    const remainingBudget = bet.line - strokes;
    if (remainingBudget <= 0) {
      return {
        headline: `${playerName} already at ${strokes} thru ${holesPlayed} — under ${bet.line} no longer possible`,
        status: "long-shot",
      };
    }
    const avgNeeded = remainingBudget / holesRemaining;
    const parAvg = parRemaining / holesRemaining;
    const diff = parAvg - avgNeeded; // positive = need to beat par

    // Already on track — pars the rest of the way bring it home.
    if (diff < 0) {
      const escapes = pickStandoutHoles(upcoming, "under", 2);
      const escapeStr = escapes.length > 0 ? joinHoles(escapes, "under") : null;
      return {
        headline: `${playerName} on track — par ${plural(holesRemaining, "more hole")} to be under ${bet.line}`,
        hint: escapeStr
          ? `${escapeStr} ${escapes.length === 1 ? "is" : "are"} the get-out${escapes.length === 1 ? "" : "s"} if anything goes wrong`
          : tone ?? undefined,
        status: "favourable",
      };
    }

    // Needs to beat par to come in under the line. How many birdies?
    const needBirdies = Math.ceil(diff * holesRemaining);
    const easy = pickStandoutHoles(upcoming, "under", Math.min(3, needBirdies + 1));
    const easyStr = easy.length > 0 ? joinHoles(easy, "under") : null;
    const longShot = needBirdies > 3;
    const headline = `${playerName} needs ${plural(needBirdies, "birdie")} in ${plural(holesRemaining, "hole")} to be under ${bet.line}`;
    let hint: string | undefined;
    if (easyStr) {
      hint = `Best birdie chances coming up: ${easyStr}`;
      if (tone) hint = `${tone}. ${hint}`;
    } else if (tone) {
      hint = tone;
    }
    return {
      headline,
      hint,
      status: longShot ? "long-shot" : "needs-work",
    };
  }

  // Over side — needs strokes given back. Hardest holes are the friend.
  const needAtLeast = bet.line - strokes;
  const hard = pickStandoutHoles(upcoming, "over", 2);
  const hardStr = hard.length > 0 ? joinHoles(hard, "over") : null;
  if (needAtLeast <= parRemaining - 4) {
    return {
      headline: `${playerName} on track to shoot over ${bet.line} (${strokes} thru ${holesPlayed})`,
      hint: hardStr ? `${hardStr} the toughest holes left` : tone ?? undefined,
      status: "favourable",
    };
  }
  return {
    headline: `${playerName} ${strokes} thru ${holesPlayed} — needs to play remaining ${plural(holesRemaining, "hole")} in ${needAtLeast.toFixed(0)} or more`,
    hint: hardStr
      ? `Where the bogeys come: ${hardStr}${tone ? `. ${tone}` : ""}`
      : tone ?? undefined,
    status: "needs-work",
  };
}

/**
 * Count active players whose projected total lands the bet's side of
 * the line. For under-bets these are "still-viable winners" that
 * would settle the bet won; for over-bets they're the field still
 * projected at or above the line.
 *
 * Excludes the leader if `excludeLeaderId` is supplied — the leader
 * is named separately in the headline.
 */
function contendersFor(
  side: "under" | "over",
  line: number,
  projections: Record<string, TournamentProjection>,
  excludeLeaderId: string | null,
): number {
  let count = 0;
  for (const [pid, p] of Object.entries(projections)) {
    if (!p.active) continue;
    if (pid === excludeLeaderId) continue;
    if (!Number.isFinite(p.mean)) continue;
    if (side === "under" ? p.mean < line : p.mean >= line) count++;
  }
  return count;
}

/**
 * Leader's most-feared remaining hole this round — hardest by field
 * mean. Surfaces the "where the bet could slip" in winning-score
 * under-bets, and "where the bogeys are likely" in over-bets.
 */
function leaderDangerHole(
  leaderId: string,
  args: InsightInputs,
): UpcomingHole | null {
  const state = args.playerRoundStates[leaderId];
  if (!state) return null;
  const upcoming = upcomingHoles(
    state.currentRound,
    state.holesPlayed,
    args.fieldHoleStats,
    args.tournamentPars,
  );
  const hard = pickStandoutHoles(upcoming, "over", 1);
  return hard[0] ?? null;
}

function joinHints(...parts: Array<string | undefined | null>): string | undefined {
  const filtered = parts.filter((p): p is string => !!p && p.length > 0);
  if (filtered.length === 0) return undefined;
  return filtered.join(". ");
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
  const danger = leaderDangerHole(leader.playerId, args);
  const dangerStr = danger
    ? `${leader.displayName}'s biggest danger spot: Hole ${danger.hole} (par ${danger.par}, playing ${fmtMean(danger.mean)} for the field)`
    : null;

  if (bet.side === "under") {
    const diff = projectedWinner - bet.line;
    const otherContenders = contendersFor(
      "under",
      bet.line,
      args.tournamentProjections,
      leader.playerId,
    );
    const contenderStr =
      otherContenders > 0
        ? `${plural(otherContenders, "other player")} also projected under ${bet.line} — bet stays alive even if ${leader.displayName} fades`
        : null;
    if (diff < 0) {
      return {
        headline: `Projected winner total ${projectedWinner} — already under ${bet.line}`,
        hint: joinHints(contenderStr, dangerStr),
        status: "favourable",
      };
    }
    return {
      headline: `Projected winner total ${projectedWinner} — needs the leader to drop ${plural(diff, "stroke")} for under ${bet.line}`,
      hint: joinHints(dangerStr, contenderStr),
      status: diff <= 2 ? "needs-work" : "long-shot",
    };
  }

  // Over side — bet wins when nobody comes in under the line.
  const diff = bet.line - projectedWinner;
  // For over bets, "threats" are players still projected UNDER the line
  // who could take the tournament before the bet lands.
  const threats = contendersFor(
    "under",
    bet.line,
    args.tournamentProjections,
    null,
  );
  const threatStr =
    threats > 0
      ? `${plural(threats, "player")} still projected under ${bet.line} — any of them winning kills the bet`
      : null;
  if (diff < 0) {
    return {
      headline: `Projected winner total ${projectedWinner} — already over ${bet.line}`,
      hint: joinHints(threatStr, dangerStr),
      status: threats <= 2 ? "favourable" : "needs-work",
    };
  }
  return {
    headline: `Projected winner total ${projectedWinner} — line ${bet.line} needs the field to give back ${plural(diff, "stroke")}`,
    hint: joinHints(dangerStr, threatStr),
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
