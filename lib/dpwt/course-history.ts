/**
 * Course history for DP World Tour venues: how a player's SG: OTT and
 * SG: APP at a course compares with their usual level, in the same
 * response shape as lib/course-history (PGA) so the same tool renders
 * it.
 *
 * Data: per-round strokes gained from the Tour's shot tracker (IMG
 * Arena) for every event it covered (data/dpwt/sg-history.json, built
 * by scripts/fetch-dpwt-sg-history.mjs); DataGolf only publishes
 * SG: Total for these events.
 *
 * Method mirrors the PGA version: field-strength adjustment by
 * leave-one-out field means, a symmetric 50-round baseline from the
 * nearest events either side (the venue's own events excluded),
 * shrinkage toward zero with K = 20, a skill-drift filter, and the
 * per-venue persistence/reliability layer.
 */
import "server-only";
import history from "@/data/dpwt/sg-history.json";
import skillPriors from "@/data/dpwt/skill-priors.json";
import { computePersistence, type PlayerResiduals } from "@/lib/course-history/persistence";
import type {
  CourseHistoryResponse,
  CuratedCourse,
  PlayerCourseStats,
} from "@/lib/course-history";

interface HistEvent { id: number; name: string; date: string; course: string | null; img: number }
interface History {
  events: HistEvent[];
  players: Record<string, { name: string; dgId: number | null }>;
  rounds: Array<[string, number, number, number, number]>;
}
const H = history as unknown as History;

interface SkillPriors {
  map: { ott: { a: number; b: number }; app: { a: number; b: number } };
  carryForward: { value: number; se: number; n: number };
  priors: Record<string, Record<string, [number, number] | null>>;
}
const SP = skillPriors as unknown as SkillPriors;
/** Backtested share of a player's past course edge that shows up on his
 *  next visit (scripts/backtest-course-fit.mjs). Replaces the per-venue
 *  persistence estimate, which on two seasons kept 2-4x too much. */
const CARRY = SP.carryForward.value;

const BASELINE_ROUNDS = 50;
const BASELINE_SHRINKAGE_K = 20;
const SKILL_DRIFT_THRESHOLD = 1.0;

// DataGolf's euro course names come lower-case; match case-insensitively
// and display title-cased.
const normCourse = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const displayCourse = (s: string) =>
  s.replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y|Of|The|At)\b/g, (w, _x, i) => (i === 0 ? w : w.toLowerCase()));
const yearOf = (d: string) => Number(d.slice(0, 4));
const dayNum = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return y * 365 + m * 30 + dd;
};

/** Stable numeric id for players DataGolf doesn't know. */
function idFor(key: string): number {
  const dg = H.players[key]?.dgId;
  if (typeof dg === "number") return dg;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return -Math.abs(h || 1);
}

// Per player: per event sums. Built once per process.
interface EvAgg { ott: number; app: number; n: number }
let byPlayerCache: Map<string, Map<number, EvAgg>> | null = null;
function byPlayer() {
  if (byPlayerCache) return byPlayerCache;
  const m = new Map<string, Map<number, EvAgg>>();
  for (const [key, ev, , ott, app] of H.rounds) {
    const pm = m.get(key) ?? new Map<number, EvAgg>();
    const a = pm.get(ev) ?? { ott: 0, app: 0, n: 0 };
    a.ott += ott;
    a.app += app;
    a.n += 1;
    pm.set(ev, a);
    m.set(key, pm);
  }
  byPlayerCache = m;
  return m;
}

/** Field strength per event: mean of participants' same-year
 *  leave-one-out averages, relative to the tour-wide mean. */
let fsCache: Map<number, { ott: number; app: number }> | null = null;
function fieldStrength() {
  if (fsCache) return fsCache;
  const players = byPlayer();
  const yearTotals = new Map<string, EvAgg>(); // `${key}:${year}`
  for (const [key, evs] of players) for (const [ev, a] of evs) {
    const k = `${key}:${yearOf(H.events[ev].date)}`;
    const t = yearTotals.get(k) ?? { ott: 0, app: 0, n: 0 };
    t.ott += a.ott; t.app += a.app; t.n += a.n;
    yearTotals.set(k, t);
  }
  const raw = new Map<number, { ott: number; app: number }>();
  const acc = new Map<number, { ott: number; app: number; n: number }>();
  for (const [key, evs] of players) for (const [ev, a] of evs) {
    const t = yearTotals.get(`${key}:${yearOf(H.events[ev].date)}`)!;
    const n = t.n - a.n;
    if (n <= 0) continue;
    const s = acc.get(ev) ?? { ott: 0, app: 0, n: 0 };
    s.ott += (t.ott - a.ott) / n;
    s.app += (t.app - a.app) / n;
    s.n += 1;
    acc.set(ev, s);
  }
  for (const [ev, s] of acc) raw.set(ev, { ott: s.ott / s.n, app: s.app / s.n });
  const vals = [...raw.values()];
  const avgOtt = vals.reduce((x, v) => x + v.ott, 0) / Math.max(1, vals.length);
  const avgApp = vals.reduce((x, v) => x + v.app, 0) / Math.max(1, vals.length);
  fsCache = new Map([...raw].map(([ev, v]) => [ev, { ott: v.ott - avgOtt, app: v.app - avgApp }]));
  return fsCache;
}

export function getDpwtCourses(): CuratedCourse[] {
  const by = new Map<string, { rounds: number; years: Set<number>; events: Set<string>; recent: number }>();
  const evRounds = new Map<number, number>();
  for (const r of H.rounds) evRounds.set(r[1], (evRounds.get(r[1]) ?? 0) + 1);
  H.events.forEach((e, i) => {
    const c = normCourse(e.course);
    if (!c) return;
    const b = by.get(c) ?? { rounds: 0, years: new Set(), events: new Set(), recent: 0 };
    b.rounds += evRounds.get(i) ?? 0;
    b.years.add(yearOf(e.date));
    b.events.add(e.name);
    b.recent = Math.max(b.recent, yearOf(e.date));
    by.set(c, b);
  });
  return [...by]
    .map(([courseName, b]) => ({
      courseName: displayCourse(courseName),
      totalRounds: b.rounds,
      yearsPresent: b.years.size,
      hostingEvents: [...b.events].sort(),
      mostRecentYear: b.recent,
    }))
    .sort((a, b) => a.courseName.localeCompare(b.courseName));
}

/** Current DG skill (OTT + APP) by dg id, for the drift filter. */
async function currentSkill(): Promise<Map<number, number>> {
  const key = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  const out = new Map<number, number>();
  if (!key) return out;
  try {
    const r = await fetch(`https://feeds.datagolf.com/preds/skill-ratings?display=value&file_format=json&key=${key}`, { next: { revalidate: 21600 } } as RequestInit);
    const j = (await r.json()) as { players?: Array<{ dg_id: number; sg_ott?: number; sg_app?: number }> };
    for (const p of j.players ?? []) {
      if (typeof p.sg_ott === "number" && typeof p.sg_app === "number") out.set(p.dg_id, p.sg_ott + p.sg_app);
    }
  } catch {
    /* drift filter just won't apply */
  }
  return out;
}

export async function getDpwtCourseHistory(course: string): Promise<CourseHistoryResponse | null> {
  const clean = normCourse(course);
  const atEvents = new Set<number>();
  H.events.forEach((e, i) => { if (normCourse(e.course) === clean) atEvents.add(i); });
  if (!atEvents.size) return null;
  const players = byPlayer();
  const fs = fieldStrength();
  const skill = await currentSkill();

  // Small samples are shrunk toward the player's own skill prior (his
  // DataGolf SG: Total over the previous year, mapped to OTT/APP), not
  // toward an average player: shrinking an elite low-volume player
  // toward zero made him look like he outperforms everywhere.
  function baselineFor(key: string, targetEv: number) {
    const targetDate = H.events[targetEv].date;
    const p = SP.priors[key]?.[String(targetEv)] ?? null;
    const prior = p ? { ott: p[0], app: p[1] } : { ott: SP.map.ott.a, app: SP.map.app.a };
    const evs = players.get(key);
    if (!evs) return prior;
    const entries = [...evs]
      .filter(([ev]) => !atEvents.has(ev) && H.events[ev].date !== targetDate)
      .map(([ev, a]) => ({ ev, a, d: Math.abs(dayNum(H.events[ev].date) - dayNum(targetDate)) }))
      .sort((x, y) => x.d - y.d);
    let ott = 0, app = 0, n = 0;
    for (const e of entries) {
      const f = fs.get(e.ev) ?? { ott: 0, app: 0 };
      ott += e.a.ott + f.ott * e.a.n;
      app += e.a.app + f.app * e.a.n;
      n += e.a.n;
      if (n >= BASELINE_ROUNDS) break;
    }
    const k = BASELINE_SHRINKAGE_K;
    return { ott: (ott + k * prior.ott) / (n + k), app: (app + k * prior.app) / (n + k) };
  }

  interface Bucket {
    key: string; atOtt: number; atApp: number; baseOtt: number; baseApp: number; rounds: number; baseRounds: number;
    years: Set<number>; residOtt: number[]; residApp: number[]; visits: Map<number, { ott: number[]; app: number[]; date: string }>;
  }
  const buckets = new Map<string, Bucket>();
  for (const [key, ev, , ott, app] of H.rounds) {
    if (!atEvents.has(ev)) continue;
    const e = H.events[ev];
    const f = fs.get(ev) ?? { ott: 0, app: 0 };
    const aOtt = ott + f.ott, aApp = app + f.app;
    const b: Bucket = buckets.get(key) ?? { key, atOtt: 0, atApp: 0, baseOtt: 0, baseApp: 0, rounds: 0, baseRounds: 0, years: new Set(), residOtt: [], residApp: [], visits: new Map() };
    b.atOtt += aOtt; b.atApp += aApp; b.rounds += 1; b.years.add(yearOf(e.date));
    const base = baselineFor(key, ev);
    if (base) {
      b.baseOtt += base.ott; b.baseApp += base.app; b.baseRounds += 1;
      b.residOtt.push(aOtt - base.ott); b.residApp.push(aApp - base.app);
      const v = b.visits.get(ev) ?? { ott: [] as number[], app: [] as number[], date: e.date };
      v.ott.push(aOtt - base.ott); v.app.push(aApp - base.app);
      b.visits.set(ev, v);
    }
    buckets.set(key, b);
  }

  // DG skill is on a PGA-average scale; IMG SG is relative to DP World
  // fields. Remove the typical gap before applying the drift threshold.
  const gaps: number[] = [];
  for (const b of buckets.values()) {
    const dg = H.players[b.key]?.dgId;
    const s = dg != null ? skill.get(dg) : undefined;
    if (s != null && b.baseRounds) gaps.push(s - (b.baseOtt + b.baseApp) / b.baseRounds);
  }
  gaps.sort((a, b) => a - b);
  const scaleGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const driftOf = (b: Bucket) => {
    const dg = H.players[b.key]?.dgId;
    const s = dg != null ? skill.get(dg) : undefined;
    if (s == null || !b.baseRounds) return null;
    return s - scaleGap - (b.baseOtt + b.baseApp) / b.baseRounds;
  };

  const surviving = [...buckets.values()].filter((b) => {
    const d = driftOf(b);
    return d == null || Math.abs(d) <= SKILL_DRIFT_THRESHOLD;
  });
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0);
  const residuals: PlayerResiduals[] = surviving.map((b) => {
    const visits = [...b.visits.values()].sort((x, y) => x.date.localeCompare(y.date));
    return { dgId: idFor(b.key), ott: b.residOtt, app: b.residApp, visitsOtt: visits.map((v) => avg(v.ott)), visitsApp: visits.map((v) => avg(v.app)) };
  });
  const persistence = computePersistence(residuals);

  const out: PlayerCourseStats[] = surviving.map((b) => {
    const atOtt = b.atOtt / b.rounds, atApp = b.atApp / b.rounds;
    const baseOtt = b.baseRounds ? b.baseOtt / b.baseRounds : 0;
    const baseApp = b.baseRounds ? b.baseApp / b.baseRounds : 0;
    const dg = H.players[b.key]?.dgId;
    const s = dg != null ? skill.get(dg) : undefined;
    const relOtt = CARRY;
    const relApp = CARRY;
    const rawOtt = atOtt - baseOtt, rawApp = atApp - baseApp;
    return {
      dgId: idFor(b.key),
      name: H.players[b.key]?.name ?? b.key,
      roundsPlayed: b.rounds,
      yearsPlayed: b.years.size,
      courseName: displayCourse(clean),
      atCourseSgOtt: atOtt,
      atCourseSgApp: atApp,
      atCourseCombined: atOtt + atApp,
      baselineSgOtt: baseOtt,
      baselineSgApp: baseApp,
      baselineCombined: baseOtt + baseApp,
      outperformanceSgOtt: rawOtt,
      outperformanceSgApp: rawApp,
      outperformanceCombined: rawOtt + rawApp,
      currentSkillOttApp: s != null ? s - scaleGap : null,
      skillDrift: driftOf(b),
      reliabilityOtt: relOtt,
      reliabilityApp: relApp,
      adjustedOutperformanceSgOtt: rawOtt * relOtt,
      adjustedOutperformanceSgApp: rawApp * relApp,
      adjustedOutperformanceCombined: rawOtt * relOtt + rawApp * relApp,
    };
  });
  out.sort((a, b) => b.adjustedOutperformanceCombined - a.adjustedOutperformanceCombined);
  const hosting = [...new Set([...atEvents].map((i) => H.events[i].name))].sort();
  return {
    eventId: -1,
    eventName: hosting.length > 1 ? `${hosting[0]} + ${hosting.length - 1} more` : hosting[0],
    courseName: displayCourse(clean),
    yearsCovered: [...new Set([...atEvents].map((i) => yearOf(H.events[i].date)))].sort(),
    players: out,
    cachedAt: new Date().toISOString(),
    hostingEvents: hosting,
    // The panel's "kept" figures show the share Expected actually keeps.
    persistence: persistence.usable
      ? {
          ...persistence,
          calibrated: { share: CARRY, visits: SP.carryForward.n },
          ott: { ...persistence.ott, typicalReliability: CARRY },
          app: { ...persistence.app, typicalReliability: CARRY },
        }
      : null,
  };
}
