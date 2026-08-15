/**
 * /api/odds-compare?round=1
 *
 * Cross-book round-score O/U aggregator. Fans out to every book
 * source in parallel, normalises into the common RoundScoreQuote
 * shape, groups by (player, round, line), and returns rows the UI
 * can render side-by-side.
 *
 * v1 covers DraftKings only; Kalshi + FanDuel + Caesars + BetMGM
 * plug in via the same sources/ pattern. Per-book failures are
 * isolated — one book being down doesn't take the whole payload
 * with it; bookStatus surfaces the health per source.
 *
 * Cached ~30s in Redis. The bet-tracker product pillar wants odds
 * moves within seconds, but 30s is a reasonable ceiling for a
 * comparison view where the point is spread across books rather
 * than tracking one price ticking down.
 */

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getActiveTournament, getLeaderboard } from "@/lib/golf-api/pgatour";
import type {
  BookKey,
  CompareRow,
  OddsCompareResponse,
  RoundScoreQuote,
} from "@/lib/odds-compare/types";
import {
  fetchDkRoundScoreQuotes,
  findEventGroup as findDkEventGroup,
} from "@/lib/odds-compare/sources/draftkings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const CACHE_TTL = 30; // seconds

function cacheKey(tournamentId: string, round: number): string {
  return `feed:odds-compare:v1:${tournamentId}:r${round}`;
}

/** Normalise a player name so DK's "R. McIlroy" and PGA Tour's
 *  "Rory McIlroy" both key the same. Lowercase, drop punctuation,
 *  strip common suffixes, collapse whitespace. */
function normalisePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Bucket quotes into (player, line) groups so the UI can render
 *  one row per line with a column per book. Round is already
 *  scoped by the request. */
function bucketQuotes(quotes: RoundScoreQuote[]): CompareRow[] {
  const byKey = new Map<string, CompareRow>();
  for (const q of quotes) {
    const key = `${normalisePlayerName(q.playerName)}|${q.line.toFixed(1)}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        playerName: q.playerName,
        round: q.round,
        line: q.line,
        quotes: [],
      };
      byKey.set(key, row);
    }
    row.quotes.push(q);
  }
  return [...byKey.values()];
}

interface FetchResult {
  ok: boolean;
  error?: string;
  quotes: RoundScoreQuote[];
}

async function safeFetch(
  fn: () => Promise<RoundScoreQuote[]>,
): Promise<FetchResult> {
  try {
    const quotes = await fn();
    return { ok: true, quotes };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 200) : "fetch failed",
      quotes: [],
    };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const roundParam = url.searchParams.get("round");
    const round = roundParam && /^[1-4]$/.test(roundParam) ? Number(roundParam) : null;
    const nocache = url.searchParams.get("nocache") === "1";

    const active = await getActiveTournament();
    const tournamentId = active?.tournament?.id ?? null;
    const tournamentName = active?.tournament?.name ?? null;
    if (!tournamentId || !tournamentName || round == null) {
      return NextResponse.json(
        {
          ok: false,
          error: "no active tournament or round param missing",
        },
        { status: round == null ? 400 : 404 },
      );
    }

    // Cache read (short TTL — we're chasing live pricing).
    if (!nocache) {
      try {
        const cached = await redis.get<OddsCompareResponse>(
          cacheKey(tournamentId, round),
        );
        if (cached) {
          return NextResponse.json({ ...cached, cached: true });
        }
      } catch {
        /* cache miss */
      }
    }

    // Resolve each book's active event id, then pull round-score quotes
    // for the requested round. Parallel + isolated.
    const dkEventGroupPromise = findDkEventGroup(tournamentName).catch(
      () => null,
    );
    const dkQuotesPromise = (async () => {
      const id = await dkEventGroupPromise;
      if (id == null) return [];
      return fetchDkRoundScoreQuotes(id, round);
    })();

    const [dk] = await Promise.all([safeFetch(() => dkQuotesPromise)]);

    // Trim to the top-30 by outright — matches the "contenders only"
    // decision. If leaderboard is unavailable, keep everyone (rare —
    // leaderboard cache is very warm).
    let filterNames: Set<string> | null = null;
    try {
      const lb = await getLeaderboard(tournamentId);
      const top = lb.slice(0, 30);
      filterNames = new Set(top.map((p) => normalisePlayerName(p.displayName)));
    } catch {
      /* graceful */
    }

    const bookQuotes: Record<BookKey, RoundScoreQuote[]> = {
      draftkings: dk.quotes,
      fanduel: [],
      caesars: [],
      betmgm: [],
      kalshi: [],
    };
    const bookStatus: Record<
      BookKey,
      { ok: boolean; error?: string; playerCount: number }
    > = {
      draftkings: {
        ok: dk.ok,
        error: dk.error,
        playerCount: new Set(dk.quotes.map((q) => normalisePlayerName(q.playerName)))
          .size,
      },
      fanduel: { ok: false, error: "not yet integrated", playerCount: 0 },
      caesars: { ok: false, error: "not yet integrated", playerCount: 0 },
      betmgm: { ok: false, error: "not yet integrated", playerCount: 0 },
      kalshi: { ok: false, error: "not yet integrated", playerCount: 0 },
    };

    // Flatten + optionally filter to top-30 by leaderboard.
    const all: RoundScoreQuote[] = Object.values(bookQuotes).flat();
    const filtered = filterNames
      ? all.filter((q) => filterNames!.has(normalisePlayerName(q.playerName)))
      : all;
    const rows = bucketQuotes(filtered).sort((a, b) =>
      a.playerName.localeCompare(b.playerName),
    );

    const payload: OddsCompareResponse = {
      ok: true,
      tournamentId,
      tournamentName,
      round,
      generatedAt: new Date().toISOString(),
      bookStatus,
      rows,
    };

    try {
      await redis.set(cacheKey(tournamentId, round), payload, { ex: CACHE_TTL });
    } catch {
      /* cache write not fatal */
    }
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
