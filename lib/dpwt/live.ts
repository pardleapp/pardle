/**
 * Live-week helpers shared by the DP World Tour analysis routes: the
 * field with DataGolf ids and skill, per-round hole scores and tee
 * times, and live per-hole scoring averages.
 */
import "server-only";
import {
  dpwtHoleByHole,
  dpwtTeeMap,
  loadDpwtHistorical,
  type DpwtMeta,
} from "./data";

const DG = "https://feeds.datagolf.com";
function dgKey() {
  return process.env.DATAGOLF_API_KEY || process.env.DATAGOLF || "";
}
async function dg<T>(p: string, revalidate = 600): Promise<T | null> {
  if (!dgKey()) return null;
  try {
    const r = await fetch(`${DG}${p}${p.includes("?") ? "&" : "?"}file_format=json&key=${dgKey()}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface FieldPlayer {
  dpwtId: number;
  dgId: number;
  name: string;
  /** DataGolf's event-specific skill estimate (strokes gained per
   *  round vs an average tour field). */
  skill: number | null;
}

/** This week's field. DataGolf's euro feed carries the Tour's own
 *  player id as `player_num`, so no name matching is needed. */
export async function getDpwtField(): Promise<Map<number, FieldPlayer>> {
  const [fu, dec] = await Promise.all([
    dg<{ field?: Array<{ dg_id: number; player_name: string; player_num?: number }> }>("/field-updates?tour=euro", 300),
    dg<{ players?: Array<{ dg_id: number; final_pred?: number; baseline_pred?: number }> }>("/preds/player-decompositions?tour=euro", 1800),
  ]);
  const skill = new Map<number, number>();
  for (const p of dec?.players ?? []) {
    const v = p.final_pred ?? p.baseline_pred;
    if (typeof v === "number") skill.set(p.dg_id, v);
  }
  const out = new Map<number, FieldPlayer>();
  for (const f of fu?.field ?? []) {
    if (!f.player_num) continue;
    const [last, first] = f.player_name.split(",").map((s) => s.trim());
    out.set(f.player_num, {
      dpwtId: f.player_num,
      dgId: f.dg_id,
      name: first ? `${first} ${last}` : f.player_name,
      skill: skill.get(f.dg_id) ?? null,
    });
  }
  return out;
}

export interface LiveRoundState {
  round: number;
  /** dpwtId -> hole -> strokes (holes completed so far) */
  holes: Map<number, Record<number, number>>;
  tee: Map<number, { teetime: string; startHole: number }>;
  /** Live per-hole field average strokes minus par, from every score
   *  posted on that hole this round (partial rounds included). */
  holeAvgVsPar: Record<number, { avg: number; n: number }>;
}

export async function getLiveRound(eventId: number, round: number, meta: DpwtMeta): Promise<LiveRoundState> {
  const [hbh, tee] = await Promise.all([dpwtHoleByHole(eventId, round), dpwtTeeMap(eventId, round)]);
  const holes = new Map<number, Record<number, number>>();
  const acc: Record<number, { sum: number; n: number }> = {};
  for (const p of hbh?.Players ?? []) {
    const hs: Record<number, number> = {};
    for (const h of p.Holes ?? []) {
      if (typeof h.Strokes !== "number" || h.Strokes <= 0) continue;
      hs[h.HoleNo] = h.Strokes;
      const par = meta.courseHolePars[String(h.HoleNo)];
      if (par) {
        const a = (acc[h.HoleNo] ??= { sum: 0, n: 0 });
        a.sum += h.Strokes - par;
        a.n += 1;
      }
    }
    if (Object.keys(hs).length) holes.set(p.PlayerId, hs);
  }
  const holeAvgVsPar: LiveRoundState["holeAvgVsPar"] = {};
  for (const [h, a] of Object.entries(acc)) holeAvgVsPar[Number(h)] = { avg: a.sum / a.n, n: a.n };
  return { round, holes, tee, holeAvgVsPar };
}

/** Per-hole average strokes-vs-par across every past edition, used for
 *  holes nobody has finished yet this round. */
export async function historicalHoleAvgVsPar(slug: string, years: number[]) {
  const acc: Record<number, { sum: number; n: number }> = {};
  for (const y of years) {
    const h = await loadDpwtHistorical(slug, y);
    for (const p of h?.players ?? []) for (const rd of Object.values(p.rounds)) for (const [hole, x] of Object.entries(rd.holes)) {
      const a = (acc[Number(hole)] ??= { sum: 0, n: 0 });
      a.sum += x.strokes - x.par;
      a.n += 1;
    }
  }
  const out: Record<number, number> = {};
  for (const [h, a] of Object.entries(acc)) out[Number(h)] = a.sum / a.n;
  return out;
}

/** Holes a player still has to play, in order, given their start tee. */
export function remainingHolesFor(startHole: number, done: Set<number>): number[] {
  const order: number[] = [];
  for (let i = 0; i < 18; i++) order.push(((startHole - 1 + i) % 18) + 1);
  return order.filter((h) => !done.has(h));
}
