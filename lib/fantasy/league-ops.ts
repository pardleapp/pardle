/**
 * Fantasy Golf — server-side league lifecycle operations.
 *
 * Encapsulates the multi-key writes for creating a league, joining one,
 * and updating picks. Validation errors throw `LeagueError` so the API
 * route can return a clean error response.
 *
 * Concurrency notes:
 *   The "league join" operation modifies the League row (push to
 *   memberIds) AND writes a new Membership row. We don't use Redis
 *   transactions — instead we accept the small race window since the
 *   downside (one of two simultaneous joiners is silently dropped) is
 *   visible to the dropped user and easily retried.
 */

import "server-only";
import {
  addLeagueToUser,
  getLeague,
  getLeagueByInvite,
  putLeague,
  putMembership,
} from "./store";
import {
  DEFAULT_MULTIPLIERS,
  DEFAULT_SCORING,
  DEFAULT_TIER_BREAKDOWN,
  INVITE_CODE_LENGTH,
  LEAGUE_ID_LENGTH,
  MAX_LEAGUE_MEMBERS,
  type League,
  type Membership,
  type User,
} from "./types";

export class LeagueError extends Error {
  constructor(
    public code:
      | "league-full"
      | "already-member"
      | "not-found"
      | "bad-name"
      | "bad-invite"
      | "locked",
    msg: string,
  ) {
    super(msg);
    this.name = "LeagueError";
  }
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // url-safe, no 0/o/l/1
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // readable

function randomFromAlphabet(len: number, alphabet: string): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[buf[i] % alphabet.length];
  }
  return out;
}

export function newLeagueId(): string {
  return randomFromAlphabet(LEAGUE_ID_LENGTH, ID_ALPHABET);
}

export function newInviteCode(): string {
  return randomFromAlphabet(INVITE_CODE_LENGTH, INVITE_ALPHABET);
}

// ──────────────────────────────────────────────────────────────────
// Create
// ──────────────────────────────────────────────────────────────────

export interface CreateLeagueArgs {
  name: string;
  tournamentId: string;
  creator: User;
  displayName?: string;
}

export async function createLeague(args: CreateLeagueArgs): Promise<League> {
  const name = args.name.trim().slice(0, 60);
  if (!name) throw new LeagueError("bad-name", "league name is required");

  const league: League = {
    id: newLeagueId(),
    name,
    createdByUserId: args.creator.id,
    createdAt: Date.now(),
    tournamentId: args.tournamentId,
    inviteCode: newInviteCode(),
    tierBreakdown: { ...DEFAULT_TIER_BREAKDOWN },
    scoring: { ...DEFAULT_SCORING },
    multipliers: { ...DEFAULT_MULTIPLIERS },
    status: "draft",
    memberIds: [args.creator.id],
  };

  const membership: Membership = {
    leagueId: league.id,
    userId: args.creator.id,
    displayName: args.displayName ?? args.creator.name,
    joinedAt: Date.now(),
    picks: [],
    captainDgId: null,
    viceCaptainDgId: null,
    doubleRound: null,
    picksLockedAt: null,
  };

  await putLeague(league);
  await putMembership(membership);
  await addLeagueToUser(args.creator.id, league.id);

  return league;
}

// ──────────────────────────────────────────────────────────────────
// Join by invite code
// ──────────────────────────────────────────────────────────────────

export interface JoinLeagueArgs {
  inviteCode: string;
  user: User;
  displayName?: string;
}

export async function joinLeagueByCode(
  args: JoinLeagueArgs,
): Promise<League> {
  const code = args.inviteCode.trim().toUpperCase();
  if (code.length !== INVITE_CODE_LENGTH) {
    throw new LeagueError("bad-invite", "invalid invite code");
  }

  const league = await getLeagueByInvite(code);
  if (!league) {
    throw new LeagueError("not-found", "league not found");
  }
  if (league.status === "completed") {
    throw new LeagueError("locked", "this league has already finished");
  }
  if (league.status === "locked") {
    throw new LeagueError(
      "locked",
      "picks are locked for this league — join us next tournament",
    );
  }
  if (league.memberIds.includes(args.user.id)) {
    // Idempotent: already-member is a no-op success.
    return league;
  }
  if (league.memberIds.length >= MAX_LEAGUE_MEMBERS) {
    throw new LeagueError("league-full", "league is full (10 player cap)");
  }

  league.memberIds.push(args.user.id);
  const membership: Membership = {
    leagueId: league.id,
    userId: args.user.id,
    displayName: args.displayName ?? args.user.name,
    joinedAt: Date.now(),
    picks: [],
    captainDgId: null,
    viceCaptainDgId: null,
    doubleRound: null,
    picksLockedAt: null,
  };

  await putLeague(league);
  await putMembership(membership);
  await addLeagueToUser(args.user.id, league.id);
  return league;
}

// ──────────────────────────────────────────────────────────────────
// Re-read (for read-after-write consistency in the same request)
// ──────────────────────────────────────────────────────────────────

export async function requireLeague(id: string): Promise<League> {
  const l = await getLeague(id);
  if (!l) throw new LeagueError("not-found", "league not found");
  return l;
}
