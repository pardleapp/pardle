/**
 * Course pin-birdie analysis — aggregates birdie-or-better rates
 * across every pin position for a given hole, combining as many
 * years of historical data as we have on file.
 *
 * "Birdie or better" = strokes < par (birdie, eagle, hole-out).
 *
 * Data comes in two shapes:
 *   - Player scoring per (hole, round) — from the historical JSON
 *     files (3m-open-{year}.json) for past years, and from
 *     orchestrator scorecards for the current live event.
 *   - Pin positions per (hole, round) — from the orchestrator's
 *     courseStats endpoint, cached under feed:pins:{tournamentId}.
 *
 * We join the two by (tournamentId, round, hole) and end up with,
 * for each hole, an array of pin positions each labelled with its
 * birdie/total counts. Quadrant summaries are computed on top.
 */

import type { CoursePinHole } from "@/lib/golf-api/pgatour";

export type Quadrant = "TL" | "TR" | "BL" | "BR";

export interface BirdieCount {
  /** Strokes < par count. */
  birdies: number;
  /** Players who posted a valid score on this hole in this round. */
  total: number;
  /** birdies / total (0 when total = 0). */
  rate: number;
}

export interface PinBirdie extends BirdieCount {
  year: number;
  tournamentId: string;
  round: number;
  /** 0-1 normalised coord on the green diagram (same frame as
   *  CoursePinHole.pinByRound). */
  x: number;
  y: number;
  quadrant: Quadrant;
}

export interface QuadrantSummary extends BirdieCount {
  /** How many distinct pin positions fell in this quadrant across
   *  the years — the sample-size headline for that zone. */
  pinCount: number;
}

/** A proximity-cluster of pins that all landed within a small
 *  distance of each other across seasons. Rate + counts are the
 *  aggregate over every pin in the cluster; centroid + radius are
 *  the visual anchor / span for drawing an overlay disc. */
export interface PinCluster extends BirdieCount {
  clusterId: string;
  centroid: { x: number; y: number };
  /** Distance (0-1 normalised) from centroid to the furthest pin
   *  in the cluster — the "how big is this location's neighbourhood"
   *  signal used to size the disc on the diagram. */
  radius: number;
  pinCount: number;
  /** Indices into the parent hole's `pins` array so the modal can
   *  highlight the individual pins that make up this cluster. */
  memberIndices: number[];
}

/** Everything the pin-sheet modal needs for one hole. */
export interface HoleBirdieData {
  holeNumber: number;
  par: number | null;
  yards: number | null;
  greenImageUrl: string;
  pins: PinBirdie[];
  quadrants: Record<Quadrant, QuadrantSummary>;
  /** Proximity clusters — the primary aggregation surface now that
   *  we know pin positions repeat year-to-year (course setup places
   *  pins in similar spots). Quadrants retained for backward-compat
   *  callers but the modal reads clusters. */
  clusters: PinCluster[];
  overall: QuadrantSummary;
  /** Range of years contributing (min, max) — handy for a
   *  "3 seasons · 12 pins" strapline in the UI. */
  yearsCovered: number[];
}

/** Assign a pin at (x, y) 0-1 normalised coords to a quadrant.
 *  The image uses y=0 at the top / y=1 at the bottom. */
export function quadrantOf(x: number, y: number): Quadrant {
  const left = x < 0.5;
  const top = y < 0.5;
  if (top) return left ? "TL" : "TR";
  return left ? "BL" : "BR";
}

/** Per (hole, round) birdie tally for a single event. Simple keyed
 *  map with hole/round as the composite. */
export type PerHoleRoundCounts = Map<string, BirdieCount>;

export function holeRoundKey(hole: number, round: number): string {
  return `${hole}:${round}`;
}

/** Fold one player's per-hole score into the tally. Missing / non-
 *  numeric strokes are treated as no-data and skipped. */
export function tallyPlayerHole(
  counts: PerHoleRoundCounts,
  hole: number,
  round: number,
  strokes: number | null | undefined,
  par: number | null | undefined,
): void {
  if (
    typeof strokes !== "number" ||
    typeof par !== "number" ||
    strokes <= 0 ||
    par <= 0
  ) {
    return;
  }
  const key = holeRoundKey(hole, round);
  const existing = counts.get(key);
  const bump = strokes < par ? 1 : 0;
  if (existing) {
    existing.birdies += bump;
    existing.total += 1;
    existing.rate = existing.birdies / existing.total;
  } else {
    counts.set(key, { birdies: bump, total: 1, rate: bump });
  }
}

/** Aggregate an array of PinBirdies into one QuadrantSummary. */
function summarise(pins: PinBirdie[]): QuadrantSummary {
  let birdies = 0;
  let total = 0;
  for (const p of pins) {
    birdies += p.birdies;
    total += p.total;
  }
  return {
    birdies,
    total,
    rate: total > 0 ? birdies / total : 0,
    pinCount: pins.length,
  };
}

/** Build the final HoleBirdieData for a single hole given raw
 *  per-event data. `events` is the list of tournaments we're
 *  combining (typically one historical file per year + optionally
 *  the live current event). */
export interface EventInput {
  year: number;
  tournamentId: string;
  /** Per-hole pin sheet from the pins endpoint. Some events
   *  legitimately miss a round's pin (data not posted); those pins
   *  just contribute nothing. */
  pins: CoursePinHole[];
  /** Per (hole, round) → { birdies, total, rate }. */
  counts: PerHoleRoundCounts;
}

const EMPTY_QUAD: QuadrantSummary = {
  birdies: 0,
  total: 0,
  rate: 0,
  pinCount: 0,
};

/** Proximity threshold in normalised (0-1) diagram coordinates.
 *  Two pins closer than this collapse into the same cluster. Tuned
 *  from empirical pin sheets: a modern PGA green is roughly 30 yd
 *  across, so 0.1 ≈ 3 yd — a tight "same location" definition that
 *  keeps distinct pin positions separated while merging the year-
 *  to-year repeats course-setup crews put in the same spot. */
const CLUSTER_THRESHOLD = 0.1;

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function centroidOf(pts: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
} {
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

/** Agglomerative clustering with centroid linkage — start with each
 *  pin as its own cluster, then iteratively merge the closest pair
 *  until the shortest inter-centroid distance exceeds the threshold.
 *  O(N²·log N) but N ≤ ~20 pins per hole so this is trivial. */
function clusterPins(pins: PinBirdie[]): PinCluster[] {
  if (pins.length === 0) return [];
  // Track by original index so the returned memberIndices point back
  // into the caller's pins array.
  interface Bucket {
    memberIndices: number[];
    centroid: { x: number; y: number };
  }
  let buckets: Bucket[] = pins.map((p, i) => ({
    memberIndices: [i],
    centroid: { x: p.x, y: p.y },
  }));
  while (buckets.length > 1) {
    let minD = Infinity;
    let a = -1;
    let b = -1;
    for (let i = 0; i < buckets.length; i++) {
      for (let j = i + 1; j < buckets.length; j++) {
        const d = dist(buckets[i].centroid, buckets[j].centroid);
        if (d < minD) {
          minD = d;
          a = i;
          b = j;
        }
      }
    }
    if (minD > CLUSTER_THRESHOLD) break;
    // Merge bucket b into a; drop b.
    const merged = [...buckets[a].memberIndices, ...buckets[b].memberIndices];
    const mergedPts = merged.map((i) => ({ x: pins[i].x, y: pins[i].y }));
    buckets[a] = {
      memberIndices: merged,
      centroid: centroidOf(mergedPts),
    };
    buckets = buckets.filter((_, k) => k !== b);
  }
  // Sort by descending pin count so the "biggest neighbourhood"
  // clusters come first (nice default for a summary list).
  buckets.sort((x, y) => y.memberIndices.length - x.memberIndices.length);
  return buckets.map((bucket, i) => {
    const members = bucket.memberIndices.map((idx) => pins[idx]);
    let birdies = 0;
    let total = 0;
    let radius = 0;
    for (const m of members) {
      birdies += m.birdies;
      total += m.total;
      const d = dist(bucket.centroid, m);
      if (d > radius) radius = d;
    }
    return {
      clusterId: `c${i}`,
      centroid: bucket.centroid,
      // Give a tiny minimum radius so single-pin clusters still
      // render as a visible disc rather than a zero-radius glitch.
      radius: Math.max(radius, 0.02),
      birdies,
      total,
      rate: total > 0 ? birdies / total : 0,
      pinCount: members.length,
      memberIndices: bucket.memberIndices,
    };
  });
}

export function buildHoleBirdieData(
  holeNumber: number,
  events: EventInput[],
): HoleBirdieData | null {
  const pins: PinBirdie[] = [];
  let par: number | null = null;
  let yards: number | null = null;
  let greenImageUrl = "";
  const yearsCovered = new Set<number>();

  for (const ev of events) {
    const holePin = ev.pins.find((h) => h.holeNumber === holeNumber);
    if (!holePin) continue;
    // Only use par/yards/image from the first event that has them so
    // the display metadata stays stable across selections.
    if (par == null && holePin.par != null) par = holePin.par;
    if (yards == null && holePin.yards != null) yards = holePin.yards;
    if (!greenImageUrl && holePin.greenImageUrl) {
      greenImageUrl = holePin.greenImageUrl;
    }
    for (const [rStr, coord] of Object.entries(holePin.pinByRound)) {
      const round = Number(rStr);
      if (!Number.isFinite(round)) continue;
      const count = ev.counts.get(holeRoundKey(holeNumber, round));
      const birdies = count?.birdies ?? 0;
      const total = count?.total ?? 0;
      // Skip pin/round combinations that have no scoring — they're
      // either upcoming rounds or missing data; contributing 0/0
      // would just dilute the rates.
      if (total === 0) continue;
      pins.push({
        year: ev.year,
        tournamentId: ev.tournamentId,
        round,
        x: coord.x,
        y: coord.y,
        quadrant: quadrantOf(coord.x, coord.y),
        birdies,
        total,
        rate: birdies / total,
      });
      yearsCovered.add(ev.year);
    }
  }

  if (pins.length === 0) return null;

  const quadrants: Record<Quadrant, QuadrantSummary> = {
    TL: EMPTY_QUAD,
    TR: EMPTY_QUAD,
    BL: EMPTY_QUAD,
    BR: EMPTY_QUAD,
  };
  const byQuad: Record<Quadrant, PinBirdie[]> = { TL: [], TR: [], BL: [], BR: [] };
  for (const p of pins) byQuad[p.quadrant].push(p);
  quadrants.TL = summarise(byQuad.TL);
  quadrants.TR = summarise(byQuad.TR);
  quadrants.BL = summarise(byQuad.BL);
  quadrants.BR = summarise(byQuad.BR);
  const overall = summarise(pins);
  const clusters = clusterPins(pins);

  return {
    holeNumber,
    par,
    yards,
    greenImageUrl,
    pins,
    quadrants,
    clusters,
    overall,
    yearsCovered: [...yearsCovered].sort((a, b) => a - b),
  };
}

/** Batch-build for every hole present across the input events. */
export function buildAllHoles(
  events: EventInput[],
): Record<number, HoleBirdieData> {
  const holeNumbers = new Set<number>();
  for (const ev of events) {
    for (const h of ev.pins) holeNumbers.add(h.holeNumber);
  }
  const out: Record<number, HoleBirdieData> = {};
  for (const h of holeNumbers) {
    const data = buildHoleBirdieData(h, events);
    if (data) out[h] = data;
  }
  return out;
}

/** Colour ramp for a birdie-or-better rate — bright red at 0%,
 *  through orange at ~15%, into emerald at 30%+. Returns an oklch()
 *  string ready to drop into a fill/background. Alpha controls the
 *  transparency for quadrant overlays vs opaque pin dots. */
export function rateColor(rate: number, alpha = 1): string {
  // Clamp to a 0-0.35 domain — anything above 35% is deep emerald.
  const t = Math.max(0, Math.min(1, rate / 0.35));
  // Hue sweep 25 (red) → 60 (orange) → 145 (emerald).
  let hue: number;
  if (t < 0.5) {
    // 25 → 60 across the first half
    hue = 25 + (60 - 25) * (t / 0.5);
  } else {
    // 60 → 145 across the second half
    hue = 60 + (145 - 60) * ((t - 0.5) / 0.5);
  }
  const light = 0.55 + t * 0.05; // slight lighten toward emerald
  const chroma = 0.16 - Math.abs(t - 0.5) * 0.05; // dip in the middle
  return `oklch(${light.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)} / ${alpha})`;
}

/** Compact percentage formatter used in labels — 12.3% keeps enough
 *  precision to distinguish quadrants without looking noisy. */
export function fmtRate(rate: number, digits = 1): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}
