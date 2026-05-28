import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { SHARP_MIN_CALLS } from "@/lib/feed/sharp-score";

/**
 * POST /api/sharp/bulk
 * Body: { authorKeys: string[] }
 *
 * Bulk Sharp Score lookup, used by CommentThread to render the
 * credibility chip next to every commenter name. A single Redis
 * pipeline hits every requested user in one round-trip — far
 * cheaper than N sequential getSharpScore calls.
 *
 * Returns:
 *   { stats: Record<authorKey, { total, correct, accuracy, qualified }> }
 *
 * Missing users are simply absent from the response. Authors with
 * zero calls return total: 0 so the client can decide whether to
 * render a chip (we hide it below ~3 calls to keep noise down).
 */
export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();
const MAX_BATCH = 100;

interface SharpChipRow {
  total: number;
  correct: number;
  accuracy: number;
  qualified: boolean;
}

export interface SharpBulkResponse {
  stats: Record<string, SharpChipRow>;
}

export async function POST(req: Request) {
  let body: { authorKeys?: unknown };
  try {
    body = (await req.json()) as { authorKeys?: unknown };
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const keys =
    Array.isArray(body.authorKeys)
      ? (body.authorKeys as unknown[])
          .filter((k): k is string => typeof k === "string" && k.length > 0)
          .slice(0, MAX_BATCH)
      : [];
  if (keys.length === 0) {
    return NextResponse.json({ stats: {} } satisfies SharpBulkResponse);
  }

  // Single Redis round-trip — one hgetall per author hash.
  const pipe = redis.pipeline();
  for (const k of keys) {
    pipe.hgetall(`sharp:user:${k}`);
  }
  const results = (await pipe.exec()) as (Record<string, string> | null)[];

  const stats: Record<string, SharpChipRow> = {};
  results.forEach((row, i) => {
    if (!row) return;
    const total = Number(row.total ?? 0);
    const correct = Number(row.correct ?? 0);
    if (total === 0) return;
    stats[keys[i]] = {
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
      qualified: total >= SHARP_MIN_CALLS,
    };
  });

  return NextResponse.json({ stats } satisfies SharpBulkResponse);
}
