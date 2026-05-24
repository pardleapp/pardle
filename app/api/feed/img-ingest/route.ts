import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getCachedLeaderboard } from "@/lib/feed/store";
import {
  getSnapshot,
  pushEvents,
  putSnapshot,
} from "@/lib/feed/store";

const redis = Redis.fromEnv();
import {
  classifyShot,
  type ParsedShot,
} from "@/lib/feed/shot-pbp";
import { ordinalHole, type FeedEvent } from "@/lib/feed/types";

/**
 * POST /api/feed/img-ingest
 *
 * External-source shot ingest. Designed for a home daemon scraping the
 * IMG Arena scoreboard from a Chrome instance on the user's machine —
 * IMG is fed by on-course spotters and lands 30–60 seconds ahead of
 * the PGA orchestrator. The daemon POSTs structured shot deltas as
 * they happen; we classify them with the same `classifyShot` logic the
 * orchestrator-polled path uses and push the resulting feed events.
 *
 * Body shape:
 * {
 *   "tournamentId": "R2026033",
 *   "shots": [
 *     {
 *       "playerName": "Rahm, Jon",         // IMG format, surname-first
 *       "hole": 11,
 *       "shotNum": 1,
 *       "shotYards": 356,                  // distance the shot travelled (null OK)
 *       "endsAt": "fairway",               // lowercased lie ("green"|"rough"|"water"|…)
 *       "toHoleFeet": 396,                 // remaining-to-hole in feet (null OK)
 *       "ts": 1779010000000
 *     }
 *   ]
 * }
 *
 * Auth: Bearer <IMG_INGEST_SECRET>. The endpoint refuses requests
 * when the secret isn't configured server-side (fail-closed).
 *
 * De-duplication: each (playerId, hole, shotNum, endsAt) tuple is
 * stored in the snapshot's `shots` map so the same shot can't fire
 * twice if the daemon retries. The orchestrator-polled diff uses the
 * same map, so a shot detected via ingest won't double-emit when the
 * orchestrator catches up.
 */
export const dynamic = "force-dynamic";

interface IngestShot {
  playerName: string;
  hole: number;
  shotNum: number;
  shotYards?: number | null;
  endsAt?: string | null;
  toHoleFeet?: number | null;
  ts: number;
}
interface IngestBody {
  tournamentId: string;
  shots: IngestShot[];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** IMG "SURNAME, Firstname" → orchestrator "First Last" → playerId. */
function buildNameIndex(
  rows: { playerId: string; displayName: string }[],
): Map<string, string> {
  const ix = new Map<string, string>();
  for (const r of rows) ix.set(norm(r.displayName), r.playerId);
  return ix;
}
function lookupPlayer(
  imgName: string,
  index: Map<string, string>,
): string | null {
  const parts = imgName.split(",").map((s) => s.trim());
  const key =
    parts.length === 2 ? norm(`${parts[1]} ${parts[0]}`) : norm(imgName);
  return index.get(key) ?? null;
}

export async function POST(req: Request) {
  const expected = process.env.IMG_INGEST_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "ingest-disabled-no-secret" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  if (!body.tournamentId || !Array.isArray(body.shots)) {
    return NextResponse.json({ error: "bad-payload" }, { status: 400 });
  }

  const leaderboard = await getCachedLeaderboard(body.tournamentId);
  if (leaderboard.length === 0) {
    return NextResponse.json({ skipped: "no-leaderboard-yet" });
  }
  const nameIx = buildNameIndex(leaderboard);

  const snap = await getSnapshot(body.tournamentId);
  if (!snap) {
    return NextResponse.json({ skipped: "no-snapshot-yet" });
  }
  if (!snap.shots) snap.shots = {};

  let matched = 0;
  let dupes = 0;
  const events: FeedEvent[] = [];
  let counter = 0;

  for (const s of body.shots) {
    const pid = lookupPlayer(s.playerName, nameIx);
    if (!pid) continue;
    matched++;

    // De-dup key: shot signature derived from the structured payload.
    // Same shape used by the orchestrator path so the two sources can't
    // both emit for the same physical shot.
    const sig = `img:${s.hole}:${s.shotNum}:${s.endsAt ?? ""}:${
      s.shotYards ?? ""
    }`;
    if (snap.shots[pid] === sig) {
      dupes++;
      continue;
    }
    snap.shots[pid] = sig;

    // Build a synthetic ParsedShot and feed it through the existing
    // classifier. Par is unavailable here (the daemon doesn't send it),
    // so long-drive detection via this path is disabled — the
    // orchestrator-polled path catches drives a minute or two later.
    const parsed: ParsedShot = {
      shotYards: s.shotYards ?? null,
      endsAt: (s.endsAt ?? null)?.toLowerCase() ?? null,
      toHoleFeet: s.toHoleFeet ?? null,
      status: null,
      fromLie: null,
      club: null,
    };
    const verdict = classifyShot(parsed, s.shotNum, null);
    if (!verdict) continue;

    const lbRow = leaderboard.find((r) => r.playerId === pid);
    const playerName = lbRow?.displayName ?? "Unknown";
    // Round number isn't on CachedLeaderboardRow but is recorded on
    // the snapshot under holes[playerId][round]. Take the highest
    // round with any played hole — that's the round currently in
    // progress for this player.
    const playerRounds = snap.holes[pid]
      ? Object.keys(snap.holes[pid]).map(Number)
      : [];
    const round = playerRounds.length > 0 ? Math.max(...playerRounds) : 1;

    events.push({
      id: `${s.ts}-i${(counter++).toString(36)}`,
      tournamentId: body.tournamentId,
      ts: s.ts,
      type: "shot",
      playerId: pid,
      playerName,
      round,
      hole: s.hole,
      shotYards: parsed.shotYards ?? undefined,
      proximityInches:
        parsed.toHoleFeet != null
          ? Math.round(parsed.toHoleFeet * 12)
          : undefined,
      highlight: verdict.highlight,
      lowlight: verdict.lowlight,
      headline: `${playerName} ${verdict.verdict} on the ${ordinalHole(s.hole)}`,
      emoji: verdict.emoji,
    });
  }

  await putSnapshot(body.tournamentId, snap);
  if (events.length > 0) {
    await pushEvents(body.tournamentId, events);
  }

  // Heartbeat: record the moment we last accepted an ingest body so
  // /api/feed/img-heartbeat can detect when the home daemon stops
  // posting during live play. Stored without TTL — the heartbeat
  // endpoint compares timestamp age, not key existence.
  await redis.set(`feed:img-last-ingest:${body.tournamentId}`, Date.now());

  return NextResponse.json({
    received: body.shots.length,
    matched,
    dupes,
    newShots: events.length,
  });
}
