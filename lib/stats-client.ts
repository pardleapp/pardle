/**
 * Client-side helpers for the public-stats backend.
 *
 * We assign each browser a stable random id stored in localStorage so
 * the backend can deduplicate plays without us collecting any actual
 * personal data. The id is only ever used as a per-day idempotency
 * token; the server stores it under a 48-hour TTL and then forgets
 * about it.
 */

import type { StatsGameId } from "./stats-backend";

const USER_ID_KEY = "pardle.userId";
const POSTED_KEY_PREFIX = "pardle.statsPosted.";

function makeId(): string {
  // 16-byte random id, base36 encoded. Plenty unique, no crypto needed.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getUserId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = window.localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = makeId();
      window.localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function postedKey(game: StatsGameId, day: number): string {
  return `${POSTED_KEY_PREFIX}${game}.${day}`;
}

/**
 * Fire-and-forget record of a game completion. Safe to call multiple
 * times — both the client-side localStorage flag and the server's
 * Redis dedup will prevent double-counting.
 */
export async function recordPlayClient(args: {
  game: StatsGameId;
  day: number;
  isWin: boolean;
  score: number;
}): Promise<void> {
  if (typeof window === "undefined") return;
  // Client-side flag — saves a network round-trip when re-mounting an
  // already-finished game.
  try {
    const key = postedKey(args.game, args.day);
    if (window.localStorage.getItem(key) === "1") return;
    window.localStorage.setItem(key, "1");
  } catch {
    // ignore — we'll just rely on server-side dedup
  }

  try {
    await fetch("/api/stats/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...args,
        userToken: getUserId(),
      }),
      // Best-effort; if the network drops we don't surface anything.
      keepalive: true,
    });
  } catch {
    // ignore
  }
}
