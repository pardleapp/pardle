"use client";

/**
 * useRealBets — single source for /bets to consume the user's REAL
 * tracked bets, valued live via the same data path the /live BetTracker
 * uses (/api/feed → currentValueForBet → detectBetSettlement). Output
 * shape is the existing MockBetLive / MockBetSettled so BetsClient.tsx
 * and BetRow.tsx keep rendering without UI churn.
 *
 * Load: same canonical pattern as BetTracker.tsx — localStorage seed
 * first, then on sign-in migrate + fetch /api/bets and merge with
 * mergeServerAndLocal so server wins on conflict.
 *
 * Value: polls /api/feed every 5s (vs BetTracker's 3s — /bets is a
 * secondary surface, lower cadence is fine and saves a request/sec).
 * Pre-tournament currentOdds is empty so live prob falls back to the
 * placement-implied prob and the row reads "flat" — bet visible,
 * numbers quiet, as expected tonight.
 */

import { useEffect, useMemo, useState } from "react";
import {
  type OutrightBet,
  type RoundScoreBet,
  type TopFinishBet,
  type TrackedBet,
  type WinningScoreBet,
  type PlayerRoundState,
  type TournamentProjection,
  type TopFinishProbs,
  BETS_CHANGED_EVENT,
  currentValueForBet,
  detectBetSettlement,
  evaluateRoundScore,
  mergeServerAndLocal,
  readBets,
  resolveBetPlayerId,
  writeBets,
} from "@/app/live/bet-shared";
import {
  normaliseBetCurrency,
  type BetCurrency,
} from "@/lib/format/bet-currency";
import { formatOdds } from "@/lib/odds-format";
import { useAuth } from "@/app/live/auth/useAuth";
import type {
  MockBetLive,
  MockBetSettled,
  MockBetLiveOdds,
} from "./mock-bets";

interface FeedSlice {
  currentOdds: Record<string, number>;
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections?: Record<string, TournamentProjection>;
  topFinishCurrent?: Record<string, TopFinishProbs>;
  /** Recent feed events keyed by playerId — used for shot-by-shot. */
  recentByPlayer: Record<
    string,
    Array<{ headline: string; result?: string }>
  >;
  leaderboardById: Record<
    string,
    { displayName: string; position: string; thru: string; playerState?: string }
  >;
}

const POLL_MS = 5_000;

function currencySymbol(c: BetCurrency): "£" | "$" {
  return c === "USD" ? "$" : "£";
}

function oddsTriple(decimal: number): MockBetLiveOdds {
  return {
    dec: formatOdds(decimal, "decimal"),
    frac: formatOdds(decimal, "fractional"),
    am: formatOdds(decimal, "american"),
  };
}

function marketLabel(bet: TrackedBet): string {
  if (bet.kind === "outright") return "OUTRIGHT WIN";
  if (bet.kind === "top-finish") return `TOP ${bet.cutoff}`;
  if (bet.kind === "round-score") {
    const round = bet.round != null ? ` · R${bet.round}` : "";
    return `${bet.side.toUpperCase()} ${bet.line}${round}`;
  }
  return `${bet.side.toUpperCase()} ${bet.line} · TOT`;
}

function liveProbFor(bet: TrackedBet, slice: FeedSlice): number | null {
  // Reconcile dg-* / legacy ids to the live orchestrator id by name
  // before keying into the state maps. Without this, every pre-
  // tournament-placed bet reads null state and shows "Settling soon".
  const leaderboardForResolve = Object.entries(slice.leaderboardById).map(
    ([playerId, info]) => ({ playerId, displayName: info.displayName }),
  );
  const pid = resolveBetPlayerId(bet, leaderboardForResolve);
  if (bet.kind === "outright") {
    const decimal = slice.currentOdds[pid || (bet as OutrightBet).playerId];
    if (Number.isFinite(decimal) && decimal > 1) return 1 / decimal;
    return null;
  }
  if (bet.kind === "top-finish") {
    const snap =
      slice.topFinishCurrent?.[pid || (bet as TopFinishBet).playerId];
    if (!snap) return null;
    const cutoff = (bet as TopFinishBet).cutoff;
    const key = `top${cutoff}` as keyof TopFinishProbs;
    const v = snap[key];
    return typeof v === "number" ? v : null;
  }
  if (bet.kind === "round-score") {
    const ev = evaluateRoundScore(
      bet as RoundScoreBet,
      slice.playerRoundStates[pid || (bet as RoundScoreBet).playerId],
    );
    if (!ev) return null;
    if (ev.kind === "not-started") {
      const o = (bet as RoundScoreBet).oddsTaken;
      return Number.isFinite(o) && o > 1 ? 1 / o : null;
    }
    if (ev.kind === "settled") return ev.won ? 1 : 0;
    return ev.prob;
  }
  return null; // winning-score live prob would need extra plumbing; falls back below
}

function playerIdOf(bet: TrackedBet): string | null {
  return "playerId" in bet ? (bet as { playerId: string }).playerId : null;
}

function adaptToLive(
  bet: TrackedBet,
  slice: FeedSlice,
): MockBetLive {
  const oddsTaken = Number(bet.oddsTaken);
  const placementProb =
    Number.isFinite(oddsTaken) && oddsTaken > 1 ? 1 / oddsTaken : null;
  const live = liveProbFor(bet, slice);
  const prob =
    live != null
      ? Math.round(live * 100)
      : placementProb != null
        ? Math.round(placementProb * 100)
        : 0;
  const dir: "up" | "down" =
    live != null && placementProb != null && live < placementProb - 0.005
      ? "down"
      : "up";

  // Build a tiny 2-point sparkline from placement → live so the row
  // has SOMETHING to render even before history accumulates.
  const hist: number[] =
    placementProb != null && live != null
      ? [Math.round(placementProb * 100), Math.round(live * 100)]
      : placementProb != null
        ? [Math.round(placementProb * 100), Math.round(placementProb * 100)]
        : [0, 0];

  // Shot-by-shot — newest first, capped at 3.
  const pid = playerIdOf(bet);
  const recent = pid ? slice.recentByPlayer[pid] ?? [] : [];
  const tl: MockBetLive["tl"] = recent.slice(0, 3).map((r) => {
    let d: "up" | "down" | "flat" = "flat";
    if (
      r.result === "birdie" ||
      r.result === "eagle" ||
      r.result === "albatross"
    ) {
      d = "up";
    } else if (
      r.result === "bogey" ||
      r.result === "double" ||
      r.result === "triple-plus"
    ) {
      d = "down";
    }
    return [r.headline, d === "flat" ? "—" : d === "up" ? "▲" : "▼", d];
  });

  const cur = currencySymbol(normaliseBetCurrency(bet.currency));
  const playerName =
    "playerName" in bet && bet.playerName
      ? bet.playerName
      : bet.kind === "winning-score"
        ? "Winner"
        : "Player";

  return {
    id: bet.id,
    who: playerName,
    mine: true,
    on: [],
    mkt: marketLabel(bet),
    cur,
    stake: bet.stake,
    odds: oddsTriple(oddsTaken),
    prob,
    dir,
    hist,
    tl,
  };
}

function adaptToSettled(bet: TrackedBet): MockBetSettled {
  const cur = currencySymbol(normaliseBetCurrency(bet.currency));
  const oddsLabel = bet.oddsTakenLabel || formatOdds(bet.oddsTaken, "decimal");
  const won = bet.settledWon === true;
  const winAmount = Math.round(bet.stake * (bet.oddsTaken - 1));
  const pl = won
    ? `+${cur}${winAmount.toLocaleString("en-US")}`
    : `−${cur}${bet.stake.toLocaleString("en-US")}`;
  const playerName =
    "playerName" in bet && bet.playerName
      ? bet.playerName
      : bet.kind === "winning-score"
        ? "Winner"
        : "Player";
  return {
    id: bet.id,
    who: playerName,
    mkt: marketLabel(bet),
    odds: oddsLabel,
    cur,
    stake: bet.stake,
    result: won ? "WON" : "LOST",
    pl,
  };
}

function buildSlice(json: unknown): FeedSlice {
  const j = (json ?? {}) as {
    currentOdds?: Record<string, number>;
    playerRoundStates?: Record<string, PlayerRoundState>;
    tournamentProjections?: Record<string, TournamentProjection>;
    topFinishCurrent?: Record<string, TopFinishProbs>;
    rows?: Array<{
      event?: {
        playerId?: string;
        headline?: string;
        result?: string;
      };
    }>;
    leaderboard?: Array<{
      playerId: string;
      displayName: string;
      position: string;
      thru: string;
      playerState?: string;
    }>;
  };
  const recentByPlayer: FeedSlice["recentByPlayer"] = {};
  for (const row of j.rows ?? []) {
    const pid = row?.event?.playerId;
    const headline = row?.event?.headline;
    if (!pid || !headline) continue;
    const bucket = (recentByPlayer[pid] ??= []);
    if (bucket.length < 3) {
      bucket.push({ headline, result: row.event?.result });
    }
  }
  const leaderboardById: FeedSlice["leaderboardById"] = {};
  for (const r of j.leaderboard ?? []) {
    leaderboardById[r.playerId] = {
      displayName: r.displayName,
      position: r.position,
      thru: r.thru,
      playerState: r.playerState,
    };
  }
  return {
    currentOdds: j.currentOdds ?? {},
    playerRoundStates: j.playerRoundStates ?? {},
    tournamentProjections: j.tournamentProjections,
    topFinishCurrent: j.topFinishCurrent,
    recentByPlayer,
    leaderboardById,
  };
}

export interface UseRealBetsResult {
  live: MockBetLive[];
  settled: MockBetSettled[];
  /** True once the first bet-load + first /api/feed fetch have settled. */
  ready: boolean;
  /** Raw count, regardless of settled state. */
  total: number;
}

export function useRealBets(): UseRealBetsResult {
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [slice, setSlice] = useState<FeedSlice | null>(null);
  const { user } = useAuth();

  // Hydrate from localStorage on mount, then on every BETS_CHANGED
  // event (sheet submit, BetTracker addBet, removal). Native storage
  // events only fire cross-tab; the custom event covers same-tab
  // updates so a placed bet shows up here instantly without reload.
  useEffect(() => {
    const sync = () => setBets(readBets());
    sync();
    setHydrated(true);
    window.addEventListener(BETS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BETS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Migrate + merge from server on sign-in.
  useEffect(() => {
    if (!hydrated || !user) return;
    let cancel = false;
    (async () => {
      try {
        let local = readBets();
        if (local.length > 0) {
          await fetch("/api/bets/migrate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bets: local }),
          });
        }
        const res = await fetch("/api/bets", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          bets: TrackedBet[];
          removedIds?: string[];
        };
        if (cancel) return;
        if (json.removedIds?.length) {
          const removed = new Set(json.removedIds);
          local = local.filter((b) => !removed.has(b.id));
        }
        const merged = mergeServerAndLocal(json.bets ?? [], local);
        setBets(merged);
        writeBets(merged);
      } catch {
        // Network blip — localStorage view stays.
      }
    })();
    return () => {
      cancel = true;
    };
  }, [hydrated, user]);

  // Poll /api/feed for live state.
  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/feed?v=bets", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancel) setSlice(buildSlice(j));
      } catch {
        // ignore; next tick retries
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  const { live, settled } = useMemo(() => {
    const liveOut: MockBetLive[] = [];
    const settledOut: MockBetSettled[] = [];
    const s = slice ?? buildSlice({});
    // Newest first.
    const sorted = [...bets].sort((a, b) => b.placedAt - a.placedAt);
    for (const b of sorted) {
      if (b.settledAt != null && b.settledWon != null) {
        settledOut.push(adaptToSettled(b));
        continue;
      }
      // Try one more detection pass in case the live engine has
      // already decided settlement but the bet record isn't patched.
      if (s.leaderboardById && b.kind !== "round-score") {
        const players = Object.entries(s.leaderboardById).map(
          ([playerId, info]) => ({
            playerId,
            position: info.position,
            thru: info.thru,
            playerState: info.playerState,
          }),
        );
        const decision = detectBetSettlement(
          b as OutrightBet | TopFinishBet | WinningScoreBet,
          players,
          s.playerRoundStates,
          s.tournamentProjections ?? {},
        );
        if (decision) {
          const patched = { ...b, settledWon: decision.won } as TrackedBet;
          settledOut.push(adaptToSettled(patched));
          continue;
        }
      }
      liveOut.push(adaptToLive(b, s));
    }
    return { live: liveOut, settled: settledOut };
  }, [bets, slice]);

  // Suppress unused-import lint for currentValueForBet — kept available
  // for any caller wiring deeper bet-detail views in the future.
  void currentValueForBet;

  return {
    live,
    settled,
    ready: hydrated && slice != null,
    total: bets.length,
  };
}
