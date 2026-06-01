"use client";

/**
 * BetStrip — collects active tracked bets and renders them as a row
 * of BetPosts above the shot feed. Wraps each bet in its own error
 * boundary so a single malformed bet's crash doesn't take down the
 * surrounding strip; the strip itself is wrapped at its mount site
 * (FeedClient) in an outer boundary so even an IIFE-level crash stays
 * contained.
 *
 * Pulled out of FeedClient.tsx so the React tree has a proper boundary
 * <-> component-render relationship: errors thrown during BetStrip's
 * render now actually propagate to the boundary around <BetStrip />,
 * instead of leaking out of FeedClient itself (the prior failure
 * mode).
 */

import type { FeedRow } from "@/lib/feed/types";
import type { TrackedBet } from "./bet-shared";
import BetPost from "./BetPost";
import BetPostErrorBoundary from "./BetPostErrorBoundary";

interface BetStripProps {
  trackedBets: TrackedBet[];
  rows: FeedRow[];
  currentOdds: Record<string, number>;
  topFinishCurrent?: Record<
    string,
    { top5: number; top10: number; top20: number }
  >;
  oddsHistories: Record<string, Array<{ ts: number; p: number }> | null>;
}

export default function BetStrip({
  trackedBets,
  rows,
  currentOdds,
  topFinishCurrent,
  oddsHistories,
}: BetStripProps) {
  const activeBets = (trackedBets ?? []).filter(
    (b) =>
      b &&
      b.settledAt == null &&
      (b.kind === "outright" ||
        b.kind === "top-finish" ||
        b.kind === "round-score"),
  );
  if (activeBets.length === 0) return null;
  const ordered = [...activeBets].sort(
    (a, b) => (b.placedAt ?? 0) - (a.placedAt ?? 0),
  );
  return (
    <div className="pv-bet-strip">
      <div className="pv-section-label">Your bets · live</div>
      <div className="pv-bet-strip-list">
        {ordered.map((bet) => {
          const playerId = "playerId" in bet ? String(bet.playerId ?? "") : "";
          const rowsForPlayer = playerId
            ? (rows ?? [])
                .filter((r) => r?.event?.playerId === playerId)
                .slice(0, 3)
            : [];
          return (
            <BetPostErrorBoundary key={bet.id} label={bet.id}>
              <BetPost
                bet={bet}
                currentOdds={currentOdds}
                topFinishCurrent={topFinishCurrent}
                recentRowsForPlayer={rowsForPlayer}
                oddsHistory={
                  playerId ? (oddsHistories?.[playerId] ?? null) : null
                }
              />
            </BetPostErrorBoundary>
          );
        })}
      </div>
    </div>
  );
}
