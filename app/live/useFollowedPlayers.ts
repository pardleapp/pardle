"use client";

/**
 * useFollowedPlayers — client-side hook for the "★ Follow" mechanism.
 *
 * A user can follow any player they want to see in the Smart feed
 * beyond their tracked bets. Followed players' shots flow into the
 * Smart tab regardless of whether the user has a bet on them.
 *
 * Persistence:
 *   localStorage → survives refresh, per-device
 *   later: Supabase row keyed by authorKey → cross-device sync
 *
 * Storage key: pardle_followed_players_v1 → JSON array of playerId.
 */

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "pardle_followed_players_v1";
const CHANGE_EVENT = "pardle:follows-changed";

function readStore(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeStore(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useFollowedPlayers(): {
  followed: string[];
  isFollowing: (playerId: string) => boolean;
  toggle: (playerId: string) => void;
  follow: (playerId: string) => void;
  unfollow: (playerId: string) => void;
} {
  const [followed, setFollowed] = useState<string[]>([]);
  useEffect(() => {
    setFollowed(readStore());
    const onChange = () => setFollowed(readStore());
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const follow = useCallback((playerId: string) => {
    if (!playerId) return;
    const cur = readStore();
    if (cur.includes(playerId)) return;
    writeStore([...cur, playerId]);
  }, []);

  const unfollow = useCallback((playerId: string) => {
    const cur = readStore();
    writeStore(cur.filter((id) => id !== playerId));
  }, []);

  const toggle = useCallback(
    (playerId: string) => {
      if (readStore().includes(playerId)) unfollow(playerId);
      else follow(playerId);
    },
    [follow, unfollow],
  );

  const isFollowing = useCallback(
    (playerId: string) => followed.includes(playerId),
    [followed],
  );

  return { followed, isFollowing, toggle, follow, unfollow };
}
