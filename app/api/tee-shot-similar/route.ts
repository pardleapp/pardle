/**
 * /api/tee-shot-similar?playerId=48081&limit=8
 *
 * For a target player, computes cosine similarity + normalised
 * distance to every other player we have driving data on and returns
 * the top-K matches. The comparison space is the full profile mean
 * vector; distance is normalised by each dimension's population std
 * so ball-speed rpm and launch-angle degrees weigh equally.
 *
 * Reads from the same Redis store as /api/tee-shot-profile.
 */

import { NextResponse } from "next/server";
import {
  getTeeShots,
  getPlayerName,
  listRankedPlayers,
} from "@/lib/feed/tee-shots-store";
import {
  buildProfile,
  populationStds,
  similarityScore,
  distanceScore,
  PROFILE_DIMENSIONS,
  type PlayerDrivingProfile,
} from "@/lib/feed/tee-shots-profile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MIN_SHOTS_FOR_COMPARISON = 60; // ~1 event worth — smaller and the mean is too noisy

export async function GET(req: Request) {
  const url = new URL(req.url);
  const playerId = url.searchParams.get("playerId");
  const limit = Number(url.searchParams.get("limit") ?? 8);
  if (!playerId) {
    return NextResponse.json(
      { ok: false, error: "playerId required" },
      { status: 400 },
    );
  }

  const targetRecords = await getTeeShots(playerId);
  if (!targetRecords || targetRecords.length === 0) {
    return NextResponse.json(
      { ok: false, error: "target has no records" },
      { status: 404 },
    );
  }
  const targetName = (await getPlayerName(playerId)) ?? playerId;
  const target = buildProfile(playerId, targetName, targetRecords, 0);

  // Full population — every ranked player. 300 is a soft cap that
  // covers every meaningful PGA regular; the sorted-set score guards
  // against outlier records that don't have enough shots.
  const ranked = await listRankedPlayers(300);
  const eligible = ranked.filter(
    (r) => r.shotCount >= MIN_SHOTS_FOR_COMPARISON,
  );

  const profiles: PlayerDrivingProfile[] = [target];
  for (const p of eligible) {
    if (p.playerId === playerId) continue;
    const recs = await getTeeShots(p.playerId);
    if (!recs || recs.length < MIN_SHOTS_FOR_COMPARISON) continue;
    const name = (await getPlayerName(p.playerId)) ?? p.playerId;
    profiles.push(buildProfile(p.playerId, name, recs, 0));
  }

  const stds = populationStds(profiles);
  const scored = profiles
    .filter((p) => p.playerId !== playerId)
    .map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      shotCount: p.shotCount,
      cosine: similarityScore(target, p, stds),
      distance: distanceScore(target, p, stds),
      // Per-dimension diff (in std units) — the UI uses this to say
      // "same shape, 4 mph slower ball speed" etc.
      dimensionGap: Object.fromEntries(
        PROFILE_DIMENSIONS.map((dim) => [
          dim,
          {
            self: target.stats[dim].mean,
            other: p.stats[dim].mean,
            gapStd:
              (p.stats[dim].mean - target.stats[dim].mean) /
              (stds[dim] || 1),
          },
        ]),
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(1, Math.min(50, limit)));

  return NextResponse.json({
    ok: true,
    target: {
      playerId: target.playerId,
      playerName: target.playerName,
      shotCount: target.shotCount,
    },
    matches: scored,
    populationStd: stds,
  });
}
