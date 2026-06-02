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
import ShotDiagram from "./ShotDiagram";
import HoldReactPicker from "./HoldReactPicker";

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
   *  callback. Used on notable shots (highlight / lowlight) so they
   *  get a one-tap share affordance. */
  onShare?: (event: FeedEvent) => void;
  /** Render a small shot-diagram thumbnail beside the body. Drives
   *  the prototype's "we drew the hole next to the headline" feel
   *  back into the redesigned feed. */
  showDiagram?: boolean;
  /** Hold-and-pick reaction — fires when the user holds the
   *  thumb button and selects an emoji from the floating tray.
   *  Parent triggers the float-up burst animation. */
  onCustomReact?: (emoji: string) => void;
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
  showDiagram,
  onCustomReact,
}: Props) {
  const tag = tagFor(event);
  const reactCount = (reactions?.up ?? 0) + (reactions?.down ?? 0);
  const onTapLike = () => onReact(event.id, "up");
  const onHoldPick = (emoji: string) => {
    // Treat the picked emoji as a "burst" the parent fires through
    // the existing float-up animation. Also bump the local like
    // counter so the user gets immediate feedback on the count.
    onReact(event.id, "up");
    onCustomReact?.(emoji);
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
        {showDiagram ? (
          <div className="spost-text-row">
            <p className="spost-text spost-text-flex">
              {stripPlayerName(event.headline ?? "", event.playerName)}
            </p>
            <div className="spost-diagram">
              <ShotDiagram event={event} size="thumb" />
            </div>
          </div>
        ) : (
          <p className="spost-text">
            {stripPlayerName(event.headline ?? "", event.playerName)}
          </p>
        )}
        <div className="spost-react">
          <HoldReactPicker
            onTap={onTapLike}
            onReact={onHoldPick}
            count={reactCount}
            active={myReaction === "up"}
            ariaLabel="React — tap to like, hold to pick an emoji"
          />
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
