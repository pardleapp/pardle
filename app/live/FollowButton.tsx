"use client";

import { useCallback, useEffect, useState } from "react";

const FOLLOWS_STORAGE = "pardle_feed_follows";
const FOLLOWS_EVENT = "pardle-follows-changed";

/** Read the followed-player id list from localStorage. */
export function getFollows(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FOLLOWS_STORAGE);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function setFollows(ids: string[]): void {
  window.localStorage.setItem(FOLLOWS_STORAGE, JSON.stringify(ids));
  // Notify every other FollowButton + the feed filter on the page.
  window.dispatchEvent(new CustomEvent(FOLLOWS_EVENT));
}

interface Props {
  playerId: string;
  playerName: string;
  /** "full" = labelled pill (player card); "icon" = compact star (feed rows). */
  variant?: "full" | "icon";
}

export default function FollowButton({
  playerId,
  playerName,
  variant = "full",
}: Props) {
  const [following, setFollowing] = useState(false);

  const sync = useCallback(() => {
    setFollowing(getFollows().includes(playerId));
  }, [playerId]);

  // Initial read + stay in sync when any other FollowButton toggles.
  useEffect(() => {
    sync();
    window.addEventListener(FOLLOWS_EVENT, sync);
    return () => window.removeEventListener(FOLLOWS_EVENT, sync);
  }, [sync]);

  function toggle() {
    const current = getFollows();
    const next = current.includes(playerId)
      ? current.filter((id) => id !== playerId)
      : [...current, playerId];
    setFollows(next);
    setFollowing(next.includes(playerId));
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={`follow-icon ${following ? "follow-icon-on" : ""}`}
        aria-pressed={following}
        aria-label={
          following ? `Unfollow ${playerName}` : `Follow ${playerName}`
        }
        title={following ? "Following" : "Follow"}
      >
        {following ? "★" : "☆"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`follow-btn ${following ? "follow-btn-on" : ""}`}
      aria-pressed={following}
      aria-label={
        following ? `Unfollow ${playerName}` : `Follow ${playerName}`
      }
    >
      {following ? "★ Following" : "☆ Follow"}
    </button>
  );
}
