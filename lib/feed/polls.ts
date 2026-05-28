/**
 * Feed predictions — a generic Poll primitive plus Redis storage.
 *
 * A Poll is a question with 2+ options that visitors vote on (one vote
 * each, changeable). The first poll we seed for any live tournament is
 * the "Who wins?" poll — options are the current top contenders, locked
 * once the poll is created. The same primitive can host over/under and
 * custom polls later.
 *
 * Keys:
 *   feed:poll:{pollId}                  → Poll JSON
 *   feed:polls:{tournamentId}           → list of pollIds (newest first)
 *   feed:poll-votes:{pollId}            → hash optionId → count
 *   feed:poll-voter:{pollId}:{visitor}  → optionId the visitor picked (30d TTL)
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const VOTER_TTL = 30 * 24 * 60 * 60;

export type PollKind = "winner" | "over-under" | "custom";

export interface PollOption {
  id: string; // e.g. a playerId, or "over" / "under"
  label: string;
}

export interface Poll {
  id: string;
  tournamentId: string;
  kind: PollKind;
  question: string;
  options: PollOption[];
  createdAt: number;
  /** Set once the real-world outcome is known. */
  resolvedOptionId?: string | null;
  /**
   * How the options were chosen — lets us detect and replace a poll
   * seeded by an older, worse heuristic (e.g. early-R1 leaderboard).
   */
  seededFrom?: string;
}

export interface PollWithVotes {
  poll: Poll;
  votes: Record<string, number>;
  totalVotes: number;
}

function pollKey(id: string) {
  return `feed:poll:${id}`;
}
function pollListKey(t: string) {
  return `feed:polls:${t}`;
}
function votesKey(id: string) {
  return `feed:poll-votes:${id}`;
}
function voterKey(pollId: string, visitor: string) {
  return `feed:poll-voter:${pollId}:${visitor}`;
}

function newPollId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ──────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────

export async function createPoll(
  args: Omit<Poll, "id" | "createdAt">,
): Promise<Poll> {
  const poll: Poll = {
    ...args,
    id: newPollId(),
    createdAt: Date.now(),
  };
  await redis.set(pollKey(poll.id), poll, { ex: 30 * 24 * 60 * 60 });
  await redis.lpush(pollListKey(poll.tournamentId), poll.id);
  await redis.expire(pollListKey(poll.tournamentId), 30 * 24 * 60 * 60);
  return poll;
}

export async function getPoll(id: string): Promise<Poll | null> {
  return (await redis.get<Poll>(pollKey(id))) ?? null;
}

/** Remove a poll, its vote tallies, and drop it from the tournament list. */
export async function deletePoll(
  tournamentId: string,
  pollId: string,
): Promise<void> {
  await redis.del(pollKey(pollId));
  await redis.del(votesKey(pollId));
  await redis.lrem(pollListKey(tournamentId), 0, pollId);
}

export async function listPolls(
  tournamentId: string,
): Promise<Poll[]> {
  const ids = await redis.lrange<string>(pollListKey(tournamentId), 0, 20);
  if (ids.length === 0) return [];
  const polls = await Promise.all(ids.map((id) => getPoll(id)));
  return polls.filter((p): p is Poll => p !== null);
}

/** True if a poll of `kind` already exists for this tournament. */
export async function hasPollOfKind(
  tournamentId: string,
  kind: PollKind,
): Promise<boolean> {
  const polls = await listPolls(tournamentId);
  return polls.some((p) => p.kind === kind);
}

// ──────────────────────────────────────────────────────────────────
// Voting
// ──────────────────────────────────────────────────────────────────

export async function getPollVotes(
  pollId: string,
): Promise<Record<string, number>> {
  const h = await redis.hgetall<Record<string, string>>(votesKey(pollId));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(h ?? {})) {
    out[k] = Number(v) || 0;
  }
  return out;
}

export async function getVoterChoice(
  pollId: string,
  visitor: string,
): Promise<string | null> {
  return (await redis.get<string>(voterKey(pollId, visitor))) ?? null;
}

/**
 * Cast or change a vote. If the visitor already voted for a different
 * option, that option is decremented and the new one incremented.
 * Returns the fresh vote counts, or null if the optionId is invalid.
 */
export async function castVote(
  pollId: string,
  visitor: string,
  optionId: string,
): Promise<Record<string, number> | null> {
  const poll = await getPoll(pollId);
  if (!poll) return null;
  if (!poll.options.some((o) => o.id === optionId)) return null;

  // Atomic SET+GET so two concurrent taps from the same visitor
  // can't both pass the prev != optionId check and double-
  // increment the new option. Was previously a read-then-write
  // pair with a race window between them.
  const prev = (await redis.set(voterKey(pollId, visitor), optionId, {
    ex: VOTER_TTL,
    get: true,
  })) as string | null;
  if (prev === optionId) {
    return getPollVotes(pollId); // no-op
  }

  const key = votesKey(pollId);
  if (prev) {
    await redis.hincrby(key, prev, -1);
  }
  await redis.hincrby(key, optionId, 1);
  return getPollVotes(pollId);
}

/** Bundle a poll with its vote tallies for the API response. */
export async function pollWithVotes(poll: Poll): Promise<PollWithVotes> {
  const votes = await getPollVotes(poll.id);
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  return { poll, votes, totalVotes };
}
