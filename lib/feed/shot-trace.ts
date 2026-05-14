/**
 * Turn a hole's strokes into a drawable shot trace — the normalised
 * 0-1 from→to coordinates of each shot — and mark which segment IS the
 * story (the stuffed approach, the long putt, the hole-out). The
 * tracer frames and highlights that key segment instead of showing the
 * whole hole flat.
 *
 * Strokes the orchestrator hasn't tracked (coords of -1) are dropped.
 */

import type { PGAStroke } from "@/lib/golf-api/pgatour";

export interface ShotTraceSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  kind: "tee" | "shot" | "putt";
}

export interface ShotTrace {
  segments: ShotTraceSegment[];
  /** Index of the segment that is the story — the tracer focuses here. -1 if none. */
  keyIndex: number;
  /** PGA Tour overhead hole-diagram image URL, drawn behind the trace. */
  holeImage?: string;
}

/** Which shot the event is "about" — drives which segment is the key one. */
export type TraceFocus = "approach" | "putt" | "holeout" | "auto";

function valid(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

export function extractTrace(
  strokes: PGAStroke[],
  focus: TraceFocus = "auto",
  holeImage?: string,
): ShotTrace {
  const segments: ShotTraceSegment[] = [];
  for (const s of strokes) {
    if (![s.fromX, s.fromY, s.toX, s.toY].every(valid)) continue;
    const kind: ShotTraceSegment["kind"] =
      s.strokeNumber === 1
        ? "tee"
        : s.fromLocationCode === "OGR"
        ? "putt"
        : "shot";
    segments.push({
      fromX: s.fromX,
      fromY: s.fromY,
      toX: s.toX,
      toY: s.toY,
      kind,
    });
  }

  const img = holeImage || undefined;
  if (segments.length === 0) {
    return { segments, keyIndex: -1, holeImage: img };
  }

  let keyIndex: number;
  if (focus === "putt") {
    // The story is the putting — frame from the first putt.
    const fp = segments.findIndex((s) => s.kind === "putt");
    keyIndex = fp >= 0 ? fp : segments.length - 1;
  } else if (focus === "holeout") {
    // Eagle / ace — the holing stroke is the moment.
    keyIndex = segments.length - 1;
  } else if (focus === "approach") {
    // Stuffed approach — the last non-putt shot is the one that stiffed it.
    let k = segments.length - 1;
    while (k > 0 && segments[k].kind === "putt") k--;
    keyIndex = k;
  } else {
    keyIndex = segments.length - 1;
  }

  return { segments, keyIndex, holeImage: img };
}
