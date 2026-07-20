"use client";

/**
 * ONE card component used for EVERY shot event in v3 on desktop.
 *
 * Fixed skeleton — accent stripe · avatar · [ name / hole / time · verb
 * · context ] · score — same height (82 px) for every card so the
 * 2-column grid aligns cleanly.
 *
 * The card is intentionally information-dense but visually restrained:
 *   • Only the score number is coloured (green/red/muted).
 *   • The 3 px accent stripe carries priority: gold = Mine (followed
 *     or bet-tracked), blue = notable moment (ace/eagle/big move),
 *     invisible = default.
 *   • Everything else — hole, time, tag chip, context text — is
 *     monochrome muted so the eye locks onto the score.
 *   • Actions (react, share) live on a hover overlay so the card at
 *     rest reads clean.
 *
 * Diagrams, impact chips, poll widgets etc. that ShotPost carries are
 * intentionally OMITTED — this card is a streaming update, not a
 * detail view. Tap the card to open ShotDetail if needed.
 */

import type { FeedEvent } from "@/lib/feed/types";
import PlayerAvatar from "../PlayerAvatar";

interface Props {
  event: FeedEvent;
  /** Optional context tag ("Now solo leader", "3rd bogey", …) —
   *  shown as muted secondary text under the verb. Truncated with
   *  ellipsis; keep it short. */
  contextTag?: string | null;
  /** Priority signals from the ranker. Used ONLY for accent-stripe
   *  colour; card size stays uniform regardless. */
  isMine: boolean;
  isNotable: boolean;
  onOpen?: () => void;
  onReact?: () => void;
  onShare?: () => void;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function holeLabel(hole: number | undefined): string {
  if (typeof hole !== "number") return "";
  const s = (n: number) => {
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    if (n % 10 === 1) return "st";
    if (n % 10 === 2) return "nd";
    if (n % 10 === 3) return "rd";
    return "th";
  };
  return `${hole}${s(hole)}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function scorePolarity(toPar: string | undefined): "under" | "over" | "even" | "none" {
  if (!toPar) return "none";
  const t = toPar.trim();
  if (t === "" || t === "-") return "none";
  if (/^e$/i.test(t)) return "even";
  if (t.startsWith("+")) return "over";
  if (t.startsWith("-") || t.startsWith("−")) return "under";
  return "none";
}

function formatScore(toPar: string | undefined): string {
  if (!toPar) return "—";
  return toPar.replace(/^-/, "−");
}

function tagText(ev: FeedEvent): { text: string; kind: string } {
  if (ev.ace) return { text: "ACE", kind: "ace" };
  if (ev.result === "albatross") return { text: "ALB", kind: "albatross" };
  if (ev.result === "eagle") return { text: "EAGLE", kind: "eagle" };
  if (ev.result === "birdie") return { text: "BIRDIE", kind: "birdie" };
  if (ev.result === "bogey") return { text: "BOGEY", kind: "bogey" };
  if (ev.result === "double") return { text: "DBL", kind: "double" };
  if (ev.result === "triple-plus") return { text: "TRIP+", kind: "triple-plus" };
  if (ev.type === "shot") return { text: "SHOT", kind: "shot" };
  if (ev.type === "position") return { text: "MOVE", kind: "position" };
  if (ev.type === "milestone") return { text: ev.headline?.slice(0, 8).toUpperCase() ?? "NOTE", kind: "milestone" };
  return { text: ev.type.toUpperCase(), kind: "misc" };
}

/** Build the primary verb line — falls back to the engine's headline
 *  if we can't compose something more precise from the shape. */
function verbLine(ev: FeedEvent): string {
  if (ev.headline) return ev.headline;
  const hole = holeLabel(ev.hole);
  if (!hole) return "—";
  if (ev.ace) return `Ace on ${hole}`;
  if (ev.result === "eagle") return `Eagles ${hole}`;
  if (ev.result === "birdie") return `Birdies ${hole}`;
  if (ev.result === "bogey") return `Bogeys ${hole}`;
  if (ev.result === "double") return `Doubles ${hole}`;
  if (ev.result === "triple-plus") return `Blow-up ${hole}`;
  return `Plays ${hole}`;
}

export default function UnifiedShotCard({
  event,
  contextTag,
  isMine,
  isNotable,
  onOpen,
  onReact,
  onShare,
}: Props) {
  const polarity = scorePolarity(event.toPar);
  const scoreCls = `feed-v3-card-score feed-v3-card-score-${polarity}`;
  const cls = ["feed-v3-card"];
  if (isMine) cls.push("feed-v3-card-mine");
  else if (isNotable) cls.push("feed-v3-card-notable");
  const tag = tagText(event);

  return (
    <article
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
    >
      <span className="feed-v3-card-stripe" aria-hidden="true" />
      <div className="feed-v3-card-avatar">
        <PlayerAvatar
          playerId={event.playerId}
          playerName={event.playerName}
          size="sm"
        />
      </div>
      <div className="feed-v3-card-body">
        <div className="feed-v3-card-headline">
          <span className="feed-v3-card-name">{shortName(event.playerName)}</span>
          {event.hole != null && (
            <>
              <span className="feed-v3-card-sep">·</span>
              <span className="feed-v3-card-hole">{holeLabel(event.hole)}</span>
            </>
          )}
          <span className="feed-v3-card-sep">·</span>
          <span className="feed-v3-card-time">{formatClock(event.ts)}</span>
        </div>
        <div className="feed-v3-card-verb">{verbLine(event)}</div>
        {contextTag ? (
          <div className="feed-v3-card-context">{contextTag}</div>
        ) : (
          <div className="feed-v3-card-context feed-v3-card-context-empty" />
        )}
      </div>
      <div className="feed-v3-card-anchor">
        <span className={`feed-v3-card-tag feed-v3-card-tag-${tag.kind}`}>
          {tag.text}
        </span>
        <span className={scoreCls}>{formatScore(event.toPar)}</span>
      </div>
      <div className="feed-v3-card-actions">
        <button
          type="button"
          className="feed-v3-card-action"
          onClick={(e) => {
            e.stopPropagation();
            onReact?.();
          }}
          aria-label="React"
          title="React"
        >
          ♡
        </button>
        {onShare && (
          <button
            type="button"
            className="feed-v3-card-action"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            aria-label="Share"
            title="Share"
          >
            ↗
          </button>
        )}
      </div>
    </article>
  );
}
