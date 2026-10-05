/**
 * Pin sheets and pin-birdie history for DP World Tour venues, in the
 * same shapes as the PGA pin tools (CoursePinSheet / HoleBirdieData).
 *
 * Pins come from IMG Arena as UTM coordinates and are mapped into a
 * per-hole 16:9 frame (green centred, tee->green pointing up). The
 * "green image" is an SVG of the OpenStreetMap green outline in the
 * same frame, so pins land on it exactly.
 */
import "server-only";
import type { CoursePinHole, CoursePinSheet } from "@/lib/golf-api/pgatour";
import {
  buildAllHoles,
  tallyPlayerHole,
  type EventInput,
  type PerHoleRoundCounts,
} from "@/lib/analysis/course-birdies";
import { listTournamentConfigs } from "@/lib/scoring-model/tournament-config";
import {
  dpwtHoleByHole,
  getDpwtActive,
  greenSvgDataUrl,
  imgLiveCourseRounds,
  loadDpwtHistorical,
  loadDpwtLiveEntries,
  loadDpwtMeta,
  pinToFrame,
  type DpwtMeta,
} from "./data";

interface EditionData {
  year: number;
  tournamentId: string;
  sheet: CoursePinSheet;
  counts: PerHoleRoundCounts;
}

function emptyHoles(meta: DpwtMeta): Map<number, CoursePinHole> {
  const holes = new Map<number, CoursePinHole>();
  for (let h = 1; h <= 18; h++) {
    holes.set(h, {
      holeNumber: h,
      par: meta.courseHolePars[String(h)] ?? null,
      yards: meta.cardYards?.[String(h)] ?? null,
      greenImageUrl: greenSvgDataUrl(meta, h),
      pinByRound: {},
      yardsByRound: {},
      scoringByRound: {},
    });
  }
  return holes;
}

function finishScoring(holes: Map<number, CoursePinHole>, acc: Map<string, { sum: number; n: number }>) {
  for (const [key, a] of acc) {
    const [h, r] = key.split(":").map(Number);
    const hole = holes.get(h);
    if (!hole || !a.n) continue;
    const avg = a.sum / a.n;
    hole.scoringByRound[r] = { avg: +avg.toFixed(3), vsPar: hole.par != null ? +(avg - hole.par).toFixed(3) : null };
  }
}

async function historicalEdition(slug: string, year: number, meta: DpwtMeta): Promise<EditionData | null> {
  const hist = await loadDpwtHistorical(slug, year);
  if (!hist) return null;
  const holes = emptyHoles(meta);
  // IMG numbers playoffs as round 401+; only regulation rounds count.
  const regulation = (r: string) => Number(r) >= 1 && Number(r) <= 4;
  for (const [r, byHole] of Object.entries(hist.pinsByRoundByHole ?? {})) {
    if (!regulation(r)) continue;
    for (const [h, pin] of Object.entries(byHole)) {
      const hole = holes.get(Number(h));
      const frame = meta.greens?.[h]?.frame;
      if (!hole || !pin) continue;
      // Re-project from UTM with the current frame so pins always match
      // the outline being drawn, even if the frame was rebuilt.
      const xy = frame ? pinToFrame(frame, pin.utmX, pin.utmY) : { x: pin.x, y: pin.y };
      hole.pinByRound[Number(r)] = { ...xy, frameEnh: true };
    }
  }
  for (const [r, byHole] of Object.entries(hist.yardsByRound ?? {})) {
    if (!regulation(r)) continue;
    for (const [h, y] of Object.entries(byHole)) {
      const hole = holes.get(Number(h));
      if (hole) hole.yardsByRound[Number(r)] = y;
    }
  }
  const counts: PerHoleRoundCounts = new Map();
  const acc = new Map<string, { sum: number; n: number }>();
  for (const p of hist.players) {
    for (const [r, rd] of Object.entries(p.rounds)) {
      for (const [h, x] of Object.entries(rd.holes)) {
        tallyPlayerHole(counts, Number(h), Number(r), x.strokes, x.par);
        const k = `${h}:${r}`;
        const a = acc.get(k) ?? { sum: 0, n: 0 };
        a.sum += x.strokes;
        a.n += 1;
        acc.set(k, a);
      }
    }
  }
  finishScoring(holes, acc);
  return {
    year,
    tournamentId: hist.tournamentId,
    sheet: { tournamentId: hist.tournamentId, courseName: meta.venue.name, holes: [...holes.values()] },
    counts,
  };
}

async function liveEdition(slug: string, meta: DpwtMeta): Promise<EditionData | null> {
  const live = (await loadDpwtLiveEntries())[slug];
  if (!live) return null;
  const holes = emptyHoles(meta);
  const rounds = live.imgEventId ? await imgLiveCourseRounds(live.imgEventId) : null;
  for (const rd of rounds ?? []) {
    if (rd.roundNo < 1 || rd.roundNo > 4) continue;
    for (const h of rd.holes) {
      const hole = holes.get(h.holeNo);
      if (!hole) continue;
      // Unpublished setups come back as the card yardage with a
      // placeholder pin (z = 0): skip both until they're real.
      const p = h.pinPlacement;
      const frame = meta.greens?.[String(h.holeNo)]?.frame;
      if (p && p.z > 1e6 && frame) {
        hole.pinByRound[rd.roundNo] = { ...pinToFrame(frame, p.x, p.z), frameEnh: true };
        if (h.actualYardage) hole.yardsByRound[rd.roundNo] = h.actualYardage;
      }
    }
  }
  const counts: PerHoleRoundCounts = new Map();
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of [1, 2, 3, 4]) {
    const hbh = await dpwtHoleByHole(live.dpwtEventId, r);
    for (const p of hbh?.Players ?? []) {
      for (const h of p.Holes ?? []) {
        if (typeof h.Strokes !== "number" || h.Strokes <= 0) continue;
        const par = meta.courseHolePars[String(h.HoleNo)];
        tallyPlayerHole(counts, h.HoleNo, r, h.Strokes, par);
        const k = `${h.HoleNo}:${r}`;
        const a = acc.get(k) ?? { sum: 0, n: 0 };
        a.sum += h.Strokes;
        a.n += 1;
        acc.set(k, a);
      }
    }
  }
  finishScoring(holes, acc);
  return {
    year: live.year,
    tournamentId: live.tournamentId,
    sheet: { tournamentId: live.tournamentId, courseName: meta.venue.name, holes: [...holes.values()] },
    counts,
  };
}

async function slugForTournament(tournamentId: string): Promise<{ slug: string; year: number; live: boolean } | null> {
  const live = await loadDpwtLiveEntries();
  for (const [slug, e] of Object.entries(live)) if (e.tournamentId === tournamentId) return { slug, year: e.year, live: true };
  for (const c of await listTournamentConfigs("dpwt")) {
    for (const [y, id] of Object.entries(c.historicalTournamentIds)) if (id === tournamentId) return { slug: c.slug, year: Number(y), live: false };
  }
  return null;
}

export async function getDpwtPinSheet(tournamentId: string): Promise<CoursePinSheet | null> {
  const t = await slugForTournament(tournamentId);
  if (!t) return null;
  const meta = await loadDpwtMeta(t.slug);
  if (!meta) return null;
  const ed = t.live ? await liveEdition(t.slug, meta) : await historicalEdition(t.slug, t.year, meta);
  return ed?.sheet ?? null;
}

/** Pin-by-pin scoring history across every edition at the venue (plus
 *  the live week once its pins are published). */
export async function getDpwtPinBirdies(tournamentId: string) {
  const t = await slugForTournament(tournamentId);
  if (!t) return null;
  const meta = await loadDpwtMeta(t.slug);
  const cfg = (await listTournamentConfigs("dpwt")).find((c) => c.slug === t.slug);
  if (!meta || !cfg) return null;
  const events: EventInput[] = [];
  for (const y of cfg.historicalYears) {
    const ed = await historicalEdition(t.slug, y, meta);
    if (ed) events.push({ year: ed.year, tournamentId: ed.tournamentId, pins: ed.sheet.holes, counts: ed.counts });
  }
  const active = await getDpwtActive();
  if (active?.slug === t.slug) {
    const ed = await liveEdition(t.slug, meta);
    if (ed) events.push({ year: ed.year, tournamentId: ed.tournamentId, pins: ed.sheet.holes, counts: ed.counts });
  }
  const holes = buildAllHoles(events);
  const years = new Set<number>();
  for (const h of Object.values(holes)) for (const y of h.yearsCovered) years.add(y);
  return { tournamentId, familySlug: t.slug, yearsCovered: [...years].sort(), holes };
}
