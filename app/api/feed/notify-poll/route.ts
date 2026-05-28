import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import {
  computeFieldStats,
  getFeedBundle,
} from "@/lib/feed/store";
import { ensurePlayerSkill } from "@/lib/feed/skill-cache";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { sendPush, type SubscriptionLike } from "@/lib/notifications/web-push";
import { abbreviateName } from "@/lib/text/abbreviate";
import type { FeedEvent } from "@/lib/feed/types";
import {
  currentValueForBet,
  detectBetSettlement,
  evaluateRoundScore,
  evaluateWinningScore,
  resolveBetRound,
  type RoundScoreBet,
  type TopFinishProbs,
  type TournamentProjection,
  type TrackedBet,
  type PlayerRoundState,
  type RoundSnapshot,
  type WinningScoreBet,
} from "@/app/live/bet-shared";
import { getHotTopFinish } from "@/lib/feed/top-finish-cache";
import { recordCall, type SharpCategory } from "@/lib/feed/sharp-score";
import { formatBetCurrency } from "@/lib/format/bet-currency";

/**
 * GET /api/feed/notify-poll
 *
 * Cron-triggered every ~60s during live tournaments. For every active
 * (unsettled, opt-in) bet across all users, recomputes the model's
 * current view and diffs against the last_notified_* state stored on
 * the bet row. Fires push notifications for:
 *
 *   - settlement (round-score only in v1; outright/top-finish/
 *     winning-score deferred to a follow-up build)
 *   - threshold crosses (prob moves above/below 50%, 80%, 20%) —
 *     each one-shot via the notif_crossed_* flags
 *   - big swings (prob ±15pp OR fair value ±40% since last
 *     notification), with a 30-min cooldown to prevent fatigue
 *
 * Sends through web-push to every push_subscription belonging to the
 * bet's owner. Subscriptions returning 404/410 ("gone") get pruned.
 *
 * Auth: when CRON_SECRET is set, Authorization: Bearer <secret>.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SWING_PP = 15;
const SWING_VALUE_REL = 0.4;
const COOLDOWN_MS = 30 * 60 * 1000;
/** Don't push events older than this when the cron catches a backlog.
 *  A birdie 8 minutes old is a confusing notification — the user
 *  already saw it (or didn't care). */
const EVENT_PUSH_MAX_AGE_MS = 5 * 60 * 1000;
const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "https://pardle.app";

// Currency formatting now per-bet. Push notification copy carries
// the bet's own currency so US users see "$50" not "£50" in the
// banner.

interface BetRow {
  id: string;
  user_id: string;
  kind: string;
  data: Record<string, unknown>;
  placed_at: string;
  /** Cookie identity captured at bet placement so the settle path can
   *  credit/debit the right Sharp Score ledger. Null for legacy bets
   *  placed before migration 0007 — those won't contribute. */
  author_key: string | null;
  last_notified_prob: number | null;
  last_notified_value: number | null;
  last_notified_at: string | null;
  notif_mode: string;
  notif_crossed_50_up: boolean;
  notif_crossed_50_down: boolean;
  notif_crossed_80: boolean;
  notif_crossed_20: boolean;
}

function sharpCategoryFor(kind: string): SharpCategory | null {
  if (kind === "outright") return "bet-outright";
  if (kind === "top-finish") return "bet-top-finish";
  if (kind === "round-score") return "bet-round-score";
  if (kind === "winning-score") return "bet-winning-score";
  return null;
}

interface PushDecision {
  payload: { title: string; body: string; url: string; tag: string };
  /** Patches to apply on the bet row after dispatch. */
  patch: Partial<{
    last_notified_prob: number;
    last_notified_value: number;
    last_notified_at: string;
    notif_crossed_50_up: boolean;
    notif_crossed_50_down: boolean;
    notif_crossed_80: boolean;
    notif_crossed_20: boolean;
    settled_at: string;
    settled_won: boolean;
  }>;
}

function rowToBet(row: BetRow): TrackedBet | null {
  if (
    !["outright", "round-score", "winning-score", "top-finish"].includes(
      row.kind,
    )
  ) {
    return null;
  }
  return {
    ...(row.data as object),
    id: row.id,
    kind: row.kind,
    placedAt: new Date(row.placed_at).getTime(),
  } as TrackedBet;
}

function decideForBet(
  row: BetRow,
  bet: TrackedBet,
  currentProb: number | null,
  currentValue: number | null,
  settlement: { won: boolean } | null,
): PushDecision[] {
  const decisions: PushDecision[] = [];
  const lastProb = row.last_notified_prob ?? null;
  const lastValue = row.last_notified_value ?? null;
  const lastTs = row.last_notified_at
    ? new Date(row.last_notified_at).getTime()
    : 0;
  const cooldownOk = Date.now() - lastTs >= COOLDOWN_MS;
  const url = `${ORIGIN}/live/bet/${encodeURIComponent(row.id)}`;
  const subject = subjectFor(bet);

  // Settlement — overrides everything, ignores notif_mode mute.
  if (settlement) {
    decisions.push({
      payload: {
        title: settlement.won ? "Your bet just landed 🎉" : "Your bet didn't land",
        body: settlement.won
          ? `${subject} hit. ${formatBetCurrency(bet.stake * bet.oddsTaken - bet.stake, bet.currency)} profit.`
          : `${subject} didn't get there. -${formatBetCurrency(bet.stake, bet.currency)}.`,
        url,
        tag: `settle-${row.id}`,
      },
      patch: {
        settled_at: new Date().toISOString(),
        settled_won: settlement.won,
        last_notified_at: new Date().toISOString(),
      },
    });
    return decisions;
  }

  if (row.notif_mode === "off" || row.notif_mode === "settle-only") {
    return decisions;
  }
  if (currentProb == null || currentValue == null) return decisions;

  const pct = Math.round(currentProb * 100);

  // Threshold crosses — each one-shot.
  if (currentProb >= 0.5 && !row.notif_crossed_50_up) {
    decisions.push({
      payload: {
        title: "Your bet is now favoured",
        body: `${subject} — model now at ${pct}% chance.`,
        url,
        tag: `cross-50u-${row.id}`,
      },
      patch: {
        notif_crossed_50_up: true,
        notif_crossed_50_down: false,
        last_notified_prob: currentProb,
        last_notified_value: currentValue,
        last_notified_at: new Date().toISOString(),
      },
    });
  }
  if (currentProb < 0.5 && !row.notif_crossed_50_down && lastProb != null && lastProb >= 0.5) {
    decisions.push({
      payload: {
        title: "Your bet is no longer favoured",
        body: `${subject} — model now at ${pct}%.`,
        url,
        tag: `cross-50d-${row.id}`,
      },
      patch: {
        notif_crossed_50_down: true,
        notif_crossed_50_up: false,
        last_notified_prob: currentProb,
        last_notified_value: currentValue,
        last_notified_at: new Date().toISOString(),
      },
    });
  }
  if (currentProb >= 0.8 && !row.notif_crossed_80) {
    decisions.push({
      payload: {
        title: "Near-certain — your bet looks great",
        body: `${subject} — model at ${pct}%. Worth ${formatBetCurrency(currentValue, bet.currency)}.`,
        url,
        tag: `cross-80-${row.id}`,
      },
      patch: {
        notif_crossed_80: true,
        last_notified_prob: currentProb,
        last_notified_value: currentValue,
        last_notified_at: new Date().toISOString(),
      },
    });
  }
  if (currentProb <= 0.2 && !row.notif_crossed_20 && lastProb != null && lastProb > 0.2) {
    decisions.push({
      payload: {
        title: "Your bet's in trouble",
        body: `${subject} — model down to ${pct}%.`,
        url,
        tag: `cross-20-${row.id}`,
      },
      patch: {
        notif_crossed_20: true,
        last_notified_prob: currentProb,
        last_notified_value: currentValue,
        last_notified_at: new Date().toISOString(),
      },
    });
  }

  // If a threshold cross already fired this poll, skip the big-swing
  // check — same content otherwise.
  if (decisions.length > 0) return decisions;

  // Big swing — gated by cooldown + 15pp prob OR 40% value move.
  if (cooldownOk && lastProb != null && lastValue != null && lastValue > 0) {
    const probDeltaPp = Math.abs(currentProb - lastProb) * 100;
    const valueDeltaRel = Math.abs(currentValue - lastValue) / lastValue;
    const isUp = currentValue > lastValue;
    if (probDeltaPp >= SWING_PP || valueDeltaRel >= SWING_VALUE_REL) {
      decisions.push({
        payload: {
          title: isUp ? "Your bet is moving up" : "Your bet is moving down",
          body: `${subject} — now ${pct}% chance, worth ${formatBetCurrency(currentValue, bet.currency)}.`,
          url,
          tag: `swing-${row.id}`,
        },
        patch: {
          last_notified_prob: currentProb,
          last_notified_value: currentValue,
          last_notified_at: new Date().toISOString(),
        },
      });
    }
  }

  // First-ever notification: prime the baseline so future swings
  // measure against a real value rather than 0/null.
  if (decisions.length === 0 && lastProb == null) {
    decisions.push({
      payload: { title: "", body: "", url, tag: "" },
      patch: {
        last_notified_prob: currentProb,
        last_notified_value: currentValue,
        // Intentionally NOT setting last_notified_at — this is a
        // silent prime, doesn't count against the cooldown.
      },
    });
  }

  return decisions;
}

function subjectFor(bet: TrackedBet): string {
  if (bet.kind === "outright") return `${bet.playerName} to win`;
  if (bet.kind === "round-score") {
    const r = bet.round != null ? ` R${bet.round}` : "";
    return `${bet.playerName}${r} ${bet.side} ${bet.line}`;
  }
  if (bet.kind === "winning-score") {
    return `Winning score ${bet.side} ${bet.line}`;
  }
  return `${bet.playerName} top ${bet.cutoff}`;
}

/** Round-score settlement detection. For bets with bet.round set, or
 *  with placement.round captured at submit, this is straightforward —
 *  check that round's status. For legacy bets where both are null,
 *  we resolve via the tournament startDate + placedAt heuristic (the
 *  same path BetDetail uses) so a bet placed during R1 still settles
 *  against R1's score after the player moves on to R2. */
function roundScoreSettlement(
  bet: RoundScoreBet,
  states: Record<string, PlayerRoundState>,
  tournamentStartDate: number | null,
): { won: boolean } | null {
  const state = states[bet.playerId];
  if (!state) return null;
  const round = resolveBetRound(bet, state, tournamentStartDate);
  if (round == null) return null;
  const r = state.rounds?.[round];
  if (!r || r.status !== "complete") return null;
  const won =
    bet.side === "under" ? r.strokes < bet.line : r.strokes > bet.line;
  return { won };
}

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[notify-poll] top-level failure", err);
    return NextResponse.json(
      {
        error: "notify-poll-failed",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
      },
      { status: 500 },
    );
  }
}

async function handle(req: Request) {
  // Fail closed when the secret isn't configured — this route reads
  // every pending bet across every user and dispatches push.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron-disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const active = await getActiveTournament().catch(() => null);
  if (!active) {
    return NextResponse.json({ skipped: "no-tournament" });
  }
  const tournamentId = active.tournament.id;

  // Load all the model state /api/feed normally builds.
  const bundle = await getFeedBundle(tournamentId);
  const fieldStats = computeFieldStats(bundle.snapshot, bundle.pars);
  const playerSkill = await ensurePlayerSkill(tournamentId, bundle.leaderboard);
  const { playerRoundStates, tournamentProjections } = buildPlayerStates(
    bundle.snapshot,
    bundle.pars,
    fieldStats,
    playerSkill,
    bundle.leaderboard,
  );
  const topFinish = (await getHotTopFinish(tournamentId))?.byPlayer ?? {};

  const currentOdds: Record<string, number> = {};
  for (const [pid, buf] of Object.entries(bundle.oddsBuffers)) {
    if (!Array.isArray(buf) || buf.length === 0) continue;
    const last = buf[buf.length - 1];
    if (last) currentOdds[pid] = last.p;
  }

  const admin = getSupabaseAdmin();
  // Pull every candidate bet across users in a single query.
  const { data: rowsRaw, error } = await admin
    .from("bets")
    .select(
      "id, user_id, kind, data, placed_at, author_key, last_notified_prob, last_notified_value, last_notified_at, notif_mode, notif_crossed_50_up, notif_crossed_50_down, notif_crossed_80, notif_crossed_20",
    )
    .is("removed_at", null)
    .is("settled_at", null)
    .neq("notif_mode", "off");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (rowsRaw ?? []) as BetRow[];

  // Subscriptions: fetch in one query for the set of users involved.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  let subsByUser = new Map<string, SubscriptionLike[]>();
  if (userIds.length > 0) {
    const { data: subRows } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth_key")
      .in("user_id", userIds);
    if (subRows) {
      for (const s of subRows as Array<
        SubscriptionLike & { user_id: string }
      >) {
        const arr = subsByUser.get(s.user_id) ?? [];
        arr.push(s);
        subsByUser.set(s.user_id, arr);
      }
    }
  }

  let evaluated = 0;
  let notified = 0;
  let gonePruned = 0;

  for (const row of rows) {
    evaluated++;
    const bet = rowToBet(row);
    if (!bet) continue;

    // Round-score has its own per-round settlement path; outright /
    // top-finish / winning-score share the tournament-over detector
    // so they all flip to "won/lost" once the leaderboard's final.
    let settlement: { won: boolean } | null = null;
    if (bet.kind === "round-score") {
      settlement = roundScoreSettlement(
        bet,
        playerRoundStates,
        active.tournament.startDate ?? null,
      );
    } else {
      settlement = detectBetSettlement(
        bet,
        bundle.leaderboard,
        playerRoundStates,
        tournamentProjections,
      );
    }

    const value = currentValueForBet(
      bet,
      currentOdds,
      playerRoundStates,
      tournamentProjections,
      topFinish,
      settlement,
    );
    const prob = currentProbFor(
      bet,
      currentOdds,
      playerRoundStates,
      tournamentProjections,
      topFinish,
    );

    const decisions = decideForBet(row, bet, prob, value, settlement);
    if (decisions.length === 0) continue;

    const subs = subsByUser.get(row.user_id) ?? [];

    for (const decision of decisions) {
      // Silent-prime decisions have an empty title — don't dispatch,
      // just apply the patch to baseline future diffs.
      if (decision.payload.title === "") {
        await admin.from("bets").update(decision.patch as never).eq("id", row.id);
        continue;
      }

      for (const sub of subs) {
        const res = await sendPush(sub, decision.payload);
        if (res.gone) {
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);
          gonePruned++;
        } else if (res.ok) {
          notified++;
        }
      }
      await admin.from("bets").update(decision.patch as never).eq("id", row.id);

      // Sharp Score credit on settlement. Only fires on the settle
      // decision (recognisable by settled_at being set in the patch),
      // and only when we know the visitor's cookie identity — legacy
      // bets placed before migration 0007 land with author_key=null
      // and silently skip the ledger write.
      if (
        decision.patch.settled_at != null &&
        typeof decision.patch.settled_won === "boolean" &&
        row.author_key
      ) {
        const category = sharpCategoryFor(row.kind);
        if (category) {
          await recordCall({
            authorKey: row.author_key,
            category,
            correct: decision.patch.settled_won,
          }).catch((err) => {
            console.error("[notify-poll] sharp-score record failed", err);
          });
        }
      }
    }
  }

  // ── Followed-player events ────────────────────────────────────────
  // Birdies, eagles, blow-ups, and putt-poll opens for any player a
  // subscribed device follows. Reuses the same web-push pipeline as
  // the bet branch above. Throttled per subscription via
  // last_notified_event_ts so we never re-push the same event ID.
  let followNotified = 0;
  const eventCutoff = Date.now() - EVENT_PUSH_MAX_AGE_MS;
  const pushWorthy = (bundle.events ?? [])
    .filter((e) => e.ts >= eventCutoff && isPushWorthyEvent(e))
    .sort((a, b) => a.ts - b.ts);

  if (pushWorthy.length > 0) {
    // Use the `gt` filter on array_length(follows, 1) — Supabase JS
    // can't express that, so we order/limit broadly and skip empties.
    const { data: followSubs } = await admin
      .from("push_subscriptions")
      .select(
        "id, user_id, endpoint, p256dh, auth_key, follows, last_notified_event_ts",
      );

    for (const sub of (followSubs ?? []) as Array<
      SubscriptionLike & {
        follows: string[] | null;
        last_notified_event_ts: number | null;
      }
    >) {
      const follows = sub.follows ?? [];
      if (follows.length === 0) continue;
      const followSet = new Set(follows);
      const lastTs = sub.last_notified_event_ts ?? 0;
      const matched = pushWorthy.filter(
        (e) => e.ts > lastTs && followSet.has(e.playerId),
      );
      if (matched.length === 0) continue;

      let maxTsSent = lastTs;
      let pruned = false;
      for (const ev of matched) {
        const payload = buildEventPayload(ev);
        const res = await sendPush(sub, payload);
        if (res.gone) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
          gonePruned++;
          pruned = true;
          break;
        }
        if (res.ok) {
          followNotified++;
          if (ev.ts > maxTsSent) maxTsSent = ev.ts;
        }
      }
      if (!pruned && maxTsSent > lastTs) {
        await admin
          .from("push_subscriptions")
          .update({ last_notified_event_ts: maxTsSent } as never)
          .eq("id", sub.id);
      }
    }
  }

  return NextResponse.json({
    polled: true,
    tournament: tournamentId,
    bets: rows.length,
    evaluated,
    notified,
    followNotified,
    gonePruned,
  });
}

/**
 * Score events worth waking a phone for: birdies+ and disasters+.
 * Plus any putt-poll-open event (interactive moment — vote before
 * the putt drops). Pars and bogeys are deliberately filtered out.
 */
function isPushWorthyEvent(e: FeedEvent): boolean {
  if (e.ace) return true;
  if (e.type === "score") {
    return (
      e.result === "albatross" ||
      e.result === "eagle" ||
      e.result === "birdie" ||
      e.result === "double" ||
      e.result === "triple-plus"
    );
  }
  if (e.type === "putt-poll" && e.pollId) return true;
  return false;
}

/**
 * Convert a feed event into a push payload. Title carries the
 * abbreviated player name + the result emoji; body is the action
 * sentence with player-name prefix stripped (the title already
 * showed it). `tag` collapses repeat pings for the same player so
 * a four-birdie hot streak stays as one notification at a time.
 */
function buildEventPayload(e: FeedEvent): {
  title: string;
  body: string;
  url: string;
  tag: string;
} {
  const short = abbreviateName(e.playerName);
  if (e.type === "putt-poll") {
    const dist =
      typeof e.puttDistanceFt === "number"
        ? `${e.puttDistanceFt}ft `
        : "";
    const forWhat = e.puttFor ?? "putt";
    return {
      title: `🎯 ${short}`,
      body: `${dist}for ${forWhat} — call it before it drops`,
      url: `${ORIGIN}/`,
      tag: `poll-${e.pollId ?? e.id}`,
    };
  }
  const stripped = e.headline.startsWith(e.playerName)
    ? e.headline.slice(e.playerName.length).trim()
    : e.headline;
  const trailer = e.toPar ? ` · R${e.round} ${e.toPar}` : ` · R${e.round}`;
  return {
    title: `${e.emoji} ${short}`,
    body: `${stripped}${trailer}`,
    url: `${ORIGIN}/live/player/${e.playerId}`,
    tag: `player-${e.playerId}`,
  };
}

// ──────────────────────────────────────────────────────────────────
// Helpers — mostly duplicated from /api/feed/route.ts. Worth
// extracting into a shared module once we have a third caller.
// ──────────────────────────────────────────────────────────────────

const MIN_SAMPLE = 10;
const FALLBACK_VAR = 0.65;
const INACTIVE_STATES = new Set(["CUT", "MC", "WD", "DQ", "DNS"]);

function buildPlayerStates(
  snap: import("@/lib/feed/store").FeedBundle["snapshot"],
  pars: import("@/lib/feed/store").FeedBundle["pars"],
  fieldStats: import("@/lib/feed/store").FieldHoleStats,
  playerSkill: import("@/lib/feed/store").PlayerSkillMap,
  leaderboard: import("@/lib/feed/store").CachedLeaderboardRow[],
): {
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections: Record<string, TournamentProjection>;
} {
  const playerRoundStates: Record<string, PlayerRoundState> = {};
  const tournamentProjections: Record<string, TournamentProjection> = {};
  if (!snap) return { playerRoundStates, tournamentProjections };

  const stateMap = new Map<string, string>();
  for (const r of leaderboard) stateMap.set(r.playerId, r.playerState);

  function holeStat(round: number, hole: number) {
    const s = fieldStats[round]?.[hole];
    if (s && s.count >= MIN_SAMPLE)
      return { mean: s.mean, variance: s.variance };
    for (let r = round - 1; r >= 1; r--) {
      const prior = fieldStats[r]?.[hole];
      if (prior && prior.count >= MIN_SAMPLE) {
        return { mean: prior.mean, variance: prior.variance };
      }
    }
    return { mean: 0, variance: FALLBACK_VAR };
  }

  for (const [pid, byRound] of Object.entries(snap.holes)) {
    let ttdStrokes = 0;
    let ttdPar = 0;
    let ttdHoles = 0;
    for (const [rStr, holes] of Object.entries(byRound)) {
      const r = Number(rStr);
      const pr = pars[r] ?? {};
      for (const [holeStr, scoreStr] of Object.entries(holes)) {
        const p = pr[Number(holeStr)];
        if (p == null) continue;
        const played =
          scoreStr !== "" &&
          scoreStr !== "-" &&
          Number.isFinite(Number(scoreStr));
        if (!played) continue;
        ttdStrokes += Number(scoreStr);
        ttdPar += p;
        ttdHoles++;
      }
    }
    const ttdPacePerHole = ttdHoles > 0 ? (ttdStrokes - ttdPar) / ttdHoles : 0;
    const skillPerHole = (playerSkill[pid] ?? 0) / 18;

    const rounds: Record<number, RoundSnapshot> = {};
    let currentRound = 0;
    let tournamentMean = 0;
    let tournamentVariance = 0;
    let tournamentRoundsCovered = 0;
    const fallbackPars = pars[1] ?? {};

    for (let r = 1; r <= 4; r++) {
      const ownPars = pars[r];
      const pl =
        ownPars && Object.keys(ownPars).length > 0 ? ownPars : fallbackPars;
      const holes = byRound[r];
      if (!pl || Object.keys(pl).length === 0) continue;
      let strokes = 0;
      let parPlayed = 0;
      let holesPlayed = 0;
      let roundPar = 0;
      let parRemaining = 0;
      let holesRemaining = 0;
      let anyPlayed = false;
      let expectedRemaining = 0;
      let variance = 0;
      for (const [holeStr, par] of Object.entries(pl)) {
        const hole = Number(holeStr);
        roundPar += par;
        const scoreStr = holes?.[hole];
        const played =
          scoreStr != null &&
          scoreStr !== "" &&
          scoreStr !== "-" &&
          Number.isFinite(Number(scoreStr));
        if (played) {
          strokes += Number(scoreStr);
          parPlayed += par;
          holesPlayed++;
          anyPlayed = true;
        } else {
          parRemaining += par;
          holesRemaining++;
          const stat = holeStat(r, hole);
          expectedRemaining += par + stat.mean - skillPerHole;
          variance += stat.variance;
        }
      }
      rounds[r] = {
        holesPlayed,
        holesRemaining,
        strokes,
        parPlayed,
        parRemaining,
        roundPar,
        toPar: strokes - parPlayed,
        status:
          holesRemaining === 0 && anyPlayed
            ? "complete"
            : anyPlayed
            ? "in-progress"
            : "not-started",
        expectedRemaining,
        variance,
      };
      tournamentMean += strokes + expectedRemaining;
      tournamentVariance += variance;
      tournamentRoundsCovered++;
      if (anyPlayed && r > currentRound) currentRound = r;
    }

    if (tournamentRoundsCovered === 4) {
      const status = stateMap.get(pid) ?? "ACTIVE";
      tournamentProjections[pid] = {
        mean: tournamentMean,
        variance: tournamentVariance,
        active: !INACTIVE_STATES.has(status),
      };
    }

    let liveOrNextRound = currentRound;
    if (currentRound > 0 && rounds[currentRound]?.status === "complete") {
      const next = currentRound + 1;
      if (rounds[next]) liveOrNextRound = next;
    }
    const top = liveOrNextRound > 0 ? rounds[liveOrNextRound] : null;
    if (!top) continue;

    playerRoundStates[pid] = {
      currentRound: liveOrNextRound,
      holesPlayed: top.holesPlayed,
      holesRemaining: top.holesRemaining,
      strokes: top.strokes,
      parPlayed: top.parPlayed,
      parRemaining: top.parRemaining,
      roundPar: top.roundPar,
      toPar: top.toPar,
      ttdPacePerHole,
      ttdHoles,
      rounds,
    };
  }

  return { playerRoundStates, tournamentProjections };
}

function currentProbFor(
  bet: TrackedBet,
  currentOdds: Record<string, number>,
  playerRoundStates: Record<string, PlayerRoundState>,
  tournamentProjections: Record<string, TournamentProjection>,
  topFinish: Record<string, TopFinishProbs>,
): number | null {
  if (bet.kind === "outright") {
    const fair = currentOdds[bet.playerId];
    if (!Number.isFinite(fair) || fair <= 1) return null;
    return 1 / fair;
  }
  if (bet.kind === "round-score") {
    const ev = evaluateRoundScore(bet, playerRoundStates[bet.playerId]);
    if (!ev) return null;
    if (ev.kind === "not-started") return null;
    if (ev.kind === "settled") return ev.won ? 1 : 0;
    return ev.prob;
  }
  if (bet.kind === "winning-score") {
    const ev = evaluateWinningScore(
      bet as WinningScoreBet,
      tournamentProjections,
    );
    if (!ev) return null;
    return ev.prob;
  }
  if (bet.kind === "top-finish") {
    const p = topFinish[bet.playerId];
    if (!p) return null;
    return bet.cutoff === 5
      ? p.top5
      : bet.cutoff === 10
      ? p.top10
      : p.top20;
  }
  return null;
}
