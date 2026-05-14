"use client";

import Link from "next/link";
import { useState } from "react";
import { pgaTourHeadshotUrlById } from "@/lib/data/pga-tour-ids";
import FollowButton from "./FollowButton";
import ShotTracer from "./ShotTracer";
import { type FeedEvent, type FeedRow } from "@/lib/feed/types";

interface Props {
  title: string;
  /** Already-filtered reel rows — the API curates these from a wide window. */
  rows: FeedRow[];
  myReactions: Record<string, "up" | "down">;
  onReact: (eventId: string, dir: "up" | "down") => void;
}

/** Player headshot with a graceful fallback when no image is available. */
function ReelAvatar({ playerId }: { playerId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="reel-avatar reel-avatar-fallback" aria-hidden="true">
        🏌️
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="reel-avatar"
      src={pgaTourHeadshotUrlById(playerId, 160)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Per-result tint class for a reel card. */
function cardKind(e: FeedEvent): string {
  if (e.ace) return "ace";
  if (e.type === "shot") return "shot";
  return e.result ?? "other";
}

/**
 * A horizontal reel of feed moments. Used twice on /live: "Shots of the
 * day" (aces / eagles / hole-outs / long putts) and "Worst of the day"
 * (multi-putts and penalties). Rows arrive pre-curated from the API's
 * wide window. The headline links to the player card; the 👍 / 👎
 * buttons share the feed's reaction handler so counts stay in sync.
 */
export default function Reel({ title, rows, myReactions, onReact }: Props) {
  const items = rows.slice(0, 24);
  // Which event's shot trace is expanded into the full-hole overlay.
  const [expandedTrace, setExpandedTrace] = useState<FeedRow | null>(null);
  if (items.length === 0) return null;

  return (
    <section className="reel">
      <h3 className="reel-title">{title}</h3>
      <div className="reel-scroll">
        {items.map(({ event, reactions }) => {
          const mine = myReactions[event.id];
          const hasTrace =
            event.trace && event.trace.segments.length > 0;
          return (
            <div
              key={event.id}
              className={`reel-card reel-card-${cardKind(event)}`}
            >
              {hasTrace && (
                <button
                  type="button"
                  className="reel-tracer-btn"
                  onClick={() =>
                    setExpandedTrace({ event, reactions, commentCount: 0 })
                  }
                  aria-label="See the shot"
                >
                  <ShotTracer trace={event.trace!} mode="thumb" />
                  <span className="reel-tracer-hint">tap to expand ⤢</span>
                </button>
              )}
              <Link
                href={`/live/player/${event.playerId}`}
                className="reel-card-body"
              >
                <ReelAvatar playerId={event.playerId} />
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
                <FollowButton
                  playerId={event.playerId}
                  playerName={event.playerName}
                  variant="icon"
                />
              </div>
            </div>
          );
        })}
      </div>

      {expandedTrace && expandedTrace.event.trace && (
        <div
          className="tracer-overlay"
          onClick={() => setExpandedTrace(null)}
        >
          <div
            className="tracer-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <ShotTracer trace={expandedTrace.event.trace} mode="full" />
            <p className="tracer-modal-headline">
              {expandedTrace.event.headline}
            </p>
            <p className="tracer-modal-meta">
              R{expandedTrace.event.round} · the whole hole
            </p>
            <button
              type="button"
              className="tracer-modal-close"
              onClick={() => setExpandedTrace(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

