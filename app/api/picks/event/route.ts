import { NextResponse } from "next/server";
import {
  getActiveTournament,
  getLeaderboard,
  getSchedule,
} from "@/lib/golf-api/pgatour";
import {
  getEventPick,
  getEventPickCount,
  setEventPick,
  type EventPick,
} from "@/lib/feed/event-picks";

/**
 * GET  /api/picks/event[?v=<authorKey>]
 * POST /api/picks/event { authorKey, playerId, playerName, displayName? }
 *
 * Reads or saves the user's outright-winner pick for the next
 * tournament. POST is rejected once the tournament has teed off
 * — picks must be locked at tee-off time so they're a real
 * prediction, not a hindsight tap.
 */
export const dynamic = "force-dynamic";

const AUTHOR_KEY_RE = /^[A-Za-z0-9]{8,128}$/;
const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function resolveTargetTournament(): Promise<
  | {
      id: string;
      name: string;
      startDate: number;
      isLive: boolean;
    }
  | null
> {
  // If a tournament is currently in window AND not yet teed off,
  // that's the pickable event. If one's already live, picks are
  // locked — return it but with isLive: true.
  const active = await getActiveTournament().catch(() => null);
  if (active) {
    return {
      id: active.tournament.id,
      name: active.tournament.name,
      startDate: active.tournament.startDate,
      isLive: active.isLive,
    };
  }
  // Off-week — find the next upcoming.
  const { upcoming } = await getSchedule().catch(() => ({ upcoming: [] }));
  const next = upcoming
    .filter((t) => t.startDate > Date.now())
    .sort((a, b) => a.startDate - b.startDate)[0];
  if (next) {
    return {
      id: next.id,
      name: next.name,
      startDate: next.startDate,
      isLive: false,
    };
  }
  return null;
}

export interface EventPickResponse {
  tournament: {
    id: string;
    name: string;
    startDate: number;
    locked: boolean;
  } | null;
  pick: EventPick | null;
  pickCount: number;
  /** Top of the field — top 60 by best-available world ranking
   *  proxy (their current/recent leaderboard position). Caller
   *  renders them in a searchable list. */
  field: Array<{ playerId: string; displayName: string }>;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const authorKey = url.searchParams.get("v") ?? "";

  const tournament = await resolveTargetTournament();
  if (!tournament) {
    return NextResponse.json({
      tournament: null,
      pick: null,
      pickCount: 0,
      field: [],
    } satisfies EventPickResponse);
  }

  const locked = tournament.startDate <= Date.now();
  const [leaderboard, pick, pickCount] = await Promise.all([
    getLeaderboard(tournament.id).catch(() => []),
    authorKey ? getEventPick(tournament.id, authorKey) : Promise.resolve(null),
    getEventPickCount(tournament.id),
  ]);

  const field = leaderboard
    .slice(0, 60)
    .map((r) => ({ playerId: r.playerId, displayName: r.displayName }));

  const body: EventPickResponse = {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      startDate: tournament.startDate,
      locked,
    },
    pick,
    pickCount,
    field,
  };
  return NextResponse.json(body);
}

export async function POST(req: Request) {
  let body: {
    authorKey?: string;
    playerId?: string;
    playerName?: string;
    displayName?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const authorKey = body.authorKey ?? "";
  if (!authorKey || !AUTHOR_KEY_RE.test(authorKey)) {
    return NextResponse.json({ error: "bad-authorKey" }, { status: 400 });
  }
  const playerId = body.playerId ?? "";
  if (!playerId || !PLAYER_ID_RE.test(playerId)) {
    return NextResponse.json({ error: "bad-playerId" }, { status: 400 });
  }
  const playerName =
    typeof body.playerName === "string" && body.playerName.length > 0
      ? body.playerName.slice(0, 80)
      : null;
  if (!playerName) {
    return NextResponse.json({ error: "bad-playerName" }, { status: 400 });
  }
  const displayName =
    typeof body.displayName === "string" && body.displayName.length > 0
      ? body.displayName.slice(0, 30)
      : undefined;

  const tournament = await resolveTargetTournament();
  if (!tournament) {
    return NextResponse.json({ error: "no-tournament" }, { status: 404 });
  }
  if (tournament.startDate <= Date.now()) {
    return NextResponse.json(
      { error: "locked", reason: "Picks lock when the tournament tees off." },
      { status: 403 },
    );
  }

  // Confirm the picked playerId actually exists in the field — saves
  // garbage from polluting the picks hash.
  const leaderboard = await getLeaderboard(tournament.id).catch(() => []);
  if (!leaderboard.find((r) => r.playerId === playerId)) {
    return NextResponse.json(
      { error: "player-not-in-field" },
      { status: 400 },
    );
  }

  const pick = await setEventPick(tournament.id, authorKey, {
    playerId,
    playerName,
    displayName,
  });
  return NextResponse.json({ ok: true, pick });
}
