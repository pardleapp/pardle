"use client";

import Link from "next/link";
import type { FeedRow } from "@/lib/feed/types";

interface Props {
  rows: FeedRow[];
}

/**
 * "Shots of the Day" — a horizontal reel of the best moments
 * (aces, albatrosses, eagles, stuffed approaches). Built by filtering
 * the feed rows the page already has; each card links to the player.
 */
export default function HighlightsReel({ rows }: Props) {
  const highlights = rows.filter((r) => r.event.highlight).slice(0, 24);
  if (highlights.length === 0) return null;

  return (
    <section className="reel">
      <h3 className="reel-title">⛳ Shots of the day</h3>
      <div className="reel-scroll">
        {highlights.map(({ event, reactions }) => (
          <Link
            key={event.id}
            href={`/live/player/${event.playerId}`}
            className={`reel-card reel-card-${
              event.ace
                ? "ace"
                : event.type === "shot"
                ? "shot"
                : event.result ?? "other"
            }`}
          >
            <span className="reel-emoji" aria-hidden="true">
              {event.emoji}
            </span>
            <span className="reel-headline">{event.headline}</span>
            <span className="reel-meta">
              R{event.round} · 👍 {reactions.up}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
