/**
 * GET/POST /api/admin/img-event-map
 *
 * Read + write the tournamentId ↔ IMG event id mapping. IMG's event
 * id catalogue changes weekly and doesn't correspond to PGA Tour ids,
 * so we maintain a small manual table the collector reads at startup.
 *
 * GET  → returns the current map + a suggested "next up" from the
 *        pgatour schedule so the operator can eyeball what's coming.
 * POST → { tournamentId: string, imgEventId: string | number, tournamentName?: string }
 *        upserts a mapping. CRON_SECRET-gated for write.
 *
 * The map lives at Redis key `admin:img-event-map`. Stored as a hash
 * so we can hset/hget individual entries and hgetall for read.
 */

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getSchedule } from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REDIS_KEY = "admin:img-event-map";

interface MapEntry {
  imgEventId: string;
  tournamentName?: string;
  updatedAt: number;
}

function redis() {
  return Redis.fromEnv();
}

export async function GET() {
  try {
    const raw = (await redis().hgetall<Record<string, MapEntry>>(REDIS_KEY)) || {};
    // Also compute a suggestion — the tournament active or next up on
    // the schedule so the operator knows what to map.
    const schedule = await getSchedule().catch(() => ({
      upcoming: [],
      completed: [],
    }));
    const now = Date.now();
    const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
    const inWindow = [...schedule.completed, ...schedule.upcoming]
      .filter((t) => now >= t.startDate && now <= t.startDate + FIVE_DAYS)
      .sort((a, b) => a.startDate - b.startDate);
    const nextUp = schedule.upcoming
      .filter((t) => t.startDate > now)
      .sort((a, b) => a.startDate - b.startDate)
      .slice(0, 4);

    return NextResponse.json({
      map: raw,
      liveWindow: inWindow.map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        mapped: !!raw[t.id],
      })),
      nextUp: nextUp.map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        mapped: !!raw[t.id],
      })),
    });
  } catch (err) {
    console.error("[img-event-map GET]", err);
    return NextResponse.json({ error: "fetch-failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron-disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: {
    tournamentId?: string;
    imgEventId?: string | number;
    tournamentName?: string;
    delete?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const tournamentId = (body.tournamentId ?? "").trim();
  if (!tournamentId) {
    return NextResponse.json({ error: "missing-tournamentId" }, { status: 400 });
  }

  const r = redis();
  if (body.delete === true) {
    await r.hdel(REDIS_KEY, tournamentId);
    return NextResponse.json({ ok: true, deleted: tournamentId });
  }

  const imgEventId = String(body.imgEventId ?? "").trim();
  if (!imgEventId) {
    return NextResponse.json({ error: "missing-imgEventId" }, { status: 400 });
  }
  const entry: MapEntry = {
    imgEventId,
    tournamentName: body.tournamentName?.trim() || undefined,
    updatedAt: Date.now(),
  };
  await r.hset(REDIS_KEY, { [tournamentId]: entry });
  return NextResponse.json({ ok: true, tournamentId, entry });
}
