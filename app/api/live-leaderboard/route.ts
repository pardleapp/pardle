/**
 * /api/live-leaderboard
 *
 * Powers the v4 leaderboard-with-live-updates view. Returns one row
 * per player currently in the field, joining three data sources into
 * a single response so the client does one poll:
 *
 *   1. Pardle's cached leaderboard (position, name, total, thru, state)
 *   2. Latest FeedEvent per player from the events buffer
 *      (birdie/bogey/drive/putt/etc — whatever they just did)
 *   3. DataGolf live-tournament-stats for the current round
 *      (per-round SG: OTT, APP, ARG, PUTT, TOTAL)
 *
 * Merge key: player NAME (normalised) — Pardle's leaderboard uses PGA
 * Tour orchestrator playerId while DataGolf uses dg_id. We already
 * carry both keys in various caches but the cleanest cross-join is
 * on normalised display name.
 *
 * Cache: no server cache — the FeedClient pattern is 3s foreground
 * polling and we want the same freshness here.
 */

import { NextResponse } from "next/server";
import {
  getActiveTournament,
  type PGATournamentRef,
} from "@/lib/golf-api/pgatour";
import {
  getCachedLeaderboard,
  getEvents,
  getReactionsBulk,
  getCommentCountsBulk,
  getEmojiReactionsBulk,
  getSnapshot,
  getCachedTournamentPars,
  type CachedLeaderboardRow,
} from "@/lib/feed/store";
import type { FeedEvent, ReactionCounts } from "@/lib/feed/types";
import { loadHoleAveragesForRound } from "@/lib/hole-averages-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DG_BASE = "https://feeds.datagolf.com";

function apiKey(): string {
  const k = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  if (!k) throw new Error("DATAGOLF_API_KEY is not set");
  return k;
}

interface DGLiveRow {
  dg_id: number;
  player_name: string;
  current_pos?: string | number;
  current_score?: number;
  thru?: number | string;
  round?: number;
  sg_total?: number;
  sg_ott?: number;
  sg_app?: number;
  sg_arg?: number;
  sg_putt?: number;
}
interface DGLiveResp {
  event_name?: string;
  stat_round?: number;
  live_stats?: DGLiveRow[];
}

async function fetchDgLiveStats(round: number): Promise<DGLiveResp | null> {
  const stats = "sg_total,sg_ott,sg_app,sg_arg,sg_putt";
  const url = `${DG_BASE}/preds/live-tournament-stats?tour=pga&round=${round}&stats=${stats}&key=${encodeURIComponent(apiKey())}&file_format=json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as DGLiveResp;
  } catch (err) {
    console.warn(`[live-leaderboard] DG round=${round} failed:`, err);
    return null;
  }
}

/** Normalise display name — strip accents + non-letters, lowercase.
 *  DG uses "Last, First"; Pardle uses "First Last". Handle both. */
function normName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

function dgToFirstLast(name: string): string {
  const [last, first] = name.split(",").map((s) => s.trim());
  if (!first) return name.trim();
  return `${first} ${last}`;
}

/** DG live-tournament-stats returns whichever round is currently in
 *  play when you ask for it. We probe R4 → R1 and use the highest
 *  round that actually returns rows — that's the round with fresh
 *  data. Falls back to R1 if all probes fail. */
async function findActiveRoundWithData(): Promise<{
  round: number;
  payload: DGLiveResp | null;
}> {
  for (const r of [4, 3, 2, 1]) {
    const payload = await fetchDgLiveStats(r);
    if (payload?.live_stats?.length) {
      return { round: r, payload };
    }
  }
  return { round: 1, payload: null };
}

export interface LeaderboardRow {
  playerId: string;
  playerName: string;
  position: string;
  total: string;
  thru: string;
  playerState: string;
  /** SG breakdown for the current round — null when DG lookup failed. */
  sg: {
    ott: number | null;
    app: number | null;
    arg: number | null;
    putt: number | null;
    total: number | null;
  } | null;
  /** Latest event for this player from the buffer — null when no
   *  recent events for them. */
  latestEvent: FeedEvent | null;
  /** Up to N most-recent events (latest first). Used when the row
   *  is expanded to show the arc of the player's last few shots.
   *  Same underlying array `latestEvent` was picked from. */
  recentEvents: FeedEvent[];
}

/** Social state attached to a single event id. Server-side {up,down}
 *  reactions from Pardle's existing store + comment count from the
 *  comments store. Client hydrates its per-user emoji reactions on
 *  top of this baseline (matches v1 pattern). */
export interface EventSocial {
  reactions: ReactionCounts;
  /** Emoji → count. Global tally; the client tracks its own "mine"
   *  list in localStorage and merges on render. */
  emojiCounts: Record<string, number>;
  commentCount: number;
}

export interface LeaderboardResponse {
  ok: boolean;
  tournament: PGATournamentRef | null;
  activeRound: number;
  rows: LeaderboardRow[];
  /** eventId → server-side reactions + comment count. Client bulk-
   *  hydrates the social chips for every event in the response. */
  social: Record<string, EventSocial>;
  /** Per-round per-hole expected score-to-par with the live-first
   *  fallback chain. Client uses this to power round-score bet impact
   *  chips on this feed so they match the bet-detail page + tee-time
   *  chart projection method. Empty when the tournament id is
   *  unresolvable or the snapshot / historical fallback all miss. */
  holeAvgToParByRound?: Record<number, Record<number, number>>;
  /** Per-round par lookup for the current tournament, from the same
   *  snapshot bake. Client falls back to 72 when absent. */
  roundParByRound?: Record<number, number>;
  generatedAt: number;
  diag: {
    leaderboardCount: number;
    eventsCount: number;
    dgMatched: number;
    dgTotal: number;
  };
}

const RECENT_PER_PLAYER = 5;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const forcedTournament = url.searchParams.get("tournamentId");
    const active = forcedTournament
      ? { tournament: { id: forcedTournament, name: forcedTournament, startDate: 0 }, isLive: true }
      : await getActiveTournament();
    const tournament = active?.tournament ?? null;
    if (!tournament?.id) {
      return NextResponse.json({
        ok: false,
        tournament: null,
        activeRound: 1,
        rows: [],
        social: {},
        generatedAt: Date.now(),
        diag: { leaderboardCount: 0, eventsCount: 0, dgMatched: 0, dgTotal: 0 },
      } satisfies LeaderboardResponse);
    }

    const [leaderboard, events, snapshot, roundPars] = await Promise.all([
      getCachedLeaderboard(tournament.id).catch(() => [] as CachedLeaderboardRow[]),
      getEvents(tournament.id, 400).catch(() => [] as FeedEvent[]),
      getSnapshot(tournament.id).catch(() => null),
      getCachedTournamentPars(tournament.id).catch(
        () => ({}) as Record<number, Record<number, number>>,
      ),
    ]);

    // Bake per-round per-hole averages so the round-score impact
    // chips on this feed can use the SAME live-first fallback
    // (current round ≥15 samples → prev round → prev year → par) as
    // the bet detail page + tee-time chart. Loader is I/O-heavy on
    // first call (reads /data/historical), so run all 4 rounds in
    // parallel and only when we have a real snapshot to hand it.
    const holeAvgToParByRound: Record<number, Record<number, number>> = {};
    const roundParByRound: Record<number, number> = {};
    if (snapshot) {
      const rounds = [1, 2, 3, 4] as const;
      await Promise.all(
        rounds.map(async (r) => {
          const pars = roundPars[r] ?? {};
          const parTotal = Object.values(pars).reduce((a, b) => a + b, 0);
          if (parTotal > 0) roundParByRound[r] = parTotal;
          try {
            const { averages } = await loadHoleAveragesForRound({
              tournamentId: tournament.id,
              round: r,
              snapshot,
              holePars: pars,
            });
            holeAvgToParByRound[r] = averages;
          } catch {
            /* leave the round out of the map; client falls back to par */
          }
        }),
      );
    }

    const { round: activeRound, payload: dgLive } =
      await findActiveRoundWithData();
    const dgRows = dgLive?.live_stats ?? [];
    const dgByName = new Map<string, DGLiveRow>();
    for (const r of dgRows) {
      dgByName.set(normName(dgToFirstLast(r.player_name)), r);
    }

    // Latest + recent events per playerId. `events` is newest-first
    // so we just accumulate up to RECENT_PER_PLAYER per player in
    // order. Latest = first item in each list.
    const recentByPlayer = new Map<string, FeedEvent[]>();
    for (const ev of events) {
      const list = recentByPlayer.get(ev.playerId);
      if (!list) {
        recentByPlayer.set(ev.playerId, [ev]);
      } else if (list.length < RECENT_PER_PLAYER) {
        list.push(ev);
      }
    }

    let dgMatched = 0;
    const rows: LeaderboardRow[] = leaderboard.map((lb) => {
      const dg = dgByName.get(normName(lb.displayName));
      if (dg) dgMatched++;
      const sg = dg
        ? {
            ott: typeof dg.sg_ott === "number" ? dg.sg_ott : null,
            app: typeof dg.sg_app === "number" ? dg.sg_app : null,
            arg: typeof dg.sg_arg === "number" ? dg.sg_arg : null,
            putt: typeof dg.sg_putt === "number" ? dg.sg_putt : null,
            total: typeof dg.sg_total === "number" ? dg.sg_total : null,
          }
        : null;
      const recent = recentByPlayer.get(lb.playerId) ?? [];
      return {
        playerId: lb.playerId,
        playerName: lb.displayName,
        position: lb.position,
        total: lb.total,
        thru: lb.thru,
        playerState: lb.playerState,
        sg,
        latestEvent: recent[0] ?? null,
        recentEvents: recent,
      };
    });

    // Bulk-fetch reactions + comment counts for every event we're
    // shipping to the client. Doing this in one pass keeps request
    // latency flat regardless of leaderboard size.
    const allEventIds: string[] = [];
    for (const r of rows) {
      for (const ev of r.recentEvents) allEventIds.push(ev.id);
    }
    const [reactionsById, emojiCountsById, commentsById] = await Promise.all([
      getReactionsBulk(allEventIds).catch(() => ({}) as Record<string, ReactionCounts>),
      getEmojiReactionsBulk(allEventIds).catch(() => ({}) as Record<string, Record<string, number>>),
      getCommentCountsBulk(allEventIds).catch(() => ({}) as Record<string, number>),
    ]);
    const social: Record<string, EventSocial> = {};
    for (const id of allEventIds) {
      social[id] = {
        reactions: reactionsById[id] ?? { up: 0, down: 0 },
        emojiCounts: emojiCountsById[id] ?? {},
        commentCount: commentsById[id] ?? 0,
      };
    }

    return NextResponse.json({
      ok: true,
      tournament,
      activeRound,
      rows,
      social,
      holeAvgToParByRound,
      roundParByRound,
      generatedAt: Date.now(),
      diag: {
        leaderboardCount: leaderboard.length,
        eventsCount: events.length,
        dgMatched,
        dgTotal: dgRows.length,
      },
    } satisfies LeaderboardResponse);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
