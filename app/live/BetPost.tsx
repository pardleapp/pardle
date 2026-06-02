"use client";

/**
 * BetPost — diagnostic-defensive version. Every field read goes
 * through `safe()` so a single malformed bet renders with "?"
 * placeholders instead of crashing the whole page. Console.error
 * logs the bet id + the operation that threw, so we can see in
 * devtools which field is breaking.
 */

import Link from "next/link";
import PlayerAvatar from "./PlayerAvatar";
import type { TrackedBet } from "./bet-shared";
import type { FeedRow } from "@/lib/feed/types";
import {
  formatBetCurrency,
  normaliseBetCurrency,
} from "@/lib/format/bet-currency";
import { betKindShortLabel } from "./bet-impact";
import { useHoldReact } from "./useHoldReact";
import ReactionChips, { type ReactionState } from "./ReactionChips";

interface BetPostProps {
  bet: TrackedBet;
  /** Hold-and-pick reaction callback — parent triggers the float-up
   *  burst (same plumbing the ShotPost / CrewBetPost surfaces use). */
  onCustomReact?: (emoji: string) => void;
  /** Aggregated emoji reactions for this card. */
  reactionState?: ReactionState;
  /** Tap-toggle an existing chip's reaction. */
  onToggleReaction?: (emoji: string) => void;
  currentOdds: Record<string, number>;
  topFinishCurrent?: Record<
    string,
    { top5: number; top10: number; top20: number }
  >;
  recentRowsForPlayer: FeedRow[];
  oddsHistory?: Array<{ ts: number; p: number }> | null;
}

function safe<T>(label: string, fn: () => T, fallback: T, betId: string): T {
  try {
    return fn();
  } catch (e) {
    if (typeof console !== "undefined") {
      console.error(`[BetPost ${betId}] ${label} threw`, e);
    }
    return fallback;
  }
}

function timeAgo(ms: number | undefined | null): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function BetPost({
  bet,
  currentOdds,
  topFinishCurrent,
  recentRowsForPlayer,
  onCustomReact,
  reactionState,
  onToggleReaction,
}: BetPostProps) {
  const betId = safe("read id", () => String(bet?.id ?? "?"), "?", "?");
  // Whole-card press-and-hold → emoji tray. Quick tap = Link nav
  // (the Link handles it natively); the hook's onTap is undefined
  // because the link already covers that case.
  const { surfaceProps, tray } = useHoldReact({
    onReact: (emoji) => onCustomReact?.(emoji),
  });

  const playerName = safe(
    "read playerName",
    () => ("playerName" in bet ? String(bet.playerName ?? "?") : "?"),
    "?",
    betId,
  );
  const playerId = safe(
    "read playerId",
    () => ("playerId" in bet ? String(bet.playerId ?? "") : ""),
    "",
    betId,
  );
  const kindLabel = safe(
    "read kind label",
    () => betKindShortLabel(bet).toUpperCase(),
    "BET",
    betId,
  );
  const currency = safe(
    "read currency",
    () => normaliseBetCurrency(bet.currency),
    "GBP" as const,
    betId,
  );
  const stakeLabel = safe(
    "format stake",
    () =>
      formatBetCurrency(Number(bet.stake) || 0, currency, {
        maximumFractionDigits: 0,
      }),
    "—",
    betId,
  );
  const oddsLabel = safe(
    "read odds label",
    () => String(bet.oddsTakenLabel ?? ""),
    "",
    betId,
  );
  const tm = safe("format time", () => timeAgo(bet.placedAt), "—", betId);

  const oddsTaken = Number(bet.oddsTaken);
  const placementProb =
    Number.isFinite(oddsTaken) && oddsTaken > 1 ? 1 / oddsTaken : null;

  let liveProb: number | null = null;
  if (bet.kind === "outright" && playerId) {
    const p = currentOdds?.[playerId];
    if (typeof p === "number" && p >= 0 && p <= 1) liveProb = p;
  } else if (bet.kind === "top-finish" && playerId) {
    const snap = topFinishCurrent?.[playerId];
    if (snap) {
      const k = `top${bet.cutoff}` as keyof typeof snap;
      const v = snap[k];
      if (typeof v === "number" && v >= 0 && v <= 1) liveProb = v;
    }
  }

  const probPct =
    liveProb != null
      ? Math.round(liveProb * 100)
      : placementProb != null
        ? Math.round(placementProb * 100)
        : null;

  const dir: "up" | "down" | "flat" =
    liveProb != null && placementProb != null
      ? Math.abs(liveProb - placementProb) < 0.005
        ? "flat"
        : liveProb > placementProb
          ? "up"
          : "down"
      : "flat";

  const updates: Array<{ text: string; dir: "up" | "down" | "flat" }> = [];
  for (const row of recentRowsForPlayer.slice(0, 3)) {
    try {
      const ev = row?.event;
      if (!ev) continue;
      const text = String(ev.headline ?? "");
      let updDir: "up" | "down" | "flat" = "flat";
      if (
        ev.result === "birdie" ||
        ev.result === "eagle" ||
        ev.result === "albatross"
      ) {
        updDir = "up";
      } else if (
        ev.result === "bogey" ||
        ev.result === "double" ||
        ev.result === "triple-plus"
      ) {
        updDir = "down";
      }
      updates.push({ text, dir: updDir });
    } catch (e) {
      console.error(`[BetPost ${betId}] update build threw`, e);
    }
  }

  return (
    <>
    <Link
      href={`/live/bet/${betId}`}
      className={`post bpost${dir === "down" ? " down" : ""}`}
      {...surfaceProps}
    >
      <div className="bp-head">
        <PlayerAvatar
          playerId={playerId}
          playerName={playerName}
          size="md"
        />
        <div className="bp-who">
          <div className="bp-who-nm">
            <span>You</span>
            <span className="bp-who-verb">are sweating</span>
          </div>
          <div className="bp-who-tm">{tm} ago · live</div>
        </div>
        <div className="bp-prob">
          <div
            className="bp-prob-v"
            style={{
              color:
                dir === "down"
                  ? "var(--pv-down)"
                  : dir === "up"
                    ? "var(--pv-up)"
                    : "var(--pv-ink)",
            }}
          >
            {probPct != null ? `${probPct}%` : "—"}
          </div>
          <div className={`bp-prob-d ${dir}`}>
            {dir === "up" ? "▲" : dir === "down" ? "▼" : "·"} live
          </div>
        </div>
      </div>
      <div className="bp-bet">
        <span className="bp-bet-player">{playerName}</span>
        <span className="bp-bet-mkt">{kindLabel}</span>
        <span className="bp-bet-stake">
          {stakeLabel} @ {oddsLabel}
        </span>
      </div>
      {updates.length > 0 && (
        <div className="bp-thread">
          {updates.map((u, i) => (
            <div className="bp-upd" key={i}>
              <span className={`bp-upd-dot ${u.dir}`} />
              <span className="bp-upd-text">{u.text}</span>
            </div>
          ))}
        </div>
      )}
      {reactionState && onToggleReaction && (
        <ReactionChips
          state={reactionState}
          onToggle={onToggleReaction}
        />
      )}
    </Link>
    {tray}
    </>
  );
}
