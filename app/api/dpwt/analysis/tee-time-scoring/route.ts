/**
 * GET /api/dpwt/analysis/tee-time-scoring?slug=open-de-espana&year=2025|live
 *
 * DP World Tour version of /api/analysis/tee-time-scoring: one row per
 * player-round, score to par plus skill (= performance vs expectation)
 * against tee time. Same response shape, so the same chart renders it.
 *
 * Live rounds still in progress are projected: current score plus the
 * live field average on each hole the player has left (falling back
 * to the venue's historical average before anyone has finished it).
 */
import { NextResponse } from "next/server";
import { getDailyWeather, type DailyWeather } from "@/lib/weather/open-meteo";
import { listTournamentConfigs } from "@/lib/scoring-model/tournament-config";
import { getDpwtActive, loadDpwtHistorical, loadDpwtMeta } from "@/lib/dpwt/data";
import { getDpwtField, getLiveRound, historicalHoleAvgVsPar, remainingHolesFor } from "@/lib/dpwt/live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RoundNum = 1 | 2 | 3 | 4;
interface OutRow {
  dgId: string;
  name: string;
  round: RoundNum;
  teeTime: string;
  teeMinutes: number;
  sgTotal: number;
  toPar: number;
  adjusted: number;
  thru: string | number;
  startHole: number;
  noSkill: boolean;
  projected: boolean;
  thruHoles: number;
  currentToPar: number;
}

function teeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = t.trim();
  const h12 = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (h12) {
    let h = Number(h12[1]) % 12;
    if (h12[3].toLowerCase() === "pm") h += 12;
    return h * 60 + Number(h12[2]);
  }
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const clock = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slugParam = url.searchParams.get("slug") ?? "";
    const yearParam = url.searchParams.get("year");
    const configs = await listTournamentConfigs("dpwt");
    const cfg = configs.find((c) => c.slug === slugParam) ?? configs[0];
    if (!cfg) return NextResponse.json({ ok: false, error: "no DP World Tour venues" }, { status: 404 });
    const slug = cfg.slug;
    const yearNum = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

    if (yearNum) {
      const hist = await loadDpwtHistorical(slug, yearNum);
      if (!hist) return NextResponse.json({ ok: false, error: `no historical data for ${slug} ${yearNum}` }, { status: 404 });
      const rows: OutRow[] = [];
      for (const p of hist.players) {
        const hasSkill = typeof p.skillBaseline === "number";
        const skill = hasSkill ? (p.skillBaseline as number) : 0;
        for (const [rStr, r] of Object.entries(p.rounds)) {
          const mins = teeToMinutes(r.teetime);
          if (mins == null) continue;
          const toPar = r.score - r.coursePar;
          rows.push({
            dgId: p.dgId ?? `dpwt-${p.dpwtId}`, name: p.name, round: Number(rStr) as RoundNum,
            teeTime: clock(mins), teeMinutes: mins, sgTotal: skill, toPar, adjusted: toPar + skill,
            thru: 18, startHole: r.startHole ?? 1, noSkill: !hasSkill, projected: false, thruHoles: 18, currentToPar: toPar,
          });
        }
      }
      rows.sort((a, b) => a.teeMinutes - b.teeMinutes);
      const per = (r: number) => rows.filter((x) => x.round === r).length;
      return NextResponse.json({
        ok: true, source: "historical", slug, year: yearNum, eventName: hist.dgEventName,
        count: rows.length, countByRound: { r1: per(1), r2: per(2), r3: per(3), r4: per(4) },
        weatherByRound: hist.weatherByRound ?? null, generatedAt: null, rows,
      });
    }

    // Live week.
    const active = await getDpwtActive();
    const meta = await loadDpwtMeta(slug);
    if (!active || active.slug !== slug || !meta) {
      return NextResponse.json({ ok: true, count: 0, countByRound: { r1: 0, r2: 0, r3: 0, r4: 0 }, weatherByRound: null, generatedAt: Date.now(), rows: [], diag: { reason: "not-live" } });
    }
    const [field, histAvg] = await Promise.all([getDpwtField(), historicalHoleAvgVsPar(slug, cfg.historicalYears)]);
    const rows: OutRow[] = [];
    for (const r of [1, 2, 3, 4] as RoundNum[]) {
      if (!active.imgEventId) break;
      const st = await getLiveRound(active.imgEventId, r, meta);
      if (!st.tee.size && !st.holes.size) continue;
      for (const [pid, tee] of st.tee) {
        const fp = field.get(pid);
        if (!fp) continue;
        const mins = teeToMinutes(tee.teetime);
        if (mins == null) continue;
        const hs = st.holes.get(pid) ?? {};
        const done = new Set(Object.keys(hs).map(Number));
        if (!done.size) continue;
        const current = [...done].reduce((a, h) => a + hs[h] - (meta.courseHolePars[String(h)] ?? 4), 0);
        const left = remainingHolesFor(tee.startHole, done);
        const proj = current + left.reduce((a, h) => a + (st.holeAvgVsPar[h]?.n >= 10 ? st.holeAvgVsPar[h].avg : histAvg[h] ?? 0), 0);
        const skill = fp.skill ?? 0;
        rows.push({
          dgId: String(fp.dgId), name: fp.name, round: r, teeTime: clock(mins), teeMinutes: mins,
          sgTotal: skill, toPar: left.length ? +proj.toFixed(2) : current, adjusted: (left.length ? proj : current) + skill,
          thru: left.length ? done.size : 18, startHole: tee.startHole, noSkill: fp.skill == null,
          projected: left.length > 0, thruHoles: done.size, currentToPar: current,
        });
      }
    }
    rows.sort((a, b) => a.teeMinutes - b.teeMinutes);
    const dates = [1, 2, 3, 4].map((r) => active.roundDates[String(r)]);
    let weatherByRound: Record<string, DailyWeather | null> | null = null;
    try {
      const daily = await getDailyWeather(meta.venue.lat, meta.venue.lon, dates, meta.venue.tz);
      const byDate = new Map(daily.map((d) => [d.date, d]));
      weatherByRound = Object.fromEntries(dates.map((d, i) => [String(i + 1), byDate.get(d) ?? null]));
    } catch {
      /* weather is decoration */
    }
    const per = (r: number) => rows.filter((x) => x.round === r).length;
    return NextResponse.json({
      ok: true, count: rows.length, countByRound: { r1: per(1), r2: per(2), r3: per(3), r4: per(4) },
      weatherByRound, generatedAt: Date.now(), rows, diag: { fieldSize: field.size },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
