"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { pgaTourHeadshotUrlById } from "@/lib/data/pga-tour-ids";
import FollowButton from "./FollowButton";
import ShotTracer from "./ShotTracer";
import { type FeedEvent, type FeedRow } from "@/lib/feed/types";

interface Pane {
  /** Stable key used to persist the active tab in localStorage. */
  key: string;
  /** Tab label, e.g. "⛳ Shots of the day". */
  title: string;
  rows: FeedRow[];
}

interface Props {
  panes: Pane[];
  myReactions: Record<string, "up" | "down">;
  onReact: (eventId: string, dir: "up" | "down") => void;
  /** Persists the active-tab + collapsed choice across refreshes. */
  storageKey: string;
}

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

function cardKind(e: FeedEvent): string {
  if (e.ace) return "ace";
  if (e.type === "shot") return "shot";
  return e.result ?? "other";
}

/**
 * A tab-toggled reel group. Replaces the previous pair of stacked
 * Reels with one collapsed strip on the homepage: tabs at the top
 * pick which set of moments to show, the chevron expands a single
 * scroll panel below. Storage keeps the active tab and open/closed
 * state across refreshes.
 */
export default function ReelGroup({
  panes,
  myReactions,
  onReact,
  storageKey,
}: Props) {
  const tabKey = `pardle_reelgroup_active_${storageKey}`;
  const collapsedKey = `pardle_reelgroup_collapsed_${storageKey}`;
  const [active, setActive] = useState<string>(panes[0]?.key ?? "");
  const [collapsed, setCollapsed] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<FeedRow | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedTab = window.localStorage.getItem(tabKey);
    if (storedTab && panes.some((p) => p.key === storedTab)) {
      setActive(storedTab);
    }
    const storedCollapsed = window.localStorage.getItem(collapsedKey);
    if (storedCollapsed === "1") setCollapsed(true);
  }, [tabKey, collapsedKey, panes]);

  function pick(k: string) {
    setActive(k);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(tabKey, k);
      // Picking a tab while collapsed should also reveal the panel —
      // otherwise the click feels like a no-op.
      if (collapsed) {
        setCollapsed(false);
        window.localStorage.removeItem(collapsedKey);
      }
    }
  }

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        if (next) {
          window.localStorage.setItem(collapsedKey, "1");
        } else {
          window.localStorage.removeItem(collapsedKey);
        }
      }
      return next;
    });
  }

  // Hide the whole group if every pane is empty.
  const nonEmpty = panes.filter((p) => p.rows.length > 0);
  if (nonEmpty.length === 0) return null;

  const activePane =
    nonEmpty.find((p) => p.key === active) ?? nonEmpty[0];
  const items = activePane.rows.slice(0, 24);

  return (
    <section className="reel reel-group">
      <div className="reel-group-bar">
        <div className="reel-group-tabs" role="tablist">
          {nonEmpty.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={p.key === activePane.key}
              className={`reel-group-tab ${
                p.key === activePane.key ? "reel-group-tab-on" : ""
              }`}
              onClick={() => pick(p.key)}
            >
              <span className="reel-group-tab-label">{p.title}</span>
              <span className="reel-group-tab-count">{p.rows.length}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="reel-group-chev-btn"
          onClick={toggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? "Show reel" : "Hide reel"}
        >
          <span
            className={`reel-title-chev ${
              collapsed ? "reel-title-chev-collapsed" : ""
            }`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
      </div>

      {collapsed ? null : (
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
                      setExpandedTrace({
                        event,
                        reactions,
                        commentCount: 0,
                      })
                    }
                    aria-label="See the shot"
                  >
                    <ShotTracer trace={event.trace!} mode="thumb" />
                    <span className="reel-tracer-hint">
                      tap to expand ⤢
                    </span>
                  </button>
                )}
                <Link
                  href={`/live/player/${event.playerId}`}
                  className="reel-card-body"
                >
                  <ReelAvatar playerId={event.playerId} />
                  <span className="reel-headline">{event.headline}</span>
                  <span className="reel-meta">
                    R{event.round} · view card →
                  </span>
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
      )}

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
