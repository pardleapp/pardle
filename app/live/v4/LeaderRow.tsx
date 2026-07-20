"use client";

/**
 * One player row in v4 — plus expanded shot history when clicked.
 * Reactions target the SHOT (event id), not the row: McIlroy's 380y
 * drive is a separate reactable object from his next putt. Each shot
 * in the expanded strip has its own reactions bar and comment count.
 */

import { useEffect, useState } from "react";
import type { FeedEvent } from "@/lib/feed/types";
import PlayerAvatar from "../PlayerAvatar";
import type {
  LeaderboardRow,
  EventSocial,
} from "@/app/api/live-leaderboard/route";

export interface ReactionState {
  counts: Record<string, number>;
  mine: string[];
}

interface Props {
  row: LeaderboardRow;
  isMine: boolean;
  social: Record<string, EventSocial>;
  emojiReactions: Record<string, ReactionState>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onReact: (eventId: string, emoji: string) => void;
}

const REACTION_EMOJI = ["🔥", "😬", "🎯"];

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function holeLabel(n: number | undefined): string {
  if (typeof n !== "number") return "";
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${s}`;
}

function formatSg(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v > 0.005 ? "+" : v < -0.005 ? "−" : "";
  return `${sign}${abs.toFixed(1)}`;
}

function sgClass(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (v > 0.2) return "v4-sg-plus";
  if (v < -0.2) return "v4-sg-minus";
  return "";
}

function totalClass(total: string): string {
  if (!total || total === "E" || total === "—") return "v4-total-even";
  if (total.startsWith("-") || total.startsWith("−")) return "v4-total-under";
  if (total.startsWith("+")) return "v4-total-over";
  return "";
}

function formatEventTime(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

function eventVerb(ev: FeedEvent): { tag: string; kind: string; text: string; anchor: string } {
  const h = (ev.headline ?? "").toLowerCase();
  const hole = holeLabel(ev.hole);
  if (ev.ace) return { tag: "ACE", kind: "ace", text: `Ace ${hole}`, anchor: "" };
  if (ev.result === "albatross") return { tag: "ALB", kind: "eagle", text: `Alb ${hole}`, anchor: "" };
  if (ev.result === "eagle") return { tag: "EAGLE", kind: "eagle", text: `Eagle ${hole}`, anchor: "" };
  if (ev.result === "birdie") return { tag: "BIRDIE", kind: "birdie", text: `Birdie ${hole}`, anchor: "" };
  if (ev.result === "bogey") return { tag: "BOGEY", kind: "bogey", text: `Bogey ${hole}`, anchor: "" };
  if (ev.result === "double") return { tag: "DBL", kind: "double", text: `Double ${hole}`, anchor: "" };
  if (ev.result === "triple-plus") return { tag: "TRIP+", kind: "double", text: `Blow-up ${hole}`, anchor: "" };
  if (ev.type === "shot") {
    if (/\bputts?\b/.test(h)) {
      const anchor =
        typeof ev.imgShotDistance === "number" && ev.imgShotDistanceUnit === "ft"
          ? `${Math.round(ev.imgShotDistance)}ft`
          : typeof ev.proximityInches === "number"
            ? `${Math.round(ev.proximityInches / 12)}ft`
            : "";
      return { tag: "PUTT", kind: "shot", text: `Putts ${hole}`, anchor };
    }
    if (/\b(bunker|sand)\b/.test(h)) {
      return { tag: "SAND", kind: "shot", text: `Sand ${hole}`, anchor: "" };
    }
    if (/\bapproach(es|ing)?\b/.test(h)) {
      const anchor =
        typeof ev.proximityInches === "number"
          ? `${Math.round(ev.proximityInches / 12)}ft`
          : "";
      return { tag: "APPR", kind: "shot", text: `Approach ${hole}`, anchor };
    }
    if (typeof ev.imgShotDistance === "number" && ev.imgShotDistanceUnit === "yds") {
      return { tag: "DRIVE", kind: "shot", text: `Drive ${hole}`, anchor: `${Math.round(ev.imgShotDistance)}y` };
    }
    return { tag: "SHOT", kind: "shot", text: `Shot ${hole}`, anchor: "" };
  }
  if (ev.type === "position") {
    return { tag: "MOVE", kind: "misc", text: ev.headline ?? "", anchor: "" };
  }
  return { tag: (ev.type ?? "").toUpperCase(), kind: "misc", text: ev.headline ?? "", anchor: "" };
}

/** Compact reactions summary for an event — top 2 emoji + counts.
 *  Falls back to a single "React" pill when nothing has landed yet. */
function summarizeReactions(state: ReactionState | undefined): Array<{ emoji: string; count: number; mine: boolean }> {
  if (!state) return [];
  const entries = Object.entries(state.counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return entries.map(([emoji, count]) => ({
    emoji,
    count,
    mine: state.mine.includes(emoji),
  }));
}

interface EventInlineProps {
  event: FeedEvent;
  now: number;
  social: EventSocial | undefined;
  reactionState: ReactionState | undefined;
  onReact: (emoji: string) => void;
  /** True for the top row of the collapsed leaderboard — enables
   *  the fresh-event pulse. */
  isLatest: boolean;
}

/** Renders a single event as a self-contained inline pill: tag ·
 *  verb · anchor · time · reactions · comments · emoji picker. Used
 *  both as the row's "latest" cell (isLatest) and as each expanded-
 *  row history item. */
function EventInline({
  event,
  now,
  social,
  reactionState,
  onReact,
  isLatest,
}: EventInlineProps) {
  const verb = eventVerb(event);
  const fresh = isLatest && now - event.ts < 60_000;
  const reactionSummary = summarizeReactions(reactionState);
  const commentCount = social?.commentCount ?? 0;

  return (
    <div className="v4-latest">
      <span
        className={`v4-latest-pulse${fresh ? " v4-latest-pulse-on" : ""}`}
        aria-hidden="true"
      />
      <span className={`v4-latest-tag v4-latest-tag-${verb.kind}`}>{verb.tag}</span>
      <span className="v4-latest-text">{verb.text}</span>
      {verb.anchor && <span className="v4-latest-anchor">{verb.anchor}</span>}
      <span className="v4-latest-time">{formatEventTime(event.ts, now)}</span>
      <span className="v4-react-cluster">
        {reactionSummary.length > 0 && (
          <span className="v4-react-summary">
            {reactionSummary.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`v4-react-chip${r.mine ? " v4-react-chip-mine" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onReact(r.emoji);
                }}
                title={r.mine ? "Remove your reaction" : `React with ${r.emoji}`}
              >
                <span className="v4-react-chip-emoji">{r.emoji}</span>
                <span className="v4-react-chip-count">{r.count}</span>
              </button>
            ))}
          </span>
        )}
        {commentCount > 0 && (
          <span className="v4-comment-chip" title={`${commentCount} comment${commentCount === 1 ? "" : "s"}`}>
            💬 {commentCount}
          </span>
        )}
        {/* Emoji picker — always rendered; CSS hides at rest and shows
            on cell hover so the row stays clean when at rest. */}
        <span className="v4-react-picker">
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="v4-react-pick-btn"
              onClick={(e) => {
                e.stopPropagation();
                onReact(emoji);
              }}
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </span>
      </span>
    </div>
  );
}

export default function LeaderRow({
  row,
  isMine,
  social,
  emojiReactions,
  expanded,
  onToggleExpanded,
  onReact,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  const state = (row.playerState ?? "").toUpperCase();
  const isCut = state === "CUT" || state === "MC" || state === "WD" || state === "DQ";
  const latest = row.latestEvent;
  const eventFresh = latest != null && now - latest.ts < 60_000;

  return (
    <div className={`v4-row-wrap${expanded ? " v4-row-wrap-open" : ""}`}>
      <div
        className={`v4-row${isMine ? " v4-row-mine" : ""}${isCut ? " v4-row-cut" : ""}${eventFresh ? " v4-row-fresh" : ""}`}
        onClick={onToggleExpanded}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpanded();
          }
        }}
      >
        <span className="v4-pos">{row.position}</span>
        <span className="v4-avatar">
          <PlayerAvatar playerId={row.playerId} playerName={row.playerName} size="sm" />
        </span>
        <span className="v4-name">
          <span className="v4-name-primary">{shortName(row.playerName)}</span>
          {isCut && <span className="v4-name-cut">{state}</span>}
        </span>
        <span className={`v4-total ${totalClass(row.total)}`}>
          {row.total?.replace(/^-/, "−") || "—"}
        </span>
        <span className="v4-thru">{row.thru || "—"}</span>
        {latest ? (
          <EventInline
            event={latest}
            now={now}
            social={social[latest.id]}
            reactionState={emojiReactions[latest.id]}
            onReact={(emoji) => onReact(latest.id, emoji)}
            isLatest
          />
        ) : (
          <span className="v4-latest">
            <span className="v4-latest-empty">—</span>
          </span>
        )}
        <span className={`v4-sg ${sgClass(row.sg?.ott ?? null)}`}>{formatSg(row.sg?.ott ?? null)}</span>
        <span className={`v4-sg ${sgClass(row.sg?.app ?? null)}`}>{formatSg(row.sg?.app ?? null)}</span>
        <span className={`v4-sg ${sgClass(row.sg?.arg ?? null)}`}>{formatSg(row.sg?.arg ?? null)}</span>
        <span className={`v4-sg ${sgClass(row.sg?.putt ?? null)}`}>{formatSg(row.sg?.putt ?? null)}</span>
        <span className={`v4-sg v4-sg-total ${sgClass(row.sg?.total ?? null)}`}>
          {formatSg(row.sg?.total ?? null)}
        </span>
      </div>
      {expanded && row.recentEvents.length > 1 && (
        <div className="v4-row-expand">
          <div className="v4-row-expand-label">RECENT SHOTS</div>
          {row.recentEvents.slice(1).map((ev) => (
            <EventInline
              key={ev.id}
              event={ev}
              now={now}
              social={social[ev.id]}
              reactionState={emojiReactions[ev.id]}
              onReact={(emoji) => onReact(ev.id, emoji)}
              isLatest={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
