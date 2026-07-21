/**
 * /api/tee-shot-tour-average
 *
 * Tour-wide mean of the geometric shape parameters we use to draw
 * the "average ball flight" arc — carry, apex height/range, curve,
 * and horizontal launch angle (aim). Averaged across every player
 * we have ≥100 stored driver-off-the-tee shots for.
 *
 * The frontend draws this as a faint reference arc under whichever
 * player is currently selected, so viewers can eyeball "does this
 * guy hit it lower / longer / straighter than the field?" at a
 * glance.
 *
 * Cache 24 h — tour-wide means barely move day to day, and the
 * computation walks every ≥100-shot player's full shot history.
 */

import "server-only";
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  listRankedPlayers,
  getTeeShots,
} from "@/lib/feed/tee-shots-store";
import { buildProfile } from "@/lib/feed/tee-shots-profile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const redis = Redis.fromEnv();
const CACHE_TTL = 24 * 60 * 60;
const CACHE_KEY = "tee:tour-avg:v1";
const MIN_SHOTS = 100;

interface TourAveragePayload {
  shape: {
    carry: number;
    carrySide: number;
    apexHeight: number;
    apexRange: number;
    apexSide: number;
    curve: number;
  };
  aimDeg: number;
  playerCount: number;
  minShotsPerPlayer: number;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nocache = url.searchParams.get("nocache") === "1";
  if (!nocache) {
    try {
      const cached = await redis.get<TourAveragePayload>(CACHE_KEY);
      if (cached) {
        return NextResponse.json({ ok: true, cached: true, ...cached });
      }
    } catch {
      /* cache miss ok */
    }
  }

  const ranked = await listRankedPlayers(1000);
  const eligible = ranked.filter((r) => r.shotCount >= MIN_SHOTS);
  if (eligible.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no eligible players" },
      { status: 404 },
    );
  }

  interface PerPlayer {
    carry: number;
    carrySide: number;
    apexHeight: number;
    apexRange: number;
    apexSide: number;
    curve: number;
    aim: number;
  }
  const rows: PerPlayer[] = [];
  for (const p of eligible) {
    const records = await getTeeShots(p.playerId);
    if (!records || records.length === 0) continue;
    const profile = buildProfile(p.playerId, p.playerId, records, 0);
    if (!Number.isFinite(profile.shape.carry) || profile.shape.carry <= 0) {
      continue;
    }
    rows.push({
      carry: profile.shape.carry,
      carrySide: profile.shape.carrySide,
      apexHeight: profile.shape.apexHeight,
      apexRange: profile.shape.apexRange,
      apexSide: profile.shape.apexSide,
      curve: profile.shape.curve,
      aim: profile.stats.horizontalLaunchAngle.mean,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no shape data" },
      { status: 404 },
    );
  }

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const payload: TourAveragePayload = {
    shape: {
      carry: mean(rows.map((r) => r.carry)),
      carrySide: mean(rows.map((r) => r.carrySide)),
      apexHeight: mean(rows.map((r) => r.apexHeight)),
      apexRange: mean(rows.map((r) => r.apexRange)),
      apexSide: mean(rows.map((r) => r.apexSide)),
      curve: mean(rows.map((r) => r.curve)),
    },
    aimDeg: mean(rows.map((r) => r.aim)),
    playerCount: rows.length,
    minShotsPerPlayer: MIN_SHOTS,
  };

  try {
    await redis.set(CACHE_KEY, payload, { ex: CACHE_TTL });
  } catch {
    /* write-through failure is not fatal */
  }
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
