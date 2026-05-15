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
  /**
   * True when the trace is already framed (the zoomed-green view for
   * putt stories) — the tracer should show it whole, not zoom further.
   */
  fullFrame?: boolean;
}

/** Which shot the event is "about" — drives which segment is the key one. */
export type TraceFocus = "approach" | "putt" | "holeout" | "auto";

function valid(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * The stroke index that defines the story for this focus. For a
 * hole-out or long putt or auto, it's the holing stroke; for an
 * approach event, it's the last non-putt stroke.
 */
function storyStrokeIndex(
  strokes: PGAStroke[],
  focus: TraceFocus,
): number {
  if (strokes.length === 0) return -1;
  if (focus === "approach") {
    let k = strokes.length - 1;
    while (k > 0 && strokes[k].fromLocationCode === "OGR") k--;
    return k;
  }
  return strokes.length - 1;
}

export function extractTrace(
  strokes: PGAStroke[],
  focus: TraceFocus = "auto",
  holeImage?: string,
  greenImage?: string,
): ShotTrace {
  // Putt stories are drawn on the zoomed-green diagram with the green
  // coordinate set; everything else uses the full-hole diagram.
  const useGreen = focus === "putt";

  const segments: ShotTraceSegment[] = [];
  const segmentStrokeNumbers: number[] = [];
  for (const s of strokes) {
    const fx = useGreen ? s.greenFromX : s.fromX;
    const fy = useGreen ? s.greenFromY : s.fromY;
    const tx = useGreen ? s.greenToX : s.toX;
    const ty = useGreen ? s.greenToY : s.toY;
    if (![fx, fy, tx, ty].every(valid)) continue;
    const kind: ShotTraceSegment["kind"] =
      s.strokeNumber === 1
        ? "tee"
        : s.fromLocationCode === "OGR"
        ? "putt"
        : "shot";
    segments.push({ fromX: fx, fromY: fy, toX: tx, toY: ty, kind });
    segmentStrokeNumbers.push(s.strokeNumber);
  }

  const img = (useGreen ? greenImage : holeImage) || undefined;
  if (segments.length === 0) {
    return { segments, keyIndex: -1, holeImage: img };
  }

  // If the orchestrator didn't track the stroke that the story is
  // about, the trace would mislead — e.g. an event headlined "holes out
  // from 289 yds" rendered as a tee-shot diagram because only the tee
  // had valid coords. Drop the trace entirely in that case.
  const storyIdx = storyStrokeIndex(strokes, focus);
  if (storyIdx >= 0) {
    const storyStrokeNum = strokes[storyIdx].strokeNumber;
    if (!segmentStrokeNumbers.includes(storyStrokeNum)) {
      return { segments: [], keyIndex: -1, holeImage: img };
    }
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

  // Putt traces are drawn on the already-zoomed green diagram, so the
  // tracer should show them whole rather than zooming in further.
  return { segments, keyIndex, holeImage: img, fullFrame: useGreen };
}
