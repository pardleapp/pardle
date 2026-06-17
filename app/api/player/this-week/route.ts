import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getFeedBundle } from "@/lib/feed/store";
import {
  fieldRank,
  findStatsByName,
  getLiveStatsCached,
} from "@/lib/feed/live-stats-cache";

export const dynamic = "force-dynamic";

/**
 * Two-layer cache:
 *
 *   CDN (s-maxage=20, swr=60)  — repeat polls served from the edge
 *     without invoking the function. Twenty seconds is well inside
 *     DataGolf's own ~2 min upstream lag, so it costs no perceived
 *     freshness.
 *
 *   Redis (45 s TTL, key by playerId + tournament id) — catches
 *     cache misses across cold starts and edge regions. The
 *     underlying live-stats cache already holds the field-wide DG
 *     payload for 5 min, so the only work this saves is the
 *     name lookup + 11 field-rank loops per request. Cheap, but
 *     multiplied across every poll for every viewer it adds up.
 */
const redis = Redis.fromEnv();
const CACHE_TTL_S = 45;
const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
};
function cacheKey(playerId: string, tournamentId: string): string {
  return `route:player:this-week:v1:${tournamentId}:${playerId}`;
}

/**
 * GET /api/player/this-week?playerId=X
 *
 * Returns live strokes-gained breakdown + advanced field-rank stats
 * for the player at the active tournament. Powers the "Strokes gained
 * · this week" and "Advanced" blocks on /live/player/[id]'s This week
 * tab.
 *
 * Data: DataGolf's live-tournament-stats endpoint (paid tier), cached
 * field-wide in Redis at 5 min TTL via lib/feed/live-stats-cache.ts.
 * We hit it once for `event_avg` (the SG decomp + advanced stats
 * displayed in the hero blocks) and once per round 1-4 for the
 * per-round chips. Field ranks are computed against the cached
 * field-wide payload.
 *
 * Player resolution: orchestrator playerId → displayName via the
 * active leaderboard → DG row via normalised name match (same
 * pattern lib/feed/skill-cache.ts uses).
 */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function tier(rank: number, outOf: number): "elite" | "good" | "mid" | "poor" {
  if (outOf === 0) return "mid";
  const pct = rank / outOf;
  if (pct <= 0.1) return "elite";
  if (pct <= 0.33) return "good";
  if (pct <= 0.66) return "mid";
  return "poor";
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function fmtRank(r: { rank: number; outOf: number } | null): string {
  if (!r) return "—";
  return `${r.rank}${ordinalSuffix(r.rank)}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const playerId = url.searchParams.get("playerId");
    if (!playerId || !ID_RE.test(playerId)) {
      return NextResponse.json({ error: "bad-playerId" }, { status: 400 });
    }

    const active = await getActiveTournament().catch(() => null);
    if (!active) {
      return NextResponse.json({ found: false, reason: "no-tournament" });
    }
    const tournamentId = active.tournament.id;

    // Route-layer cache check before any work.
    const key = cacheKey(playerId, tournamentId);
    const cached = await redis.get<Record<string, unknown>>(key).catch(() => null);
    if (cached) {
      return NextResponse.json(cached, { headers: CDN_HEADERS });
    }

    const bundle = await getFeedBundle(tournamentId);
    const row = bundle.leaderboard.find((r) => r.playerId === playerId);
    if (!row) {
      return NextResponse.json({ found: false, reason: "not-on-leaderboard" });
    }

    // Field-wide payload for the event-average view. Cached 5 min.
    const eventStats = await getLiveStatsCached(tournamentId, "event_avg");
    const me = findStatsByName(eventStats, row.displayName);
    if (!me) {
      return NextResponse.json({
        found: false,
        reason: "not-in-dg-live-stats",
      });
    }

    const outOf = eventStats.length;

    // SG decomposition + field rank per category. lowerIsBetter is
    // false everywhere — DG returns SG as "strokes gained vs field",
    // so positive = better, and higher rank pos = #1.
    const sgCategories = [
      { key: "sgTotal", label: "Total" },
      { key: "sgOtt", label: "Off the tee" },
      { key: "sgApp", label: "Approach" },
      { key: "sgArg", label: "Around green" },
      { key: "sgPutt", label: "Putting" },
    ] as const;
    const sg = sgCategories
      .map((c) => {
        const v = me[c.key];
        if (v == null) return null;
        const r = fieldRank(eventStats, (s) => s[c.key], v);
        return r
          ? {
              key: c.key,
              label: c.label,
              value: v,
              rank: r.rank,
              outOf: r.outOf,
              rankLabel: fmtRank(r),
              tier: tier(r.rank, r.outOf),
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    // Advanced — ball-striking + scoring metrics with field rank.
    // Proximity is lower-is-better (closer = better).
    const advanced = [
      {
        key: "drivingDist",
        label: "Driving dist",
        unit: " yd",
        digits: 1,
        lowerIsBetter: false,
      },
      {
        key: "drivingAcc",
        label: "Driving acc",
        unit: "%",
        digits: 0,
        scale: 100,
        lowerIsBetter: false,
      },
      {
        key: "gir",
        label: "GIR",
        unit: "%",
        digits: 0,
        scale: 100,
        lowerIsBetter: false,
      },
      {
        key: "scrambling",
        label: "Scrambling",
        unit: "%",
        digits: 0,
        scale: 100,
        lowerIsBetter: false,
      },
      {
        key: "proxFw",
        label: "Prox · fairway",
        unit: " ft",
        digits: 1,
        lowerIsBetter: true,
      },
      {
        key: "proxRgh",
        label: "Prox · rough",
        unit: " ft",
        digits: 1,
        lowerIsBetter: true,
      },
    ] as const;
    const adv = advanced
      .map((c) => {
        const raw = me[c.key as keyof typeof me] as number | null;
        if (raw == null) return null;
        const scale = "scale" in c ? c.scale : 1;
        const displayed = raw * scale;
        const r = fieldRank(
          eventStats,
          (s) => s[c.key as keyof typeof s] as number | null,
          raw,
          c.lowerIsBetter,
        );
        return r
          ? {
              key: c.key,
              label: c.label,
              value: `${displayed.toFixed(c.digits)}${c.unit}`,
              rank: r.rank,
              outOf: r.outOf,
              rankLabel: fmtRank(r),
              tier: tier(r.rank, r.outOf),
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    // Per-round SG totals for the four R1-R4 chips.
    //
    // DataGolf's live-tournament-stats?round=N silently falls back to
    // the most-recently-played round when asked for a round that
    // hasn't started yet — symptom: R2/R3/R4 all return identical
    // sgTotal mid-tournament. We dedup any later round whose sgTotal
    // exactly matches the previous round's (DG would never
    // legitimately produce identical per-round SG to 3 decimals).
    const perRoundRaw = await Promise.all(
      [1, 2, 3, 4].map(async (rd) => {
        const rstats = await getLiveStatsCached(tournamentId, rd);
        const my = findStatsByName(rstats, row.displayName);
        return {
          label: `R${rd}`,
          value: my?.sgTotal ?? null,
        };
      }),
    );
    const perRound: { label: string; value: number | null }[] = [];
    let lastReal: number | null = null;
    for (const r of perRoundRaw) {
      const isDuplicate =
        lastReal != null &&
        r.value != null &&
        Math.abs(lastReal - r.value) < 1e-9;
      if (isDuplicate) {
        perRound.push({ label: r.label, value: null });
      } else {
        perRound.push(r);
        if (r.value != null) lastReal = r.value;
      }
    }

    // Header summary string for the live SG hero — "across 18 holes ·
    // 2nd of 71" matches the design-handoff prototype's caption format.
    // thru is reported by DG as the number of holes played in the
    // current round; for an event-avg view we report rounds played.
    const sgTotalRank = sg.find((s) => s.key === "sgTotal");
    const sgHeroMeta = sgTotalRank
      ? `event total · ${sgTotalRank.rankLabel} of ${sgTotalRank.outOf}`
      : "";

    const payload = {
      found: true,
      playerId,
      displayName: row.displayName,
      sgEvent: {
        total: me.sgTotal,
        meta: sgHeroMeta,
      },
      sg,
      perRound,
      advanced: adv,
    };
    await redis.set(key, payload, { ex: CACHE_TTL_S }).catch(() => undefined);
    return NextResponse.json(payload, { headers: CDN_HEADERS });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server-error" },
      { status: 500 },
    );
  }
}
