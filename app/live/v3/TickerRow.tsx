"use client";

/**
 * Compact one-line row for routine feed events in v3. Bypasses the
 * heavier ShotPost for events ranked as "ticker" so the reader can
 * scan the field's routine chatter at a glance.
 *
 *   14:32 · R. Fox · 5th · BOGEY · +2
 *
 * Actions (react, comment, share) reveal on hover as a small strip
 * to the right. Same functionality as a hero card, just tucked away
 * so it doesn't shout on every row.
 */

import type { FeedEvent } from "@/lib/feed/types";

interface Props {
  event: FeedEvent;
  isMine: boolean;
  onReact?: () => void;
  onOpen?: () => void;
}

function shortPlayer(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const first = parts[0][0];
  const last = parts.slice(1).join(" ");
  return `${first}. ${last}`;
}

function holeLabel(ev: FeedEvent): string {
  if (typeof ev.hole !== "number") return "";
  const suffix = (n: number) => {
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    if (n % 10 === 1) return "st";
    if (n % 10 === 2) return "nd";
    if (n % 10 === 3) return "rd";
    return "th";
  };
  return `${ev.hole}${suffix(ev.hole)}`;
}

function tagClass(ev: FeedEvent): string {
  if (!ev.result) return "feed-v3-ticker-tag-par";
  return `feed-v3-ticker-tag-${ev.result}`;
}

function tagLabel(ev: FeedEvent): string {
  if (ev.ace) return "ACE";
  if (!ev.result) return ev.type.toUpperCase();
  return ev.result === "triple-plus" ? "TRIP+" : ev.result.toUpperCase();
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatToPar(toPar: string | undefined): string {
  if (!toPar) return "";
  // Feed events come pre-formatted ("+3", "-2", "E"). Normalise the
  // ASCII hyphen to a Unicode minus so digits align cleanly with the
  // mono column.
  return toPar.replace(/^-/, "−");
}

export default function TickerRow({ event, isMine, onReact, onOpen }: Props) {
  const cls = ["feed-v3-ticker"];
  if (isMine) cls.push("feed-v3-mine");
  return (
    <div
      className={cls.join(" ")}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
      title={event.headline ?? undefined}
    >
      <span className="feed-v3-ticker-time">{formatClock(event.ts)}</span>
      <span className="feed-v3-ticker-headline">
        <span className="feed-v3-ticker-player">
          {shortPlayer(event.playerName)}
        </span>
        {event.hole != null && (
          <>
            {" · "}
            <span className="feed-v3-ticker-hole">{holeLabel(event)}</span>
          </>
        )}
      </span>
      <span className={`feed-v3-ticker-tag ${tagClass(event)}`}>
        {tagLabel(event)}
      </span>
      <span className="feed-v3-ticker-score">
        {formatToPar(event.toPar)}
      </span>
      <span className="feed-v3-ticker-actions">
        <button
          type="button"
          className="feed-v3-ticker-action"
          onClick={(e) => {
            e.stopPropagation();
            onReact?.();
          }}
          aria-label="React"
          title="React"
        >
          ♡
        </button>
      </span>
    </div>
  );
}
