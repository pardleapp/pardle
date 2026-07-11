/**
 * GET /api/admin/img-shadow-compare?tournamentId=X&limit=N
 *
 * Read `feed:events:{tournamentId}` (orchestrator-sourced) alongside
 * `feed:img-events:{tournamentId}` (IMG collector in shadow mode)
 * and return the latest N of each plus a latency comparison for
 * events that appear in both.
 *
 * Match key: (playerId, round, hole, type) — same triple identifies
 * the same real-world moment across sources. The delta in `ts`
 * between IMG's event and orchestrator's is the head-start.
 *
 * Used during the pre-flip evaluation window: shadow mode runs for
 * ≥1 full tournament, we pull this endpoint on Sunday evening, and
 * decide whether the numbers justify flipping IMG to primary.
 */

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FeedEventLike {
  id: string;
  tournamentId?: string;
  ts: number;
  type: string;
  playerId?: string;
  playerName?: string;
  round?: number;
  hole?: number;
  result?: string;
  strokes?: number;
  imgSourced?: boolean;
  headline?: string;
}

function parse(raw: unknown): FeedEventLike | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as FeedEventLike;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as FeedEventLike;
  return null;
}

function matchKey(e: FeedEventLike): string {
  return `${e.playerId ?? "?"}|${e.round ?? "?"}|${e.hole ?? "?"}|${e.type ?? "?"}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tournamentId = (url.searchParams.get("tournamentId") ?? "").trim();
  const limit = Math.min(500, Math.max(10, Number(url.searchParams.get("limit") ?? "100")));
  if (!tournamentId) {
    return NextResponse.json(
      { error: "missing tournamentId" },
      { status: 400 },
    );
  }

  const redis = Redis.fromEnv();
  const [orchRaw, imgRaw] = await Promise.all([
    redis.lrange<unknown>(`feed:events:${tournamentId}`, 0, limit - 1),
    redis.lrange<unknown>(`feed:img-events:${tournamentId}`, 0, limit - 1),
  ]);

  const orch = orchRaw.map(parse).filter((e): e is FeedEventLike => e !== null);
  const img = imgRaw.map(parse).filter((e): e is FeedEventLike => e !== null);

  // Index orchestrator events by match key so we can pair.
  const orchByKey = new Map<string, FeedEventLike>();
  for (const e of orch) {
    const k = matchKey(e);
    // First occurrence (newest, since LRANGE is head-first) wins.
    if (!orchByKey.has(k)) orchByKey.set(k, e);
  }
  const imgByKey = new Map<string, FeedEventLike>();
  for (const e of img) {
    const k = matchKey(e);
    if (!imgByKey.has(k)) imgByKey.set(k, e);
  }

  // Paired events → measure the head start.
  const paired: Array<{
    key: string;
    imgTs: number;
    orchTs: number;
    deltaMs: number; // orchTs - imgTs (positive = IMG ahead)
    player?: string;
    hole?: number;
    type?: string;
    imgHeadline?: string;
    orchHeadline?: string;
  }> = [];
  for (const [k, imgEv] of imgByKey.entries()) {
    const orchEv = orchByKey.get(k);
    if (!orchEv) continue;
    paired.push({
      key: k,
      imgTs: imgEv.ts,
      orchTs: orchEv.ts,
      deltaMs: orchEv.ts - imgEv.ts,
      player: imgEv.playerName ?? orchEv.playerName,
      hole: imgEv.hole ?? orchEv.hole,
      type: imgEv.type,
      imgHeadline: imgEv.headline,
      orchHeadline: orchEv.headline,
    });
  }
  paired.sort((a, b) => b.imgTs - a.imgTs);

  const positiveDeltas = paired
    .filter((p) => p.deltaMs > 0)
    .map((p) => p.deltaMs);
  const median = positiveDeltas.length
    ? positiveDeltas.sort((a, b) => a - b)[Math.floor(positiveDeltas.length / 2)]
    : null;
  const p90 = positiveDeltas.length
    ? positiveDeltas.sort((a, b) => a - b)[Math.floor(positiveDeltas.length * 0.9)]
    : null;
  const max = positiveDeltas.length ? Math.max(...positiveDeltas) : null;

  // IMG events with no orchestrator match (yet) — these are the ones
  // where IMG got there and orchestrator hasn't caught up. Confirms
  // the head-start pattern.
  const imgOnly = [...imgByKey.entries()]
    .filter(([k]) => !orchByKey.has(k))
    .map(([k, e]) => ({
      key: k,
      ts: e.ts,
      ageMs: Date.now() - e.ts,
      player: e.playerName,
      hole: e.hole,
      type: e.type,
      headline: e.headline,
    }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);

  return NextResponse.json({
    tournamentId,
    counts: {
      orchestrator: orch.length,
      img: img.length,
      paired: paired.length,
      imgOnlyCurrent: imgOnly.length,
    },
    headStart: {
      unit: "ms",
      medianAhead: median,
      p90Ahead: p90,
      maxAhead: max,
      samples: positiveDeltas.length,
    },
    recentPaired: paired.slice(0, 20),
    imgOnlyRecent: imgOnly,
  });
}
