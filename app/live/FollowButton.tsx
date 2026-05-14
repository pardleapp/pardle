"use client";

import { useEffect, useState } from "react";

const FOLLOWS_STORAGE = "pardle_feed_follows";

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
  // Let other components on the page react (the feed filter toggle).
  window.dispatchEvent(new CustomEvent("pardle-follows-changed"));
}

interface Props {
  playerId: string;
  playerName: string;
}

export default function FollowButton({ playerId, playerName }: Props) {
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    setFollowing(getFollows().includes(playerId));
  }, [playerId]);

  function toggle() {
    const current = getFollows();
    const next = current.includes(playerId)
      ? current.filter((id) => id !== playerId)
      : [...current, playerId];
    setFollows(next);
    setFollowing(next.includes(playerId));
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
