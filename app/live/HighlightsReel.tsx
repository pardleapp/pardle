"use client";

import Link from "next/link";
import type { FeedEvent, FeedRow } from "@/lib/feed/types";

interface Props {
  rows: FeedRow[];
  myReactions: Record<string, "up" | "down">;
  onReact: (eventId: string, dir: "up" | "down") => void;
}

/**
 * A moment belongs in the reel if the engine flagged it OR — for events
 * created before the highlight flag existed — its own fields qualify it
 * (an ace, albatross, eagle, or a stuffed-approach shot event).
 */
function isHighlight(e: FeedEvent): boolean {
  if (e.highlight) return true;
  if (e.ace) return true;
  if (e.result === "albatross" || e.result === "eagle") return true;
  if (e.type === "shot") return true;
  return false;
}

/**
 * "Shots of the Day" — a horizontal reel of the best moments
 * (aces, albatrosses, eagles, stuffed approaches). The headline links
 * to the player card; the 👍 / 👎 buttons react in place, sharing the
 * feed's reaction handler so counts stay in sync everywhere.
 */
export default function HighlightsReel({
  rows,
  myReactions,
  onReact,
}: Props) {
  const highlights = rows
    .filter((r) => isHighlight(r.event))
    .slice(0, 24);
  if (highlights.length === 0) return null;

  return (
    <section className="reel">
      <h3 className="reel-title">⛳ Shots of the day</h3>
      <div className="reel-scroll">
        {highlights.map(({ event, reactions }) => {
          const mine = myReactions[event.id];
          return (
            <div
              key={event.id}
              className={`reel-card reel-card-${
                event.ace
                  ? "ace"
                  : event.type === "shot"
                  ? "shot"
                  : event.result ?? "other"
              }`}
            >
              <Link
                href={`/live/player/${event.playerId}`}
                className="reel-card-body"
              >
                <span className="reel-emoji" aria-hidden="true">
                  {event.emoji}
                </span>
                <span className="reel-headline">{event.headline}</span>
                <span className="reel-meta">R{event.round} · view card →</span>
              </Link>
              <div className="reel-react-row">
                <button
                  type="button"
                  className={`feed-react ${mine === "up" ? "feed-react-on" : ""}`}
                  onClick={() => onReact(event.id, "up")}
                  aria-label="Like"
                >
                  👍 {reactions.up > 0 ? reactions.up : ""}
                </button>
                <button
                  type="button"
                  className={`feed-react ${mine === "down" ? "feed-react-on" : ""}`}
                  onClick={() => onReact(event.id, "down")}
                  aria-label="Dislike"
                >
                  👎 {reactions.down > 0 ? reactions.down : ""}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
