"use client";

/**
 * ShotPost — broadcast-style shot card in the Sweat Feed.
 *
 *   ┃[avatar]  P. Harrington · 8th       ┃ BOGEY
 *   ┃         Bogeys the 8th             ┃  +4
 *   ┃         ＋  💬 0  · 3rd bogey…     ┃
 *
 * Left accent stripe colours by shot result (emerald good / down
 * bad / muted par) so the feed is scannable in peripheral vision.
 * Right anchor stacks the tag pill above the player's current
 * to-par as the hero number — large mono, colour-matched to the
 * stripe. Centre block is name+hole · headline · action-row, with
 * no floating gaps. Shot-diagrams slot as a separate column
 * between body and anchor.
 */

import Link from "next/link";
import PlayerAvatar from "./PlayerAvatar";
import type { FeedEvent } from "@/lib/feed/types";
import { abbreviateName } from "@/lib/text/abbreviate";
import ShotDiagram from "./ShotDiagram";
import { useHoldReact } from "./useHoldReact";
import ReactionChips, { type ReactionState } from "./ReactionChips";
import { useFollowedPlayers } from "./useFollowedPlayers";

interface Props {
  event: FeedEvent;
  commentCount: number;
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
   *  card and selects an emoji from the floating tray. */
  onCustomReact?: (emoji: string) => void;
  /** Aggregated emoji reactions for this card — drives the
   *  ReactionChips cluster in the action row. */
  reactionState?: ReactionState;
  /** Toggle the caller's reaction for a given emoji. Fires when
   *  an existing chip is tapped. */
  onToggleReaction?: (emoji: string) => void;
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

/** Bucket the shot result into the three emotional colour bands
 *  used by the accent stripe + delta number. */
function emotionFor(event: FeedEvent): "good" | "bad" | "neutral" {
  if (event.ace) return "good";
  switch (event.result) {
    case "albatross":
    case "eagle":
    case "birdie":
      return "good";
    case "bogey":
    case "double":
    case "triple-plus":
      return "bad";
    default:
      return "neutral";
  }
}

/** Friendly suffix for hole number — "8th", "21st", etc. */
function ordinal(n: number): string {
  const last2 = n % 100;
  if (last2 >= 11 && last2 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
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
  commentCount,
  contextTag,
  handStatus,
  onShare,
  showDiagram,
  onCustomReact,
  reactionState,
  onToggleReaction,
}: Props) {
  const tag = tagFor(event);
  // Whole-card press-and-hold → tray. Quick tap on the body opens
  // the ShotDetail when one's available; nested buttons (like the
  // comment / ＋ react / context chip) keep their own clicks via
  // the data-no-hold opt-out the chips container carries.
  const { surfaceProps, tray, openTray } = useHoldReact({
    onReact: (emoji) => {
      onCustomReact?.(emoji);
    },
    onTap: onShare ? () => onShare(event) : undefined,
  });

  const emotion = emotionFor(event);
  const holeLabel = typeof event.hole === "number" ? ordinal(event.hole) : null;
  const { isFollowing, toggle: toggleFollow } = useFollowedPlayers();
  const following = isFollowing(event.playerId);

  return (
    <>
    <article
      className="post spost"
      data-event-id={event.id}
      data-emotion={emotion}
      {...surfaceProps}
    >
      <span className="spost-stripe" aria-hidden="true" />
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
        <div className="spost-line1">
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
          {holeLabel && (
            <span className="spost-hole-mini">· {holeLabel}</span>
          )}
          <button
            type="button"
            className={`spost-follow ${following ? "spost-follow-on" : ""}`}
            aria-label={
              following
                ? `Unfollow ${event.playerName}`
                : `Follow ${event.playerName}`
            }
            title={following ? "Unfollow" : "Follow"}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              toggleFollow(event.playerId);
            }}
            data-no-hold
          >
            {following ? "★" : "☆"}
          </button>
        </div>
        <p className="spost-headline">
          {stripPlayerName(event.headline ?? "", event.playerName)}
        </p>
        {onToggleReaction && (
          <div className="post-act-row">
            <ReactionChips
              state={reactionState}
              onToggle={onToggleReaction}
              onAdd={openTray}
            />
            <button
              type="button"
              className="post-act-cmt"
              aria-label="Comments"
              data-no-hold
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="14"
                height="14"
              >
                <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
              </svg>
              <span>{commentCount}</span>
            </button>
            {contextTag && <span className="post-act-ctx">{contextTag}</span>}
          </div>
        )}
      </div>
      {showDiagram && (
        <div className="spost-diagram-col">
          <ShotDiagram event={event} size="thumb" />
        </div>
      )}
      <div className="spost-anchor">
        {tag && (
          <span className={`spost-tag ${tag.cls}`}>{tag.label}</span>
        )}
        {event.toPar && (
          <span className="spost-delta mono">{event.toPar}</span>
        )}
      </div>
    </article>
    {tray}
    </>
  );
}
