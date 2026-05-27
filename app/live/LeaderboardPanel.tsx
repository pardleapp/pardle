"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import { abbreviateName } from "@/lib/text/abbreviate";
import PlayerAvatar from "./PlayerAvatar";
import PlayerCardPanel from "./PlayerCardPanel";
import RecentFormSparkline, {
  type RecentEvent,
} from "./RecentFormSparkline";

interface RecentFormEntry {
  name: string;
  recent: RecentEvent[];
}

interface Props {
  rows: CachedLeaderboardRow[];
  /**
   * `tab` = lives on its own tab (no header, render every row, click
   * a row to expand an inline scorecard).
   * `inline` (default) = small panel inside the main feed view.
   */
  mode?: "inline" | "tab";
  /** Map of playerId → recent form. Renders the sparkline inline
   *  alongside each row when supplied. */
  recentForm?: Record<string, RecentFormEntry>;
  /** Hot/cold-hand status keyed by playerId. */
  handStatus?: Record<string, "hot" | "cold">;
}

function trendFor(recent: RecentEvent[]): "up" | "down" | "flat" {
  if (recent.length < 5) return "flat";
  const scoreOf = (e: RecentEvent) =>
    e.finishPos ?? (e.madeCut ? 80 : 90);
  const newer = (scoreOf(recent[0]) + scoreOf(recent[1]) + scoreOf(recent[2])) / 3;
  const older = (scoreOf(recent[3]) + scoreOf(recent[4])) / 2;
  const diff = older - newer;
  if (diff > 8) return "up";
  if (diff < -8) return "down";
  return "flat";
}

export default function LeaderboardPanel({
  rows,
  mode = "inline",
  recentForm,
  handStatus,
}: Props) {
  const isTab = mode === "tab";
  // Single-open accordion: only one expansion at a time keeps the
  // page tight and stops users losing their place after toggling
  // four rows in a row.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Collapse the expansion whenever the leaderboard reshuffles enough
  // that the open row's position moved more than ±2. Prevents the
  // user's expanded view from drifting silently off-screen as live
  // shots reorder the field.
  useEffect(() => {
    if (!expandedId) return;
    const stillThere = rows.some((r) => r.playerId === expandedId);
    if (!stillThere) setExpandedId(null);
  }, [rows, expandedId]);

  const toggle = useCallback((id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  if (rows.length === 0) return null;
  return (
    <section className={`lb-panel ${isTab ? "lb-panel-tab" : ""}`}>
      {!isTab && (
        <p className="lb-header">Leaderboard · top {rows.length}</p>
      )}
      <ol className="lb-list">
        {rows.map((r) => {
          const form = recentForm?.[r.playerId];
          const hand = handStatus?.[r.playerId];
          const isExpanded = expandedId === r.playerId;
          return (
            <li
              key={r.playerId}
              className={`lb-row-wrap ${isExpanded ? "lb-row-open" : ""}`}
            >
              {isTab ? (
                <button
                  type="button"
                  className="lb-row lb-row-button"
                  aria-expanded={isExpanded}
                  onClick={() => toggle(r.playerId)}
                >
                  <RowContents
                    row={r}
                    hand={hand}
                    form={form}
                    showChevron
                    isExpanded={isExpanded}
                  />
                </button>
              ) : (
                <Link href={`/live/player/${r.playerId}`} className="lb-row">
                  <RowContents row={r} hand={hand} form={form} />
                </Link>
              )}
              {isTab && isExpanded && (
                <PlayerCardPanel playerId={r.playerId} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RowContents({
  row,
  hand,
  form,
  showChevron,
  isExpanded,
}: {
  row: CachedLeaderboardRow;
  hand?: "hot" | "cold";
  form?: RecentFormEntry;
  showChevron?: boolean;
  isExpanded?: boolean;
}) {
  return (
    <>
      <span className="lb-pos">{row.position}</span>
      <PlayerAvatar
        playerId={row.playerId}
        playerName={row.displayName}
        size="sm"
        state={hand ?? null}
      />
      <span className="lb-name">
        {hand && (
          <span
            className={`hand-badge hand-badge-${hand}`}
            aria-hidden="true"
          >
            {hand === "hot" ? "🔥" : "🥶"}
          </span>
        )}
        {abbreviateName(row.displayName)}
      </span>
      {form && (
        <RecentFormSparkline
          recent={form.recent}
          trend={trendFor(form.recent)}
          mode="compact"
        />
      )}
      <span className="lb-score">
        <span className="lb-total">{row.total}</span>
        <span className="lb-thru">{row.thru}</span>
      </span>
      {showChevron && (
        <span
          className={`lb-chev ${isExpanded ? "lb-chev-open" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      )}
    </>
  );
}
