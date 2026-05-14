/**
 * Fantasy Golf — Upstash Redis adapter.
 *
 * Storage keys (all string blobs of JSON unless noted):
 *   fantasy:tournament:{id}                → Tournament
 *   fantasy:user:{id}                      → User
 *   fantasy:user-by-email:{lowerEmail}     → userId (plain string)
 *   fantasy:league:{id}                    → League
 *   fantasy:invite:{code}                  → leagueId (plain string)
 *   fantasy:membership:{leagueId}:{userId} → Membership
 *   fantasy:user-leagues:{userId}          → JSON: string[]
 *
 * League and user data sets are small per friend group (~10 members,
 * ~6 picks each), so a JSON-blob-per-entity layout keeps the schema
 * trivial and avoids cross-key transactions.
 *
 * Server-only — do not import from client components.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import type {
  League,
  Membership,
  Tournament,
  User,
} from "./types";

const redis = Redis.fromEnv();

const TOURNAMENT_TTL_DAYS = 60; // keep ~2 months of past tournaments for history
const INVITE_TTL_DAYS = 60;

function days(n: number): number {
  return n * 24 * 60 * 60;
}

// ──────────────────────────────────────────────────────────────────
// Tournament
// ──────────────────────────────────────────────────────────────────

export async function getTournament(
  id: string,
): Promise<Tournament | null> {
  const blob = await redis.get<Tournament>(`fantasy:tournament:${id}`);
  return blob ?? null;
}

export async function putTournament(t: Tournament): Promise<void> {
  await redis.set(`fantasy:tournament:${t.id}`, t, {
    ex: days(TOURNAMENT_TTL_DAYS),
  });
}

// ──────────────────────────────────────────────────────────────────
// User
// ──────────────────────────────────────────────────────────────────

export async function getUser(id: string): Promise<User | null> {
  return (await redis.get<User>(`fantasy:user:${id}`)) ?? null;
}

export async function getUserByEmail(
  email: string,
): Promise<User | null> {
  const id = await redis.get<string>(
    `fantasy:user-by-email:${email.toLowerCase()}`,
  );
  if (!id) return null;
  return getUser(id);
}

export async function putUser(user: User): Promise<void> {
  await redis.set(`fantasy:user:${user.id}`, user);
  await redis.set(
    `fantasy:user-by-email:${user.email.toLowerCase()}`,
    user.id,
  );
}

// ──────────────────────────────────────────────────────────────────
// League
// ──────────────────────────────────────────────────────────────────

export async function getLeague(id: string): Promise<League | null> {
  return (await redis.get<League>(`fantasy:league:${id}`)) ?? null;
}

export async function getLeagueByInvite(
  code: string,
): Promise<League | null> {
  const leagueId = await redis.get<string>(
    `fantasy:invite:${code.toUpperCase()}`,
  );
  if (!leagueId) return null;
  return getLeague(leagueId);
}

export async function putLeague(league: League): Promise<void> {
  await redis.set(`fantasy:league:${league.id}`, league);
  await redis.set(
    `fantasy:invite:${league.inviteCode.toUpperCase()}`,
    league.id,
    { ex: days(INVITE_TTL_DAYS) },
  );
}

// ──────────────────────────────────────────────────────────────────
// Membership
// ──────────────────────────────────────────────────────────────────

function membershipKey(leagueId: string, userId: string): string {
  return `fantasy:membership:${leagueId}:${userId}`;
}

export async function getMembership(
  leagueId: string,
  userId: string,
): Promise<Membership | null> {
  return (await redis.get<Membership>(membershipKey(leagueId, userId))) ?? null;
}

export async function putMembership(m: Membership): Promise<void> {
  await redis.set(membershipKey(m.leagueId, m.userId), m);
}

/** Bulk fetch every membership for a league, in member-id order. */
export async function listMembershipsForLeague(
  league: League,
): Promise<Membership[]> {
  if (league.memberIds.length === 0) return [];
  const keys = league.memberIds.map((uid) => membershipKey(league.id, uid));
  const rows = await redis.mget<Membership[]>(...keys);
  return rows.filter((r): r is Membership => r !== null);
}

// ──────────────────────────────────────────────────────────────────
// User → leagues index
// ──────────────────────────────────────────────────────────────────

export async function getLeaguesForUser(userId: string): Promise<string[]> {
  return (
    (await redis.get<string[]>(`fantasy:user-leagues:${userId}`)) ?? []
  );
}

export async function addLeagueToUser(
  userId: string,
  leagueId: string,
): Promise<void> {
  const list = await getLeaguesForUser(userId);
  if (!list.includes(leagueId)) {
    list.push(leagueId);
    await redis.set(`fantasy:user-leagues:${userId}`, list);
  }
}
