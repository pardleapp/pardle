/**
 * DP World Tour data for the analysis tools.
 *
 * Historical editions come from data/dpwt/historical (built by
 * scripts/fetch-dpwt-historical.mjs, same shape as the PGA files). The
 * live week reads the Tour's own sportdata API (hole-by-hole scores,
 * tee times, leaderboard) and the IMG Arena event centre (daily yardage
 * and pins), both keyless and reachable server-side.
 *
 * Server-only.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "dpwt");
const HIST = path.join(DIR, "historical");
const DPWT = "https://www.europeantour.com/api/sportdata";
const IMG = "https://btec-http.services.srarena.io/";

// ── historical files ───────────────────────────────────────────────

export interface DpwtHole {
  strokes: number;
  par: number;
  yards: number;
}
export interface DpwtRound {
  teetime: string | null;
  startHole: number;
  score: number;
  sgTotal: number | null;
  sgOtt: number | null;
  sgApp: number | null;
  sgArg: number | null;
  sgPutt: number | null;
  coursePar: number;
  courseName: string;
  holes: Record<string, DpwtHole>;
}
export interface DpwtPlayer {
  dgId: string | null;
  dpwtId: number;
  imgId: number | null;
  name: string;
  finText: string;
  skillBaseline: number | null;
  rounds: Record<string, DpwtRound>;
}
export interface DpwtPin {
  x: number;
  y: number;
  utmX: number;
  utmY: number;
}
export interface DpwtHistorical {
  tour: "dpwt";
  year: number;
  tournamentId: string;
  dpwtEventId: number;
  imgEventId: number | null;
  dgEventName: string;
  venue: { name: string; lat: number; lon: number; tz: string };
  roundDates: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  weatherByRound: Record<string, any>;
  yardsByRound: Record<string, Record<string, number>>;
  pinsByRoundByHole: Record<string, Record<string, DpwtPin>>;
  players: DpwtPlayer[];
}
export interface DpwtGreenFrame {
  cx: number;
  cy: number;
  bearing: number;
  widthMetres: number;
  heightMetres: number;
  utmZone: number;
}
export interface DpwtMeta {
  slug: string;
  eventName: string;
  venue: { name: string; lat: number; lon: number; tz: string };
  coursePar: number;
  courseHolePars: Record<string, number>;
  cardYards: Record<string, number>;
  holeBearings: Record<string, number>;
  greens: Record<string, { frame: DpwtGreenFrame; outline: Array<[number, number]> }>;
}
export interface DpwtLiveEntry {
  tournamentId: string;
  dpwtEventId: number;
  imgEventId: number | null;
  year: number;
  roundDates: Record<string, string>;
}

const safeSlug = (s: string) => /^[a-z0-9-]+$/.test(s);
const fileCache = new Map<string, { at: number; v: unknown }>();
async function readJson<T>(p: string): Promise<T | null> {
  const hit = fileCache.get(p);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.v as T;
  try {
    const v = JSON.parse(await readFile(p, "utf-8")) as T;
    fileCache.set(p, { at: Date.now(), v });
    return v;
  } catch {
    return null;
  }
}

export function loadDpwtHistorical(slug: string, year: number) {
  if (!safeSlug(slug)) return Promise.resolve(null);
  return readJson<DpwtHistorical>(path.join(HIST, `${slug}-${year}.json`));
}
export function loadDpwtMeta(slug: string) {
  if (!safeSlug(slug)) return Promise.resolve(null);
  return readJson<DpwtMeta>(path.join(HIST, `${slug}-meta.json`));
}
export async function loadDpwtLiveEntries(): Promise<Record<string, DpwtLiveEntry>> {
  return (await readJson<Record<string, DpwtLiveEntry>>(path.join(HIST, "_live-tournaments.json"))) ?? {};
}

/** slug + year for a "D{eventId}" tournament id (historical or live). */
export async function resolveDpwtTournament(
  tournamentId: string,
  years: Record<string, number[]>,
): Promise<{ slug: string; year: number; live: boolean } | null> {
  const live = await loadDpwtLiveEntries();
  for (const [slug, e] of Object.entries(live)) {
    if (e.tournamentId === tournamentId) return { slug, year: e.year, live: true };
  }
  for (const [slug, ys] of Object.entries(years)) {
    for (const y of ys) {
      const h = await loadDpwtHistorical(slug, y);
      if (h?.tournamentId === tournamentId) return { slug, year: y, live: false };
    }
  }
  return null;
}

/** The event we treat as "this week": from the Monday before R1 until
 *  the day after R4. */
export async function getDpwtActive(now = new Date()): Promise<
  (DpwtLiveEntry & { slug: string; inProgress: boolean }) | null
> {
  const today = now.toISOString().slice(0, 10);
  const shift = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  for (const [slug, e] of Object.entries(await loadDpwtLiveEntries())) {
    const r1 = e.roundDates["1"];
    const r4 = e.roundDates["4"];
    if (today >= shift(r1, -4) && today <= shift(r4, 1)) {
      return { slug, ...e, inProgress: today >= r1 && today <= r4 };
    }
  }
  return null;
}

// ── live: DP World Tour sportdata ──────────────────────────────────

async function getLive<T>(url: string, init?: RequestInit, revalidate = 20): Promise<T | null> {
  try {
    const r = await fetch(url, { ...init, next: { revalidate } } as RequestInit);
    if (!r.ok) return null;
    const t = await r.text();
    if (!t) return null;
    const j = JSON.parse(t);
    return (j && typeof j === "object" && !("data" in j) && url.startsWith(IMG) ? { data: j } : j) as T;
  } catch {
    return null;
  }
}

export interface LiveHbhPlayer {
  PlayerId: number;
  MissedCut: boolean;
  Strokes: number;
  Holes: Array<{ HoleNo: number; Strokes: number | null }>;
}
export const dpwtHoleByHole = (eventId: number, round: number) =>
  getLive<{ Players?: LiveHbhPlayer[] }>(`${DPWT}/HoleByHole/Event/${eventId}/Round/${round}`);
export const dpwtTeetimes = (eventId: number, round: number) =>
  getLive<{ Timezone?: string; Courses?: Array<{ Matches?: Array<{ Tee?: number; TeeTime?: string; Players?: Array<{ PlayerId: number }> }> }> }>(
    `${DPWT}/Teetimes/Event/${eventId}/Round/${round}`, undefined, 300);
export const dpwtLeaderboard = (eventId: number) =>
  getLive<{ Players?: Array<{ PlayerId: number; FirstName: string; LastName: string; PositionDesc: string; MissedCut: boolean; ScoreToPar: number; HolesPlayed: number; Rounds?: Array<{ RoundNo: number; Strokes: number }> }> }>(
    `${DPWT}/Leaderboard/Strokeplay/${eventId}`);

/** Tee time + starting tee per player for a round. */
export async function dpwtTeeMap(eventId: number, round: number) {
  const tt = await dpwtTeetimes(eventId, round);
  const out = new Map<number, { teetime: string; startHole: number }>();
  for (const c of tt?.Courses ?? []) for (const m of c.Matches ?? []) for (const p of m.Players ?? []) {
    if (m.TeeTime) out.set(p.PlayerId, { teetime: m.TeeTime, startHole: m.Tee ?? 1 });
  }
  return out;
}

// ── live: IMG Arena course setup (daily yardage + pins) ────────────

let imgEvents: Record<string, { courseInfoHash?: string }> | null = null;
export async function imgLiveCourseRounds(imgEventId: number) {
  imgEvents ??= (await readJson<Record<string, { courseInfoHash?: string }>>(path.join(DIR, "img-events.json"))) ?? {};
  const hash = imgEvents[String(imgEventId)]?.courseInfoHash;
  if (!hash) return null;
  const j = await getLive<{ data?: { getGolfTournament?: { golfCourses?: Array<{ rounds?: Array<{ roundNo: number; holes: Array<{ holeNo: number; par: number; actualYardage: number; officialYardage: number; pinPlacement?: { x: number; z: number } | null }> }> }> } } }>(
    `${IMG}?hash=${hash}`,
    {
      headers: {
        operator: "europeantour", sport: "GOLF", "event-id": String(imgEventId),
        "gql-op-name": "GetGolfCourseInfo", "ec-version": "6.0.129", "x-request-from": "6.0.129",
        "normalise-response": "true", "query-hash": hash,
        origin: "https://europeantour.apps.srarena.io", referer: "https://europeantour.apps.srarena.io/",
      },
    },
    300,
  );
  return j?.data?.getGolfTournament?.golfCourses?.[0]?.rounds ?? null;
}

// ── green geometry (UTM pin -> 16:9 green frame, outline -> SVG) ────

export function pinToFrame(frame: DpwtGreenFrame, utmX: number, utmY: number) {
  const th = (frame.bearing * Math.PI) / 180;
  const dx = utmX - frame.cx;
  const dy = utmY - frame.cy;
  const fwd = dx * Math.sin(th) + dy * Math.cos(th);
  const right = dx * Math.cos(th) - dy * Math.sin(th);
  return { x: +(0.5 + right / frame.widthMetres).toFixed(4), y: +(0.5 - fwd / frame.heightMetres).toFixed(4) };
}

const svgCache = new Map<string, string>();
/** The green outline as a 16:9 SVG data URL, standing in for the
 *  overhead green photos the PGA pin tools draw on. */
export function greenSvgDataUrl(meta: DpwtMeta, hole: number): string {
  const key = `${meta.slug}:${hole}`;
  const hit = svgCache.get(key);
  if (hit) return hit;
  const g = meta.greens?.[String(hole)];
  if (!g?.outline?.length) return "";
  const W = 1600, H = 900;
  const pts = g.outline.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(" ");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#cfe3b4"/>` +
    `<polygon points="${pts}" fill="#7fbf5f" stroke="#4f8f3a" stroke-width="10" stroke-linejoin="round"/>` +
    `<path d="M${W / 2} ${H - 24} l-18 -30 h36 z" fill="#ffffff" opacity="0.7"/>` +
    `</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  svgCache.set(key, url);
  return url;
}

// ── names ──────────────────────────────────────────────────────────

const FOLD: Record<string, string> = { ø: "o", Ø: "o", æ: "ae", Æ: "ae", ß: "ss", ł: "l", Ł: "l", đ: "d", Đ: "d", ı: "i" };
export function normName(s: string): string {
  const t = s.includes(",") ? s.split(",").map((x) => x.trim()).reverse().join(" ") : s;
  return t
    .replace(/[øØæÆßłŁđĐı]/g, (c) => FOLD[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}
export const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());
