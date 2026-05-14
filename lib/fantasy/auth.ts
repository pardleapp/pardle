/**
 * Magic-link auth — server-side primitives.
 *
 * Storage keys:
 *   fantasy:auth:token:{tokenHex}     → { email, createdAt } (15-min TTL)
 *   fantasy:auth:session:{sessionId}  → userId (30-day TTL)
 *   fantasy:auth:rate:{emailLower}    → 1 (60-sec TTL, rate-limits emails)
 *
 * Flow:
 *   1. POST email → mintMagicToken → email link to /api/fantasy/auth/verify?token=…
 *   2. GET token → consumeMagicToken → upsert user → createSession → set cookie → redirect
 *   3. Future requests → getCurrentUser reads cookie → returns User
 */

import "server-only";
import { cookies } from "next/headers";
import { Redis } from "@upstash/redis";
import { getUser, getUserByEmail, putUser } from "./store";
import type { User } from "./types";

const redis = Redis.fromEnv();

export const SESSION_COOKIE = "pardle_fantasy_session";
const TOKEN_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const RATE_LIMIT_SECONDS = 60;

interface MagicTokenPayload {
  email: string;
  createdAt: number;
}

function tokenKey(t: string): string {
  return `fantasy:auth:token:${t}`;
}
function sessionKey(s: string): string {
  return `fantasy:auth:session:${s}`;
}
function rateKey(emailLower: string): string {
  return `fantasy:auth:rate:${emailLower}`;
}

// ──────────────────────────────────────────────────────────────────
// Random hex IDs
// ──────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ──────────────────────────────────────────────────────────────────
// Magic-link tokens
// ──────────────────────────────────────────────────────────────────

/** Returns {token, rateLimited}. If rate-limited, no token is minted. */
export async function mintMagicToken(
  email: string,
): Promise<{ token: string | null; rateLimited: boolean }> {
  const lower = email.toLowerCase().trim();

  // Rate-limit one mint per minute per email
  const rateOk = await redis.set(rateKey(lower), "1", {
    nx: true,
    ex: RATE_LIMIT_SECONDS,
  });
  if (rateOk !== "OK") {
    return { token: null, rateLimited: true };
  }

  const token = randomHex(32); // 256-bit
  const payload: MagicTokenPayload = { email: lower, createdAt: Date.now() };
  await redis.set(tokenKey(token), payload, { ex: TOKEN_TTL_SECONDS });
  return { token, rateLimited: false };
}

/**
 * Validates the token and consumes it (one-time use). Returns the email
 * if valid; null if expired/missing.
 */
export async function consumeMagicToken(
  token: string,
): Promise<string | null> {
  const payload = await redis.get<MagicTokenPayload>(tokenKey(token));
  if (!payload) return null;
  await redis.del(tokenKey(token));
  return payload.email;
}

// ──────────────────────────────────────────────────────────────────
// Users
// ──────────────────────────────────────────────────────────────────

/**
 * Look up or create a user for this email. The first time someone
 * signs in we make a placeholder name from the email's local part —
 * they can rename inside any league later.
 */
export async function upsertUserByEmail(email: string): Promise<User> {
  const lower = email.toLowerCase().trim();
  const existing = await getUserByEmail(lower);
  if (existing) return existing;

  const localPart = lower.split("@")[0] ?? "player";
  const newUser: User = {
    id: randomHex(8),
    email: lower,
    name: localPart.replace(/[._-]+/g, " ").slice(0, 40),
    createdAt: Date.now(),
  };
  await putUser(newUser);
  return newUser;
}

// ──────────────────────────────────────────────────────────────────
// Sessions
// ──────────────────────────────────────────────────────────────────

/** Mint and store a new session. Returns the opaque session id. */
export async function createSession(userId: string): Promise<string> {
  const sid = randomHex(24); // 192-bit
  await redis.set(sessionKey(sid), userId, { ex: SESSION_TTL_SECONDS });
  return sid;
}

export async function destroySession(sid: string): Promise<void> {
  await redis.del(sessionKey(sid));
}

/** Reads the session cookie and returns the User, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const sid = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const userId = await redis.get<string>(sessionKey(sid));
  if (!userId) return null;
  return await getUser(userId);
}

/** Cookie attributes used when setting/clearing the session cookie. */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
