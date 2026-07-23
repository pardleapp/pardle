"use client";

/**
 * One player row in v4 — plus expanded shot history + inline comment
 * threads when a shot's 💬 chip is clicked.
 *
 * Reactions target the SHOT (event id), not the row: McIlroy's 380y
 * drive is a separate reactable object from his next putt. Global
 * counts come from the server (bulk-fetched in /api/live-leaderboard),
 * the visitor's own "mine" list is local to their browser.
 */

import { useEffect, useState } from "react";
import type { FeedEvent } from "@/lib/feed/types";
import PlayerAvatar from "../PlayerAvatar";
import CommentThread from "./CommentThread";
import type {
  LeaderboardRow,
  EventSocial,
} from "@/app/api/live-leaderboard/route";

interface Props {
  row: LeaderboardRow;
  isMine: boolean;
  social: Record<string, EventSocial>;
  /** eventId → emojis this visitor has reacted with. Merged with the
   *  server-side counts to render mine-highlighted chips. */
  mineMap: Record<string, string[]>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onReact: (eventId: string, emoji: string) => void;
  authorKey: string;
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

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6h

/** Live-appropriate timestamp. Events older than the stale threshold
 *  aren't shown as "24h ago" — the tournament's done and that read
 *  as broken during pre-launch testing on old buffers. Caller should
 *  render a small "Final" chip in place of this when isStale(ts). */
function formatEventTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff >= STALE_THRESHOLD_MS) return "Final";
  const s = Math.floor(diff / 1000);
  if (s < 20) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function isStale(ts: number, now: number): boolean {
  return now - ts >= STALE_THRESHOLD_MS;
}

/** Format proximity-to-hole from either proximityInches (canonical)
 *  or the IMG-formatted imgToPin string (e.g. "3 ft" / "8yd"). Rounds
 *  to whole feet under 30 ft and whole yards over. */
function proximityLabel(ev: FeedEvent): string {
  if (typeof ev.proximityInches === "number") {
    const feet = ev.proximityInches / 12;
    if (feet < 1) {
      const inches = Math.round(ev.proximityInches);
      return `${inches}in`;
    }
    if (feet < 30) return `${Math.round(feet)}ft`;
    return `${Math.round(feet / 3)}yd`;
  }
  if (typeof ev.imgToPin === "string" && ev.imgToPin.trim().length > 0) {
    return ev.imgToPin.replace(/\s+/g, "").replace(/yds?/i, "yd");
  }
  return "";
}

/** Format shot distance (how far the ball travelled). Yards for
 *  drives/approaches, feet for putts/chips. */
function shotDistanceLabel(ev: FeedEvent): string {
  if (typeof ev.imgShotDistance !== "number") return "";
  const unit = (ev.imgShotDistanceUnit ?? "").toLowerCase();
  if (unit === "ft") return `${Math.round(ev.imgShotDistance)}ft`;
  if (unit === "yds" || unit === "yd") return `${Math.round(ev.imgShotDistance)}y`;
  // Unknown unit — trust the collector's headline instead
  return "";
}

/** Normalise the IMG landing surface into a lowercase display word.
 *  IMG uses "Fairway" / "Rough" / "Bunker" / "Green" / "Native Area" /
 *  "Tee" etc. Returns "" for unknown or absent values so callers can
 *  omit the "to X" suffix cleanly. */
function landingSurfaceLabel(ev: FeedEvent): string {
  const raw = (ev.imgSurface ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("fairway")) return "fairway";
  if (raw.includes("rough")) return "rough";
  if (raw.includes("bunker") || raw.includes("sand")) return "bunker";
  if (raw === "green" || raw.includes("putting green")) return "green";
  if (raw.includes("fringe") || raw.includes("collar")) return "fringe";
  if (raw.includes("native") || raw.includes("waste")) return "native area";
  if (raw.includes("water") || raw.includes("hazard")) return "water";
  if (raw === "tee" || raw.includes("tee box")) return "tee";
  return "";
}

function eventVerb(ev: FeedEvent): { tag: string; kind: string; text: string; anchor: string } {
  const h = (ev.headline ?? "").toLowerCase();
  const hole = holeLabel(ev.hole);
  // Score events keep the hole label — knowing WHICH hole they
  // birdied is signal even when "thru" tells you what they're on.
  if (ev.ace) return { tag: "ACE", kind: "ace", text: `Ace ${hole}`, anchor: "" };
  if (ev.result === "albatross") return { tag: "ALB", kind: "eagle", text: `Alb ${hole}`, anchor: "" };
  if (ev.result === "eagle") return { tag: "EAGLE", kind: "eagle", text: `Eagle ${hole}`, anchor: "" };
  if (ev.result === "birdie") return { tag: "BIRDIE", kind: "birdie", text: `Birdie ${hole}`, anchor: "" };
  if (ev.result === "bogey") return { tag: "BOGEY", kind: "bogey", text: `Bogey ${hole}`, anchor: "" };
  if (ev.result === "double") return { tag: "DBL", kind: "double", text: `Double ${hole}`, anchor: "" };
  if (ev.result === "triple-plus") return { tag: "TRIP+", kind: "double", text: `Blow-up ${hole}`, anchor: "" };
  // Shot events drop the hole label — the row's "thru" column already
  // shows what hole the player is on. Instead, surface the distance
  // that actually characterises the shot (drive length, putt length +
  // proximity, approach proximity, etc).
  if (ev.type === "shot") {
    if (/\bputts?\b/.test(h)) {
      const dist = shotDistanceLabel(ev);
      const prox = proximityLabel(ev);
      const text =
        dist && prox
          ? `${dist} putt → ${prox}`
          : dist
            ? `${dist} putt`
            : prox
              ? `Putts → ${prox}`
              : "Putts";
      return { tag: "PUTT", kind: "shot", text, anchor: "" };
    }
    if (/\b(bunker|sand)\b/.test(h)) {
      const prox = proximityLabel(ev);
      const text = prox ? `From bunker → ${prox}` : "From bunker";
      return { tag: "SAND", kind: "shot", text, anchor: "" };
    }
    if (/\b(chips?|chip[- ]in|pitch(?:es|ing)?)\b/.test(h)) {
      const prox = proximityLabel(ev);
      const text = prox ? `Chips → ${prox}` : "Chips";
      return { tag: "CHIP", kind: "shot", text, anchor: "" };
    }
    if (/\bapproach(es|ing)?\b/.test(h)) {
      const dist = shotDistanceLabel(ev);
      const prox = proximityLabel(ev);
      const text =
        dist && prox
          ? `Approach from ${dist} → ${prox}`
          : dist
            ? `Approach from ${dist}`
            : prox
              ? `Approach → ${prox}`
              : "Approach";
      return { tag: "APPR", kind: "shot", text, anchor: "" };
    }
    if (typeof ev.imgShotDistance === "number" && ev.imgShotDistanceUnit === "yds") {
      // Drives — the distance IS the story, plus where the ball ended
      // up (fairway / rough / bunker) tells the "was it a good drive?"
      // half of the story. No hole label — the row's thru column has
      // that. No proximity — drives aim at a fairway, not the pin.
      const surface = landingSurfaceLabel(ev);
      const text = surface
        ? `Drives ${Math.round(ev.imgShotDistance)}y to ${surface}`
        : `Drives ${Math.round(ev.imgShotDistance)}y`;
      return { tag: "DRIVE", kind: "shot", text, anchor: "" };
    }
    // Fallback for an untyped shot with no clear headline verb —
    // trust the collector's own sentence if we have one.
    if (ev.headline) return { tag: "SHOT", kind: "shot", text: ev.headline, anchor: "" };
    return { tag: "SHOT", kind: "shot", text: "Plays a shot", anchor: "" };
  }
  if (ev.type === "position") {
    return { tag: "MOVE", kind: "misc", text: ev.headline ?? "", anchor: "" };
  }
  return { tag: (ev.type ?? "").toUpperCase(), kind: "misc", text: ev.headline ?? "", anchor: "" };
}

/** Merge server-side global counts with the visitor's local "mine"
 *  list. Emojis in mine that aren't in counts still show as "1 (you)". */
function reactionChips(
  emojiCounts: Record<string, number> | undefined,
  mineEmojis: string[] | undefined,
): Array<{ emoji: string; count: number; mine: boolean }> {
  const merged = new Map<string, { count: number; mine: boolean }>();
  if (emojiCounts) {
    for (const [e, c] of Object.entries(emojiCounts)) {
      if (c > 0) merged.set(e, { count: c, mine: false });
    }
  }
  if (mineEmojis) {
    for (const e of mineEmojis) {
      const cur = merged.get(e);
      if (cur) merged.set(e, { ...cur, mine: true });
      else merged.set(e, { count: 1, mine: true });
    }
  }
  return [...merged.entries()]
    .map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

interface EventInlineProps {
  event: FeedEvent;
  now: number;
  social: EventSocial | undefined;
  mineEmojis: string[] | undefined;
  onReact: (emoji: string) => void;
  isLatest: boolean;
  authorKey: string;
  commentsOpen: boolean;
  onToggleComments: () => void;
}

function EventInline({
  event,
  now,
  social,
  mineEmojis,
  onReact,
  isLatest,
  authorKey,
  commentsOpen,
  onToggleComments,
}: EventInlineProps) {
  const verb = eventVerb(event);
  const stale = isStale(event.ts, now);
  const fresh = isLatest && !stale && now - event.ts < 60_000;
  const chips = reactionChips(social?.emojiCounts, mineEmojis);
  const commentCount = social?.commentCount ?? 0;

  return (
    <>
      <div className="v4-latest">
        <span
          className={`v4-latest-pulse${fresh ? " v4-latest-pulse-on" : ""}`}
          aria-hidden="true"
        />
        <span className={`v4-latest-tag v4-latest-tag-${verb.kind}`}>{verb.tag}</span>
        <span className="v4-latest-text">{verb.text}</span>
        {verb.anchor && <span className="v4-latest-anchor">{verb.anchor}</span>}
        <span
          className={`v4-latest-time${stale ? " v4-latest-time-final" : ""}`}
        >
          {formatEventTime(event.ts, now)}
        </span>
        <span className="v4-react-cluster">
          {chips.length > 0 && (
            <span className="v4-react-summary">
              {chips.map((r) => (
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
          <button
            type="button"
            className={`v4-comment-chip v4-comment-chip-btn${commentsOpen ? " v4-comment-chip-open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleComments();
            }}
            title={
              commentsOpen
                ? "Hide comments"
                : commentCount > 0
                  ? `Show ${commentCount} comment${commentCount === 1 ? "" : "s"}`
                  : "Add a comment"
            }
          >
            💬 {commentCount || ""}
          </button>
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
      {commentsOpen && (
        <CommentThread eventId={event.id} authorKey={authorKey} />
      )}
    </>
  );
}

export default function LeaderRow({
  row,
  isMine,
  social,
  mineMap,
  expanded,
  onToggleExpanded,
  onReact,
  authorKey,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  const state = (row.playerState ?? "").toUpperCase();
  const isCut = state === "CUT" || state === "MC" || state === "WD" || state === "DQ";
  const latest = row.latestEvent;
  const eventFresh = latest != null && now - latest.ts < 60_000;

  const toggleComments = (eventId: string) => {
    setOpenComments((cur) => {
      const next = new Set(cur);
      if (next.has(eventId)) next.delete(eventId);
      else {
        next.add(eventId);
        // Also expand the row if it isn't — comments live in the
        // expanded panel below the row.
        if (!expanded) onToggleExpanded();
      }
      return next;
    });
  };

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
            mineEmojis={mineMap[latest.id]}
            onReact={(emoji) => onReact(latest.id, emoji)}
            isLatest
            authorKey={authorKey}
            commentsOpen={openComments.has(latest.id)}
            onToggleComments={() => toggleComments(latest.id)}
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
              mineEmojis={mineMap[ev.id]}
              onReact={(emoji) => onReact(ev.id, emoji)}
              isLatest={false}
              authorKey={authorKey}
              commentsOpen={openComments.has(ev.id)}
              onToggleComments={() => toggleComments(ev.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
