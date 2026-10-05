/**
 * GET /api/dpwt/analysis/course-heatmap?slug=...&year=2025|live
 *
 * DP World Tour version of /api/analysis/course-heatmap: average
 * strokes vs par per (round, hole, hour of play), with each hole's
 * completion time estimated from the tee time and start tee. Same
 * response shape as the PGA route.
 */
import { NextResponse } from "next/server";
import { getDailyWeather, type DailyWeather } from "@/lib/weather/open-meteo";
import { listTournamentConfigs } from "@/lib/scoring-model/tournament-config";
import { getDpwtActive, loadDpwtHistorical, loadDpwtMeta } from "@/lib/dpwt/data";
import { getLiveRound } from "@/lib/dpwt/live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET_MIN = 60;
const HOLE_PACE_MIN = 15;

function teeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const h12 = t.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (h12) {
    let h = Number(h12[1]) % 12;
    if (h12[3].toLowerCase() === "pm") h += 12;
    return h * 60 + Number(h12[2]);
  }
  const m = t.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

interface PlayerRound {
  round: number;
  teeMins: number;
  startHole: number;
  holes: Record<number, { strokes: number; par: number }>;
}

function buildCells(rounds: PlayerRound[]) {
  const map = new Map<string, { round: number; hole: number; timeBucket: number; sum: number; count: number }>();
  for (const pr of rounds) {
    for (const [hStr, h] of Object.entries(pr.holes)) {
      const hole = Number(hStr);
      const pos = (hole - pr.startHole + 18) % 18;
      const bucket = Math.floor((pr.teeMins + (pos + 1) * HOLE_PACE_MIN) / BUCKET_MIN) * BUCKET_MIN;
      const key = `${pr.round}:${hole}:${bucket}`;
      const c = map.get(key) ?? { round: pr.round, hole, timeBucket: bucket, sum: 0, count: 0 };
      c.sum += h.strokes - h.par;
      c.count += 1;
      map.set(key, c);
    }
  }
  const cells = [...map.values()].map((c) => ({ round: c.round, hole: c.hole, timeBucket: c.timeBucket, avgVsPar: c.sum / c.count, count: c.count }));
  const roundRanges: Record<number, { minMins: number; maxMins: number; cellCount: number }> = {};
  for (const c of cells) {
    const r = (roundRanges[c.round] ??= { minMins: Infinity, maxMins: -Infinity, cellCount: 0 });
    r.minMins = Math.min(r.minMins, c.timeBucket);
    r.maxMins = Math.max(r.maxMins, c.timeBucket);
    r.cellCount += 1;
  }
  return { cells, roundRanges };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const configs = await listTournamentConfigs("dpwt");
    const cfg = configs.find((c) => c.slug === url.searchParams.get("slug")) ?? configs[0];
    if (!cfg) return NextResponse.json({ ok: false, error: "no DP World Tour venues" }, { status: 404 });
    const slug = cfg.slug;
    const yearParam = url.searchParams.get("year");
    const yearNum = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
    const holeBearings = cfg.holeBearings ?? null;

    if (yearNum) {
      const hist = await loadDpwtHistorical(slug, yearNum);
      if (!hist) return NextResponse.json({ ok: false, error: `no historical data for ${slug} ${yearNum}` }, { status: 404 });
      const rounds: PlayerRound[] = [];
      let noTee = 0;
      for (const p of hist.players) for (const [r, rd] of Object.entries(p.rounds)) {
        const mins = teeToMinutes(rd.teetime);
        if (mins == null) { noTee++; continue; }
        rounds.push({ round: Number(r), teeMins: mins, startHole: rd.startHole ?? 1, holes: Object.fromEntries(Object.entries(rd.holes).map(([h, x]) => [Number(h), { strokes: x.strokes, par: x.par }])) });
      }
      const { cells, roundRanges } = buildCells(rounds);
      return NextResponse.json({
        ok: true, source: "historical", slug, year: yearNum, eventName: hist.dgEventName,
        tournamentId: hist.tournamentId, generatedAt: null, bucketMinutes: BUCKET_MIN,
        cells, roundRanges, weatherByRound: hist.weatherByRound ?? null, holeBearings,
        diag: { tallied: cells.reduce((a, c) => a + c.count, 0), noTee },
      });
    }

    const active = await getDpwtActive();
    const meta = await loadDpwtMeta(slug);
    if (!active || active.slug !== slug || !meta) {
      return NextResponse.json({ ok: false, error: "no-active-tournament" }, { status: 404 });
    }
    const rounds: PlayerRound[] = [];
    for (const r of [1, 2, 3, 4]) {
      const st = await getLiveRound(active.dpwtEventId, r, meta);
      for (const [pid, hs] of st.holes) {
        const tee = st.tee.get(pid);
        const mins = teeToMinutes(tee?.teetime);
        if (mins == null) continue;
        rounds.push({
          round: r, teeMins: mins, startHole: tee?.startHole ?? 1,
          holes: Object.fromEntries(Object.entries(hs).map(([h, s]) => [Number(h), { strokes: s, par: meta.courseHolePars[h] ?? 4 }])),
        });
      }
    }
    const { cells, roundRanges } = buildCells(rounds);
    const dates = [1, 2, 3, 4].map((r) => active.roundDates[String(r)]);
    let weatherByRound: Record<string, DailyWeather | null> | null = null;
    try {
      const daily = await getDailyWeather(meta.venue.lat, meta.venue.lon, dates, meta.venue.tz);
      const byDate = new Map(daily.map((d) => [d.date, d]));
      weatherByRound = Object.fromEntries(dates.map((d, i) => [String(i + 1), byDate.get(d) ?? null]));
    } catch {
      /* decoration */
    }
    return NextResponse.json({
      ok: true, source: "live", tournamentId: active.tournamentId, eventName: cfg.eventName,
      bucketMinutes: BUCKET_MIN, cells, roundRanges, weatherByRound, holeBearings,
      generatedAt: Date.now(), diag: cells.length ? undefined : { reason: "no-scores-yet" },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
