/**
 * Map our active PGA tournament to DraftKings' eventGroupId. Cached
 * for 24h — DK uses a stable id per tournament, so once we've
 * matched it we don't have to re-discover.
 *
 * Server-only.
 */
import "server-only";
import { Redis } from "@upstash/redis";
import { listGolfEventGroups } from "./client";

const redis = Redis.fromEnv();
const CACHE_PREFIX = "feed:dk-event:";
const CACHE_TTL_S = 24 * 60 * 60;

export interface DKEventInfo {
  eventGroupId: number;
  eventGroupName: string;
}

function cacheKey(tournamentId: string): string {
  return `${CACHE_PREFIX}${tournamentId}`;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function discoverDKEvent(
  tournamentId: string,
  tournamentName: string,
): Promise<DKEventInfo | null> {
  const groups = await listGolfEventGroups();
  const needle = norm(tournamentName);
  const match = groups.find((g) => norm(g.name).includes(needle));
  if (!match) return null;
  const info: DKEventInfo = {
    eventGroupId: match.eventGroupId,
    eventGroupName: match.name,
  };
  await redis.set(cacheKey(tournamentId), info, { ex: CACHE_TTL_S });
  return info;
}

export async function getCachedDKEvent(
  tournamentId: string,
): Promise<DKEventInfo | null> {
  return (
    (await redis.get<DKEventInfo>(cacheKey(tournamentId))) ?? null
  );
}
