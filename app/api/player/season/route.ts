import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getFeedBundle } from "@/lib/feed/store";
import { getSkillDecompositions } from "@/lib/golf-api/datagolf";
import {
  getSeasonRoundsByName,
  type SeasonEvent,
  type SeasonRound,
} from "@/lib/feed/season-rounds";

export const dynamic = "force-dynamic";

/**
 * GET /api/player/season?playerId=X
 *
 * Returns everything the Season tab needs in one payload:
 *   - season:  DataGolf bayesian skill ratings (per-round SG decomp)
 *   - glance:  events / wins / top10s / cuts / scoring avg / SG-per-round
 *              aggregated from this season's per-event roll-ups
 *   - form:    last 6 starts (newest first) with finish, scores, SG total
 *
 * The route id from the URL is the orchestrator's numeric playerId.
 * DataGolf keys by dg_id, so we reconcile via name: pull the player's
 * displayName from the active leaderboard, then match against DG by
 * normalised name (same approach lib/feed/skill-cache.ts uses).
 *
 * Season per-event data is sourced from lib/data/season-rounds.json,
 * rebuilt weekly by scripts/build-season-rounds.mjs.
 */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Parse a DataGolf fin_text string into a numeric position when it
 *  contains one. "1" → 1, "T4" → 4, "T12" → 12, "CUT"/"MC"/"WD" → null. */
function parseFinish(finText: string | null): number | null {
  if (!finText) return null;
  const m = finText.match(/^T?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function madeCut(ev: SeasonEvent): boolean {
  if (!ev.finText) return ev.roundsPlayed >= 3;
  const t = ev.finText.toUpperCase().trim();
  if (t === "CUT" || t === "MC" || t === "WD" || t === "DQ") return false;
  return true;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildGlance(rounds: SeasonRound[], events: SeasonEvent[]) {
  const eventsPlayed = events.length;
  const wins = events.filter((e) => e.finText === "1").length;
  const top10s = events.filter((e) => {
    const p = parseFinish(e.finText);
    return p != null && p <= 10;
  }).length;
  const cutsMade = events.filter(madeCut).length;
  // Scoring avg across all rounds played this season (vs par per round).
  const vsPars = rounds.map((r) => r.vsPar);
  const scoringAvgVsPar = avg(vsPars);
  // SG per round — average of round-level sgTotal where present.
  const sgPerRound = avg(
    rounds.filter((r) => r.sgTotal != null).map((r) => r.sgTotal as number),
  );
  return {
    eventsPlayed,
    wins,
    top10s,
    cutsMade,
    cutsMissed: eventsPlayed - cutsMade,
    scoringAvgVsPar,
    sgPerRound,
  };
}

function keyStatNote(ev: SeasonEvent): string {
  // Pick the biggest-magnitude SG category for a short editorial chip.
  const parts: { label: string; v: number }[] = [];
  if (ev.sgOtt != null) parts.push({ label: "Off the tee", v: ev.sgOtt });
  if (ev.sgApp != null) parts.push({ label: "Approach", v: ev.sgApp });
  if (ev.sgArg != null) parts.push({ label: "Around green", v: ev.sgArg });
  if (ev.sgPutt != null) parts.push({ label: "Putting", v: ev.sgPutt });
  if (parts.length === 0) return "";
  parts.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const top = parts[0];
  const sign = top.v >= 0 ? "+" : "−";
  return `${top.label} ${sign}${Math.abs(top.v).toFixed(1)}`;
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

    const bundle = await getFeedBundle(active.tournament.id);
    const row = bundle.leaderboard.find((r) => r.playerId === playerId);
    if (!row) {
      return NextResponse.json({ found: false, reason: "not-on-leaderboard" });
    }

    // Per-round DG skill ratings (refreshed weekly upstream).
    const dg = await getSkillDecompositions().catch(
      () => [] as Awaited<ReturnType<typeof getSkillDecompositions>>,
    );
    const target = normalizeName(row.displayName);
    const hit = dg.find((r) => normalizeName(r.name) === target);

    // Per-event rolled-up history from the season-rounds cache.
    const season = getSeasonRoundsByName(row.displayName);
    const events = season?.events ?? [];
    const rounds = season?.rounds ?? [];
    const glance =
      events.length > 0 ? buildGlance(rounds, events) : null;
    const form = events.slice(0, 6).map((e) => ({
      eventId: e.eventId,
      season: e.season,
      tournament: e.tournament,
      date: e.date,
      finText: e.finText,
      pos: parseFinish(e.finText),
      roundsPlayed: e.roundsPlayed,
      totalScore: e.totalScore,
      totalToPar: e.totalToPar,
      sgTotal: e.sgTotal,
      sgPerRound:
        e.sgTotal != null && e.roundsPlayed > 0
          ? e.sgTotal / e.roundsPlayed
          : null,
      keyStat: keyStatNote(e),
    }));

    return NextResponse.json({
      found: true,
      playerId,
      displayName: row.displayName,
      season: hit
        ? {
            sgTotal: hit.sgTotal,
            sgOtt: hit.sgOtt,
            sgApp: hit.sgApp,
            sgArg: hit.sgArg,
            sgPutt: hit.sgPutt,
          }
        : null,
      glance,
      form,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server-error" },
      { status: 500 },
    );
  }
}
