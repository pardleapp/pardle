/**
 * Betfair session cache, backed by Redis (Pardle uses Redis everywhere
 * — no Prisma here). Session tokens last ~12h of activity / 4h idle;
 * we refresh proactively at the 8h mark.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import { login, type Auth, BetfairApiError } from "./client";

const redis = Redis.fromEnv();

const SESSION_KEY = "betfair:session";
const SESSION_TTL_S = 8 * 60 * 60; // 8 hours

function appKey(): string {
  const k = process.env.BETFAIR_APP_KEY;
  if (!k) throw new Error("BETFAIR_APP_KEY not set");
  return k;
}

function creds(): { username: string; password: string } {
  const username = process.env.BETFAIR_USERNAME;
  const password = process.env.BETFAIR_PASSWORD;
  if (!username || !password) {
    throw new Error("BETFAIR_USERNAME and BETFAIR_PASSWORD must be set");
  }
  return { username, password };
}

interface CachedSession {
  token: string;
  expiresAt: number;
}

export async function getBetfairAuth(opts?: {
  forceRefresh?: boolean;
}): Promise<Auth> {
  if (!opts?.forceRefresh) {
    const cached = await redis.get<CachedSession>(SESSION_KEY);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return { appKey: appKey(), sessionToken: cached.token };
    }
  }
  const { username, password } = creds();
  const token = await login({ appKey: appKey(), username, password });
  await redis.set<CachedSession>(
    SESSION_KEY,
    { token, expiresAt: Date.now() + SESSION_TTL_S * 1000 },
    { ex: SESSION_TTL_S },
  );
  return { appKey: appKey(), sessionToken: token };
}

/** Call a Betfair function; on 401/403 force a re-login and retry once. */
export async function withBetfairAuth<T>(
  fn: (auth: Auth) => Promise<T>,
): Promise<T> {
  const auth = await getBetfairAuth();
  try {
    return await fn(auth);
  } catch (err) {
    if (err instanceof BetfairApiError && (err.status === 401 || err.status === 403)) {
      const fresh = await getBetfairAuth({ forceRefresh: true });
      return await fn(fresh);
    }
    throw err;
  }
}
