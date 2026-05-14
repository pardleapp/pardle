/**
 * Turn a hole's strokes into a compact, drawable shot trace — the
 * normalised 0-1 from→to coordinates of each shot, ready to render as
 * an SVG overlay. Strokes the orchestrator hasn't tracked (coords of
 * -1) are dropped; what's left chains tee → green.
 */

import type { PGAStroke } from "@/lib/golf-api/pgatour";

export interface ShotTraceSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Used to colour/style the segment in the tracer. */
  kind: "tee" | "shot" | "putt";
}

function valid(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

export function extractTrace(strokes: PGAStroke[]): ShotTraceSegment[] {
  const segs: ShotTraceSegment[] = [];
  for (const s of strokes) {
    if (![s.fromX, s.fromY, s.toX, s.toY].every(valid)) continue;
    const kind: ShotTraceSegment["kind"] =
      s.strokeNumber === 1
        ? "tee"
        : s.fromLocationCode === "OGR"
        ? "putt"
        : "shot";
    segs.push({
      fromX: s.fromX,
      fromY: s.fromY,
      toX: s.toX,
      toY: s.toY,
      kind,
    });
  }
  return segs;
}
