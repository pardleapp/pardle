"use client";

/**
 * ShotsReel — single horizontal-scroll strip combining best + worst
 * shots into one "⛳ Shots of the day" reel. Sits partway down the
 * Sweat Feed and inside the player page's This-week tab.
 *
 * Each card shows:
 *   - a small shot diagram (existing ShotTracer when coords are
 *     available, stylised fallback when not)
 *   - the punchy headline ("Hole-out from 150" / "4-putt from 6 ft")
 *   - player initials + Hxx + result tag (BIRDIE / BLOW-UP / …)
 *
 * Tap a card → opens the ShotShareCard so a one-tap share-out is
 * always available (best + worst both drive viral sharing).
 *
 * Data: takes pre-curated FeedRow[] from /api/feed.bestReel and
 * data.worstReel — same source the old desktop sidebar used.
 */

import type { FeedEvent, FeedRow, ScoreResult } from "@/lib/feed/types";
import { abbreviateName } from "@/lib/text/abbreviate";
import ShotDiagram from "./ShotDiagram";

interface Props {
  best: FeedRow[];
  worst: FeedRow[];
  /** Optional player filter — when set, only show shots by this
   *  player. Used on the player page This-week tab. */
  playerId?: string;
  /** Tournament label kept around for analytics + future contexts —
   *  the share card itself is now opened from ShotDetail, which the
   *  parent mounts. */
  tournamentLabel?: string;
  /** Override the strip's heading — e.g. "⛳ This week" on the
   *  player page. Defaults to "⛳ Shots of the day". */
  title?: string;
  /** Tap-through handler — parent opens the full ShotDetail
   *  overlay. Was an internal share-modal before. */
  onTapShot: (event: FeedEvent) => void;
}

function tagFor(
  ace: boolean | undefined,
  result: ScoreResult | undefined,
): { label: string; tone: "good" | "bad" } | null {
  if (ace) return { label: "ACE", tone: "good" };
  switch (result) {
    case "albatross":
      return { label: "ALBATROSS", tone: "good" };
    case "eagle":
      return { label: "EAGLE", tone: "good" };
    case "birdie":
      return { label: "BIRDIE", tone: "good" };
    case "bogey":
      return { label: "BOGEY", tone: "bad" };
    case "double":
      return { label: "DOUBLE", tone: "bad" };
    case "triple-plus":
      return { label: "BLOW-UP", tone: "bad" };
    default:
      return null;
  }
}

function ReelCard({
  row,
  onTap,
}: {
  row: FeedRow;
  onTap: (row: FeedRow) => void;
}) {
  const ev = row.event;
  const tag = tagFor(ev.ace, ev.result);
  const initials = abbreviateName(ev.playerName)
    .split(" ")
    .pop()
    ?.slice(0, 2)
    .toUpperCase() ?? "PP";
  return (
    <button
      type="button"
      className={`shots-reel-card${
        ev.lowlight ? " shots-reel-card-bad" : " shots-reel-card-good"
      }`}
      onClick={() => onTap(row)}
    >
      <div className="shots-reel-diag">
        <ShotDiagram event={ev} size="thumb" />
      </div>
      <div className="shots-reel-body">
        {tag && (
          <span className={`shots-reel-tag shots-reel-tag-${tag.tone}`}>
            {tag.label}
          </span>
        )}
        <div className="shots-reel-head">{ev.headline}</div>
        <div className="shots-reel-meta">
          <span className="shots-reel-av" aria-hidden="true">
            {initials}
          </span>
          <span className="shots-reel-name">
            {abbreviateName(ev.playerName)}
          </span>
          {typeof ev.hole === "number" && (
            <span className="shots-reel-hole">H{ev.hole}</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function ShotsReel({
  best,
  worst,
  playerId,
  title = "⛳ Shots of the day",
  onTapShot,
}: Props) {
  // Combine best + worst, alternating for visual variety, deduped by
  // event id so a shot tagged both ways doesn't render twice.
  const seen = new Set<string>();
  const interleaved: FeedRow[] = [];
  const maxLen = Math.max(best.length, worst.length);
  for (let i = 0; i < maxLen; i++) {
    if (best[i] && !seen.has(best[i].event.id)) {
      seen.add(best[i].event.id);
      interleaved.push(best[i]);
    }
    if (worst[i] && !seen.has(worst[i].event.id)) {
      seen.add(worst[i].event.id);
      interleaved.push(worst[i]);
    }
  }
  const rows = playerId
    ? interleaved.filter((r) => r.event.playerId === playerId)
    : interleaved;

  if (rows.length === 0) return null;

  return (
    <section className="shots-reel">
      <h3 className="shots-reel-title">{title}</h3>
      <div className="shots-reel-track" role="list">
        {rows.map((r) => (
          <div role="listitem" key={r.event.id}>
            <ReelCard row={r} onTap={(row) => onTapShot(row.event)} />
          </div>
        ))}
      </div>
    </section>
  );
}
