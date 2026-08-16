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
  findLeagueId as findDkLeagueId,
} from "@/lib/odds-compare/sources/draftkings";
import { fetchKalshiRoundScoreQuotes } from "@/lib/odds-compare/sources/kalshi";
import { fetchPrizePicksRoundScoreQuotes } from "@/lib/odds-compare/sources/prizepicks";
import { fetchUnderdogRoundScoreQuotes } from "@/lib/odds-compare/sources/underdog";
import { ingestKey } from "@/lib/odds-compare/ingest-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
/** Aggregator payload TTL. Round-score prices don't move fast
 *  enough to justify a 30 s refresh — 90 s cuts our ScraperAPI
 *  hits by 3× while still feeling live for a comparison view. */
const CACHE_TTL = 90;
/** Per-book "no data" cooldown. When a proxied source (PrizePicks,
 *  Underdog, Kalshi) returns zero quotes, we cache that empty
 *  state for 30 min so the aggregator hot path doesn't burn a
 *  ScraperAPI credit re-asking every 90 s during non-major weeks
 *  when those sources habitually have no golf props posted. */
const EMPTY_BOOK_COOLDOWN_SECONDS = 30 * 60;

function cacheKey(tournamentId: string, round: number): string {
  return `feed:odds-compare:v1:${tournamentId}:r${round}`;
}

function emptyCooldownKey(book: BookKey, tournamentId: string, round: number): string {
  return `feed:odds-compare:empty-cooldown:v1:${book}:${tournamentId}:r${round}`;
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
    // Capture as narrowed locals — TS re-widens outer consts to
    // their pre-guard nullable types inside nested function closures.
    const tidStr: string = tournamentId;
    const roundNum: number = round;
    /** Skip a proxied fetch when we saw the same book empty in the
     *  last 30 min. Returns the empty array + a shared "skipped"
     *  marker so status can still surface the reason. */
    async function callWithCooldown(
      book: BookKey,
      fn: () => Promise<RoundScoreQuote[]>,
    ): Promise<{ quotes: RoundScoreQuote[]; cooled: boolean }> {
      const cooldownKey = emptyCooldownKey(book, tidStr, roundNum);
      try {
        const cool = await redis.get<number>(cooldownKey);
        if (cool != null) return { quotes: [], cooled: true };
      } catch {
        /* cache miss */
      }
      const quotes = await fn();
      if (quotes.length === 0) {
        try {
          await redis.set(cooldownKey, 1, { ex: EMPTY_BOOK_COOLDOWN_SECONDS });
        } catch {
          /* not fatal */
        }
      }
      return { quotes, cooled: false };
    }

    const dkLeaguePromise = findDkLeagueId(tournamentName).catch(() => null);
    const dkQuotesPromise = (async () => {
      const id = await dkLeaguePromise;
      if (id == null) return [];
      return fetchDkRoundScoreQuotes(id, round);
    })();

    // Ingested books (FD/Caesars/BetMGM) come off Redis, populated
    // by the home Playwright scraper's POSTs to /api/odds-compare/ingest.
    // Each entry expires after 3 min if the scraper stops posting;
    // absence => stale-column state in bookStatus.
    interface IngestPayload {
      book: BookKey;
      receivedAt: string;
      quotes: RoundScoreQuote[];
    }
    const ingestReads = Promise.all(
      (["fanduel", "caesars", "betmgm"] as const).map(async (b) => {
        try {
          const payload = await redis.get<IngestPayload>(ingestKey(b));
          return { book: b, payload };
        } catch {
          return { book: b, payload: null };
        }
      }),
    );

    const [dk, pp, ud, ks, ingested] = await Promise.all([
      // DK is the primary source — no cooldown, we always want it.
      safeFetch(() => dkQuotesPromise),
      // PrizePicks / Underdog / Kalshi rarely post golf props outside
      // major weeks. Cooldown suppresses re-fetches when the last
      // response was empty, saving ScraperAPI credits on regular tour
      // stops (Kalshi is a public API but included for consistency).
      safeFetch(async () =>
        (await callWithCooldown("prizepicks", () => fetchPrizePicksRoundScoreQuotes(round))).quotes,
      ),
      safeFetch(async () =>
        (await callWithCooldown("underdog", () => fetchUnderdogRoundScoreQuotes(round))).quotes,
      ),
      safeFetch(async () =>
        (await callWithCooldown("kalshi", () => fetchKalshiRoundScoreQuotes(tournamentName, round))).quotes,
      ),
      ingestReads,
    ]);
    // Bucket ingested payloads per book. Filter to the requested
    // round — the scraper posts every round it can see, we serve
    // only the one asked for.
    const ingestedByBook = new Map<
      BookKey,
      { quotes: RoundScoreQuote[]; receivedAt: string | null }
    >();
    for (const { book, payload } of ingested) {
      const quotes = (payload?.quotes ?? []).filter((q) => q.round === round);
      ingestedByBook.set(book, {
        quotes,
        receivedAt: payload?.receivedAt ?? null,
      });
    }

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

    const countPlayers = (qs: RoundScoreQuote[]) =>
      new Set(qs.map((q) => normalisePlayerName(q.playerName))).size;
    const emptyNote = (qs: RoundScoreQuote[]) =>
      qs.length === 0 ? "no round-score lines posted" : undefined;

    /** Build book status for an ingested book: OK if a fresh
     *  payload is on Redis, "feed offline" when it isn't (scraper
     *  laptop closed / scraper broken). */
    const ingestStatus = (b: BookKey) => {
      const rec = ingestedByBook.get(b);
      if (!rec || rec.receivedAt == null) {
        return {
          ok: false,
          error: "home scraper offline",
          playerCount: 0,
        };
      }
      return {
        ok: true,
        error: rec.quotes.length === 0 ? emptyNote(rec.quotes) : undefined,
        playerCount: countPlayers(rec.quotes),
      };
    };

    const bookQuotes: Record<BookKey, RoundScoreQuote[]> = {
      draftkings: dk.quotes,
      fanduel: ingestedByBook.get("fanduel")?.quotes ?? [],
      caesars: ingestedByBook.get("caesars")?.quotes ?? [],
      betmgm: ingestedByBook.get("betmgm")?.quotes ?? [],
      prizepicks: pp.quotes,
      underdog: ud.quotes,
      kalshi: ks.quotes,
    };
    const bookStatus: Record<
      BookKey,
      { ok: boolean; error?: string; playerCount: number }
    > = {
      draftkings: {
        ok: dk.ok,
        error: dk.error ?? (dk.ok ? emptyNote(dk.quotes) : undefined),
        playerCount: countPlayers(dk.quotes),
      },
      fanduel: ingestStatus("fanduel"),
      caesars: ingestStatus("caesars"),
      betmgm: ingestStatus("betmgm"),
      prizepicks: {
        ok: pp.ok,
        error: pp.ok ? emptyNote(pp.quotes) : pp.error,
        playerCount: countPlayers(pp.quotes),
      },
      underdog: {
        ok: ud.ok,
        error: ud.ok ? emptyNote(ud.quotes) : ud.error,
        playerCount: countPlayers(ud.quotes),
      },
      kalshi: {
        ok: ks.ok,
        error: ks.ok ? emptyNote(ks.quotes) : ks.error,
        playerCount: countPlayers(ks.quotes),
      },
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
