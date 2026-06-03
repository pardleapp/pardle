"use client";

/**
 * useRealLeaderboard — single source for /leaderboard. Prefers the
 * live orchestrator leaderboard exposed by /api/feed (same data the
 * Sweat-feed top rail already uses). Pre-tournament that payload is
 * empty, so the hook falls back to /api/field (DataGolf entrants)
 * and emits placeholder rows so the page still lists the field on
 * Memorial eve.
 *
 * Output shape is the existing LeaderboardRow so LeaderboardClientV2
 * keeps rendering without UI churn — just localStorage `bet` /
 * `following` are layered in on top.
 */

import { useEffect, useMemo, useState } from "react";
import { getFollows } from "@/app/live/FollowButton";
import { BETS_CHANGED_EVENT, readBets } from "@/app/live/bet-shared";
import type { LeaderboardRow } from "./mock-leaderboard";

const POLL_MS = 5_000;

interface ApiFeedLeaderboardRow {
  playerId: string;
  displayName: string;
  position: string;
  total: string;
  thru: string;
  playerState: string;
}

interface ApiFeedSlice {
  leaderboard: ApiFeedLeaderboardRow[];
  playerRoundStates: Record<
    string,
    {
      rounds?: Record<
        number,
        {
          status?: string;
          toPar?: number;
          holesPlayed?: number;
        }
      >;
    }
  >;
  tournament?: {
    id?: string;
    name?: string;
    isLive?: boolean;
    currentRound?: number;
  };
}

interface ApiField {
  ok: boolean;
  field: Array<{ dgId: string; name: string; country?: string }>;
}

function abbreviateName(name: string): string {
  // "Russell Henley" → "R. Henley" — matches the prototype's display
  // (mock-leaderboard used the abbreviated form). DataGolf returns
  // "First Last"; orchestrator returns "First Last" too.
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** Build the "today" cell and direction from playerRoundStates.
 *  The /api/feed leaderboard payload doesn't carry per-round to-par
 *  directly, so derive from the current round's snapshot. */
function todayForPlayer(
  playerId: string,
  feed: ApiFeedSlice,
): { today: string; dir: "up" | "down" | "flat" } {
  const state = feed.playerRoundStates[playerId];
  const currentRound = feed.tournament?.currentRound;
  if (!state?.rounds || !currentRound) return { today: "—", dir: "flat" };
  const snap = state.rounds[currentRound];
  if (!snap || typeof snap.toPar !== "number" || !snap.holesPlayed) {
    return { today: "—", dir: "flat" };
  }
  const v = snap.toPar;
  if (v === 0) return { today: "E", dir: "flat" };
  if (v < 0) return { today: `−${Math.abs(v)}`, dir: "up" };
  return { today: `+${v}`, dir: "down" };
}

/** Match a player to a tracked bet by name. The bet store carries
 *  `playerName` and `playerId` — leaderboard rows from /api/feed
 *  share the same orchestrator playerId, so prefer that match; fall
 *  back to fuzzy name match for DataGolf-only field rows. */
function betLabelForPlayer(
  playerId: string | null,
  playerName: string,
  bets: ReturnType<typeof readBets>,
): LeaderboardRow["bet"] {
  for (const b of bets) {
    if (b.settledAt) continue;
    const bid = "playerId" in b ? b.playerId : null;
    const bname = "playerName" in b ? b.playerName : "";
    const matchesId = playerId && bid === playerId;
    const matchesName =
      !matchesId &&
      bname &&
      (bname === playerName ||
        abbreviateName(bname) === playerName ||
        bname === abbreviateName(playerName));
    if (!matchesId && !matchesName) continue;
    if (b.kind === "outright") return "OUTRIGHT";
    if (b.kind === "top-finish") {
      if (b.cutoff === 5) return "TOP 5";
      if (b.cutoff === 10) return "TOP 10";
    }
    if (b.kind === "round-score") {
      const r = b.round != null ? ` · R${b.round}` : "";
      // Stay within the union's allowed values:
      if (
        b.side === "under" &&
        Math.abs(b.line - 69.5) < 0.01 &&
        b.round === 4
      ) {
        return "UNDER 69.5 · R4";
      }
      // Other round-score lines fall back to a generic OUTRIGHT-style
      // tag isn't allowed by the union; show nothing rather than lie.
      void r;
    }
  }
  return "";
}

export interface UseRealLeaderboardResult {
  rows: LeaderboardRow[];
  /** "Pre-event" | "Live · Round N" | "Final" — drives the header chip. */
  eventLine: string;
  tournamentName: string;
  ready: boolean;
  /** True when we're showing the DataGolf field placeholder rather
   *  than a live leaderboard (no scores, no thru). */
  isPreEvent: boolean;
}

export function useRealLeaderboard(): UseRealLeaderboardResult {
  const [feed, setFeed] = useState<ApiFeedSlice | null>(null);
  const [field, setField] = useState<ApiField | null>(null);
  const [follows, setFollows] = useState<string[]>([]);
  const [bets, setBets] = useState<ReturnType<typeof readBets>>([]);

  // Snapshot localStorage state on mount + when it changes (the bet
  // store + follow store both fire window events when they're
  // mutated; we listen so the tags update without a page refresh).
  useEffect(() => {
    const sync = () => {
      setFollows(getFollows());
      setBets(readBets());
    };
    sync();
    window.addEventListener("pardle-follows-changed", sync);
    window.addEventListener(BETS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("pardle-follows-changed", sync);
      window.removeEventListener(BETS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // /api/feed polling for live leaderboard.
  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/feed?v=leaderboard", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as ApiFeedSlice;
        if (!cancel) setFeed(j);
      } catch {
        // swallow; next tick retries
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  // /api/field — fetched once. Used as the fallback when the live
  // leaderboard is empty (pre-tournament).
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch("/api/field", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as ApiField;
        if (!cancel) setField(j);
      } catch {
        // ignored
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const result = useMemo<UseRealLeaderboardResult>(() => {
    const tournamentName = feed?.tournament?.name ?? "—";
    const followSet = new Set(follows);

    // Live path: real leaderboard rows present.
    if (feed && feed.leaderboard && feed.leaderboard.length > 0) {
      const rows: LeaderboardRow[] = feed.leaderboard.map((r) => {
        const today = todayForPlayer(r.playerId, feed);
        return {
          pos: r.position || "—",
          name: abbreviateName(r.displayName),
          total: r.total || "E",
          thru: r.thru || "—",
          today: today.today,
          dir: today.dir,
          following: followSet.has(r.playerId),
          bet: betLabelForPlayer(r.playerId, r.displayName, bets),
        };
      });
      const round = feed.tournament?.currentRound;
      const eventLine = round ? `Round ${round}` : "Live";
      return {
        rows,
        eventLine,
        tournamentName,
        ready: true,
        isPreEvent: false,
      };
    }

    // Pre-event path: show the DataGolf field as placeholder rows.
    if (field && field.field.length > 0) {
      const rows: LeaderboardRow[] = field.field.map((f) => ({
        pos: "—",
        name: abbreviateName(f.name),
        total: "—",
        thru: "—",
        today: "—",
        dir: "flat",
        following: false, // follows key on orchestrator playerId; pre-event we don't have one
        bet: betLabelForPlayer(null, f.name, bets),
      }));
      return {
        rows,
        eventLine: "Pre-event · field",
        tournamentName,
        ready: true,
        isPreEvent: true,
      };
    }

    return {
      rows: [],
      eventLine: feed ? "—" : "Loading…",
      tournamentName,
      ready: feed != null || field != null,
      isPreEvent: false,
    };
  }, [feed, field, follows, bets]);

  return result;
}
