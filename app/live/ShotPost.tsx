"use client";

/**
 * ShotPost — primary shot-row in the Sweat Feed. Matches the
 * design-handoff prototype's .spost shape:
 *
 *   [avatar] [name] [BIRDIE tag] [H18] [-12]
 *            [action sentence text]
 *            [👍 react] [💬 comment]    [context chip]
 *
 * Replaces the old feed-row markup from the v4-themed feed. Keeps
 * what matters from the original — thumbs-up reaction toggle wired
 * to the same /api/feed/react endpoint, comment count visible,
 * context tag chip (first non-deprecated tag from event.tags) —
 * and drops what doesn't translate to the prototype: multi-emoji
 * reactions, follow-star, inline odds-shift / impact chips, the
 * putt-poll widget (which lives at its own surface now).
 *
 * Bet-impact chips live in the chrome of the bet-post that owns
 * the player, not on every shot. Putt polls render through the
 * existing PredictionPollDeck flow on bet-relevant putts.
 */

import Link from "next/link";
import PlayerAvatar from "./PlayerAvatar";
import type { FeedEvent } from "@/lib/feed/types";
import { abbreviateName } from "@/lib/text/abbreviate";

interface Props {
  event: FeedEvent;
  reactions: { up: number; down: number };
  commentCount: number;
  myReaction: "up" | "down" | undefined;
  onReact: (eventId: string, kind: "up" | "down") => void;
  /** First context tag worth surfacing — pre-filtered by the parent
   *  to drop deprecated patterns. Empty string when nothing to show. */
  contextTag?: string;
  /** Hot/cold streak indicator for the player — adds an emoji
   *  suffix beside the name. */
  handStatus?: "hot" | "cold" | null;
  /** When set, surfaces a Share button on the row that fires this
   *  callback. Used by the Best-of-day / Worst-of-day filters so
   *  the highlight-reel cards get a one-tap share affordance. */
  onShare?: (event: FeedEvent) => void;
}

/** Map ScoreResult onto the prototype's tag class + label. The
 *  prototype's .tag.birdie / .tag.eagle styling carries emerald;
 *  .tag.bogey is red. Doubles+ also red. Pars don't get a tag. */
function tagFor(event: FeedEvent): { label: string; cls: string } | null {
  if (event.ace) return { label: "ACE", cls: "tag-eagle" };
  switch (event.result) {
    case "albatross":
      return { label: "ALBATROSS", cls: "tag-eagle" };
    case "eagle":
      return { label: "EAGLE", cls: "tag-eagle" };
    case "birdie":
      return { label: "BIRDIE", cls: "tag-birdie" };
    case "bogey":
      return { label: "BOGEY", cls: "tag-bogey" };
    case "double":
      return { label: "DOUBLE", cls: "tag-bogey" };
    case "triple-plus":
      return { label: "BLOW-UP", cls: "tag-bogey" };
    default:
      return null;
  }
}

/** Strip the leading player name from an engine-generated headline
 *  so the row can render the name in its own slot. Falls back to
 *  the full headline when the name isn't a prefix. */
function stripPlayerName(headline: string, playerName: string): string {
  if (!headline.startsWith(playerName)) return headline;
  const rest = headline.slice(playerName.length).trim();
  if (rest.length === 0) return headline;
  return rest[0].toUpperCase() + rest.slice(1);
}

export default function ShotPost({
  event,
  reactions,
  commentCount,
  myReaction,
  onReact,
  contextTag,
  handStatus,
  onShare,
}: Props) {
  const tag = tagFor(event);
  const reactCount = (reactions?.up ?? 0) + (reactions?.down ?? 0);
  const onThumbClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onReact(event.id, "up");
  };

  return (
    <article className="post spost" data-event-id={event.id}>
      <Link
        href={`/live/player/${event.playerId}`}
        className="spost-avatar"
        aria-label={event.playerName}
      >
        <PlayerAvatar
          playerId={event.playerId}
          playerName={event.playerName}
          size="md"
          state={handStatus ?? null}
        />
      </Link>
      <div className="spost-body">
        <div className="spost-top">
          <Link
            href={`/live/player/${event.playerId}`}
            className="spost-name"
          >
            {abbreviateName(event.playerName)}
            {handStatus === "hot" && (
              <span className="spost-hand" aria-label="hot streak">
                {" "}
                🔥
              </span>
            )}
            {handStatus === "cold" && (
              <span className="spost-hand" aria-label="cold streak">
                {" "}
                🥶
              </span>
            )}
          </Link>
          {tag && (
            <span className={`spost-tag ${tag.cls}`}>{tag.label}</span>
          )}
          {typeof event.hole === "number" && (
            <span className="spost-hole mono">H{event.hole}</span>
          )}
          {event.toPar && (
            <span
              className={`spost-score mono${
                event.toPar.startsWith("+") ? " over" : ""
              }`}
            >
              {event.toPar}
            </span>
          )}
        </div>
        <p className="spost-text">
          {stripPlayerName(event.headline ?? "", event.playerName)}
        </p>
        <div className="spost-react">
          <button
            type="button"
            className={`spost-act${myReaction === "up" ? " spost-act-on" : ""}`}
            onClick={onThumbClick}
            aria-label="React with thumbs up"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="15"
              height="15"
            >
              <path d="M7 10v11" />
              <path d="M7 10l4-7a2 2 0 0 1 3 1.7V9h4.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 20H7" />
            </svg>
            <span>{reactCount}</span>
          </button>
          <button type="button" className="spost-act" aria-label="Comments">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="15"
              height="15"
            >
              <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
            </svg>
            <span>{commentCount}</span>
          </button>
          {onShare && (
            <button
              type="button"
              className="spost-act spost-act-share"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onShare(event);
              }}
              aria-label="Share this shot"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="15"
                height="15"
              >
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                <path d="M16 6l-4-4-4 4" />
                <path d="M12 2v14" />
              </svg>
              <span>Share</span>
            </button>
          )}
          {contextTag && <span className="spost-ctx">{contextTag}</span>}
        </div>
      </div>
    </article>
  );
}
