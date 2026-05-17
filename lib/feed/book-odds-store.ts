/**
 * Per-book outright winner odds buffer (DraftKings + FanDuel via
 * The Odds API). Parallel to the Polymarket buffer in odds-store.ts
 * — same shape, same dedup/force-push semantics — so the bet
 * tracker chart code can read all three sources uniformly.
 *
 * Server-only.
 */

import "server-only";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export type BookKey = "draftkings" | "fanduel";

const MAX_SAMPLES = 720;
const FORCE_PUSH_MS = 5 * 60 * 1000;

export interface BookOddsSample {
  ts: number;
  p: number; // decimal odds
}

function bookKey(tournamentId: string, book: BookKey): string {
  return `feed:book-odds:${tournamentId}:${book}`;
}

export async function pushBookOdds(
  tournamentId: string,
  book: BookKey,
  latest: Record<string, number>,
  ts: number,
): Promise<{ updated: number; players: number }> {
  const pids = Object.keys(latest);
  if (pids.length === 0) return { updated: 0, players: 0 };

  const existing = await redis.hmget<Record<string, BookOddsSample[]>>(
    bookKey(tournamentId, book),
    ...pids,
  );
  const writes: Record<string, BookOddsSample[]> = {};
  let updated = 0;

  for (const pid of pids) {
    const buf: BookOddsSample[] = existing?.[pid] ?? [];
    const newPrice = latest[pid];
    if (!Number.isFinite(newPrice) || newPrice <= 1) continue;
    const head = buf[buf.length - 1];
    if (head) {
      const rel = Math.abs(newPrice - head.p) / head.p;
      const ageMs = ts - head.ts;
      if (rel < 0.005 && ageMs < FORCE_PUSH_MS) {
        head.ts = ts;
        writes[pid] = buf.slice(-MAX_SAMPLES);
        continue;
      }
    }
    buf.push({ ts, p: newPrice });
    writes[pid] = buf.slice(-MAX_SAMPLES);
    updated++;
  }

  if (Object.keys(writes).length === 0) {
    return { updated, players: pids.length };
  }
  await redis.hset(bookKey(tournamentId, book), writes);
  return { updated, players: pids.length };
}

export async function getBookOddsBuffers(tournamentId: string): Promise<
  Record<BookKey, Record<string, BookOddsSample[] | null>>
> {
  const [dk, fd] = await Promise.all([
    redis.hgetall<Record<string, BookOddsSample[] | null>>(
      bookKey(tournamentId, "draftkings"),
    ),
    redis.hgetall<Record<string, BookOddsSample[] | null>>(
      bookKey(tournamentId, "fanduel"),
    ),
  ]);
  return {
    draftkings: dk ?? {},
    fanduel: fd ?? {},
  };
}
