/**
 * Redis publisher for the IMG ShotLink collector.
 *
 * Takes structured shot events from the DOM scraper and pushes them
 * to the same `feed:events:{tournamentId}` list the main /api/feed
 * pipeline reads from — so IMG-sourced shots appear in the feed
 * transparently, no downstream changes needed.
 *
 * Uses `@upstash/redis` over HTTPS so the collector doesn't need a
 * persistent Redis TCP connection (Fly Machines can be short-lived).
 * Same client the main app uses; identical wire contract.
 */

import { Redis } from "@upstash/redis";
import { translateImgShot, translateImgHoleOut } from "./translator.mjs";

const FEED_MAX_EVENTS = 1000;
const NAME_MAP_TTL = 15 * 60; // seconds — re-fetch every 15 min

export function createPublisher({
  tournamentId,
  tournamentName,
  redisUrl,
  redisToken,
  shadowMode = false,
}) {
  if (!tournamentId) throw new Error("publisher: tournamentId required");
  if (!redisUrl || !redisToken)
    throw new Error("publisher: UPSTASH_REDIS_REST_URL + TOKEN required");

  const redis = new Redis({ url: redisUrl, token: redisToken });
  // Shadow mode writes to a parallel `feed:img-events:{tournamentId}` key
  // instead of the live `feed:events:{tournamentId}`. Used during the
  // side-by-side comparison window before we trust IMG as primary.
  const outKey = shadowMode
    ? `feed:img-events:${tournamentId}`
    : `feed:events:${tournamentId}`;

  // Player name → playerId cache. Rebuilt from the cached leaderboard
  // the main app maintains at `feed:leaderboard:{tournamentId}`.
  let nameToId = new Map();
  let nameMapFetchedAt = 0;
  let currentRound = null;
  let pars = {};

  async function refreshMapsIfStale() {
    if (Date.now() - nameMapFetchedAt < NAME_MAP_TTL * 1000) return;
    try {
      const [leaderboard, parsRaw] = await Promise.all([
        redis.get(`feed:leaderboard:${tournamentId}`),
        redis.get(`feed:pars:${tournamentId}`),
      ]);
      if (Array.isArray(leaderboard)) {
        const m = new Map();
        for (const r of leaderboard) {
          if (r.playerId && r.displayName) {
            // Widget names come "LASTNAME, First" but with case
            // normalisation like "Keefer, Johnny". Cache both raw
            // and normalised for tolerant lookup.
            m.set(r.displayName, r.playerId);
            m.set(normaliseName(r.displayName), r.playerId);
          }
        }
        nameToId = m;
      }
      if (parsRaw && typeof parsRaw === "object") {
        pars = parsRaw;
        // Round from the presence of scored holes on any player,
        // roughly. We infer from the highest round with any pars.
        const rounds = Object.keys(pars).map(Number).filter(Number.isFinite);
        if (rounds.length > 0) currentRound = Math.max(...rounds);
      }
      nameMapFetchedAt = Date.now();
    } catch (err) {
      // Silent — collector should keep running even if Upstash is
      // briefly unhappy. Next tick retries.
      console.error("[publisher] refreshMaps failed", err.message);
    }
  }

  function normaliseName(s) {
    return (s || "").toLowerCase().replace(/[^a-z]/g, "");
  }

  // Dedup ring — we emit at most one FeedEvent per (player, hole,
  // shotNum, state) tuple. Keeps a rolling set of the last 400 keys.
  const emitted = new Set();
  const emittedOrder = [];
  function shouldEmit(key) {
    if (emitted.has(key)) return false;
    emitted.add(key);
    emittedOrder.push(key);
    if (emittedOrder.length > 400) {
      emitted.delete(emittedOrder.shift());
    }
    return true;
  }

  async function pushToRedis(event) {
    try {
      await redis.lpush(outKey, JSON.stringify(event));
      await redis.ltrim(outKey, 0, FEED_MAX_EVENTS - 1);
    } catch (err) {
      console.error("[publisher] LPUSH failed", err.message);
    }
  }

  return {
    /**
     * Publish an IMG shot event. Returns the FeedEvent that was
     * pushed (or null if it was deduped / not shape-eligible).
     */
    async publishShot(imgShot) {
      await refreshMapsIfStale();
      const playerId =
        nameToId.get(imgShot.player) ||
        nameToId.get(normaliseName(imgShot.player)) ||
        null;
      if (!playerId) {
        // No id yet — the leaderboard cache hasn't caught up. Emit an
        // "orphan" flag so we can measure this at heartbeat time.
        return { orphan: true, reason: "player-not-in-leaderboard" };
      }
      const round = currentRound ?? 1;
      const par = pars[round]?.[imgShot.hole] ?? null;

      // Terminal "shot lands with precise distance" is the only IMG
      // state we surface as a `type:"shot"` FeedEvent. Addressing /
      // hit-ball / approx-lie are intermediate — useful signals for a
      // future putt-poll head-start but not final shot events.
      const isTerminalShot =
        imgShot.state === "shot" &&
        imgShot.surface &&
        !imgShot.approxLie &&
        !/^Ball Holed$/i.test(imgShot.surface || "") &&
        imgShot.shotDistance != null;

      const isHoleOut = /Ball Holed/i.test(imgShot.surface || "");

      if (isHoleOut) {
        const key = `holeout:${playerId}:${round}:${imgShot.hole}`;
        if (!shouldEmit(key)) return null;
        const event = translateImgHoleOut({
          tournamentId,
          tournamentName,
          playerId,
          playerName: imgShot.player,
          round,
          hole: imgShot.hole,
          strokes: imgShot.shotNum,
          par,
        });
        if (event) await pushToRedis(event);
        return event;
      }

      if (isTerminalShot) {
        const key = `shot:${playerId}:${round}:${imgShot.hole}:${imgShot.shotNum}`;
        if (!shouldEmit(key)) return null;
        const event = translateImgShot({
          tournamentId,
          tournamentName,
          playerId,
          playerName: imgShot.player,
          round,
          hole: imgShot.hole,
          shotNum: imgShot.shotNum,
          shotDistance: imgShot.shotDistance,
          shotDistanceUnit: imgShot.shotDistanceUnit,
          surface: imgShot.surface,
          toPin: imgShot.toPin,
          par,
        });
        if (event) await pushToRedis(event);
        return event;
      }

      return null;
    },

    stats() {
      return {
        nameMapSize: nameToId.size,
        nameMapFetchedAt,
        currentRound,
        emittedCount: emittedOrder.length,
        outKey,
        shadowMode,
      };
    },
  };
}
