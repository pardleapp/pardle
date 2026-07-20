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
  type CachedLeaderboardRow,
} from "@/lib/feed/store";
import type { FeedEvent } from "@/lib/feed/types";

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
}

export interface LeaderboardResponse {
  ok: boolean;
  tournament: PGATournamentRef | null;
  activeRound: number;
  rows: LeaderboardRow[];
  generatedAt: number;
  diag: {
    leaderboardCount: number;
    eventsCount: number;
    dgMatched: number;
    dgTotal: number;
  };
}

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
        generatedAt: Date.now(),
        diag: { leaderboardCount: 0, eventsCount: 0, dgMatched: 0, dgTotal: 0 },
      } satisfies LeaderboardResponse);
    }

    const [leaderboard, events] = await Promise.all([
      getCachedLeaderboard(tournament.id).catch(() => [] as CachedLeaderboardRow[]),
      getEvents(tournament.id, 400).catch(() => [] as FeedEvent[]),
    ]);

    const { round: activeRound, payload: dgLive } =
      await findActiveRoundWithData();
    const dgRows = dgLive?.live_stats ?? [];
    const dgByName = new Map<string, DGLiveRow>();
    for (const r of dgRows) {
      dgByName.set(normName(dgToFirstLast(r.player_name)), r);
    }

    // Latest event per playerId — events are already newest-first.
    const latestByPlayer = new Map<string, FeedEvent>();
    for (const ev of events) {
      if (!latestByPlayer.has(ev.playerId)) {
        latestByPlayer.set(ev.playerId, ev);
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
      return {
        playerId: lb.playerId,
        playerName: lb.displayName,
        position: lb.position,
        total: lb.total,
        thru: lb.thru,
        playerState: lb.playerState,
        sg,
        latestEvent: latestByPlayer.get(lb.playerId) ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      tournament,
      activeRound,
      rows,
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
