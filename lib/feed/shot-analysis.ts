/**
 * Turn a hole's shot-by-shot strokes into a specific "what went wrong"
 * description — a 3-putt, a 4-putt, a penalty, two penalties — so the
 * "Worst of the day" reel can say "X 4-putts from 12 ft" instead of
 * just "X doubles the 8th".
 *
 * Signals (from PGA Tour orchestrator shotDetailsV3):
 *   - Putt   = stroke with fromLocationCode "OGR" (on green).
 *   - Penalty = stroke with strokeType "PENALTY".
 */

import type { PGAShotHole, PGAStroke } from "@/lib/golf-api/pgatour";

export interface HoleDisaster {
  /** Number of putts taken (includes the holed putt). */
  puttCount: number;
  /** Display distance of the first putt, e.g. "40 ft" — null if no putts. */
  firstPuttDistance: string | null;
  /** Number of penalty strokes on the hole. */
  penaltyCount: number;
  /**
   * The single most reaction-worthy line for this hole, or null when
   * nothing notable happened (a plain bogey with no putt/penalty drama).
   * Caller supplies the player name + hole; this is the descriptive
   * fragment, e.g. "4-putts from 12 ft" or "takes two penalties".
   */
  verdict: string | null;
  /** Emoji to pair with the verdict. */
  emoji: string;
}

function isPutt(s: PGAStroke): boolean {
  return s.fromLocationCode === "OGR";
}

function isPenalty(s: PGAStroke): boolean {
  return s.strokeType === "PENALTY";
}

const NUMBER_WORD = ["zero", "one", "two", "three", "four", "five"];
function word(n: number): string {
  return NUMBER_WORD[n] ?? String(n);
}

/** "a 7" / "an 8" — only 8 takes "an". */
function withArticle(n: number): string {
  return n === 8 ? `an ${n}` : `a ${n}`;
}

/**
 * Which trouble surfaces a ball visited during the hole. "to" location
 * codes are E + side + surface; the last char is the surface
 * (B=bunker, N=native/waste, R=rough, I=intermediate, F=fairway, G=green).
 */
function visitedSurfaces(strokes: PGAStroke[]): Set<string> {
  const out = new Set<string>();
  for (const s of strokes) {
    const code = (s.toLocationCode || "").toUpperCase();
    const last = code[code.length - 1];
    if (last === "B") out.add("bunker");
    else if (last === "N") out.add("native");
  }
  return out;
}

/** Parse a display distance ("140 yds", "50 ft 10 in.", "17 in") to feet. */
function distanceToFeet(d: string): number | null {
  if (!d) return null;
  const yds = /(\d+)\s*yds/i.exec(d);
  if (yds) return Number(yds[1]) * 3;
  const ft = /(\d+)\s*ft/i.exec(d);
  const inch = /(\d+)\s*in/i.exec(d);
  if (ft || inch) {
    return (ft ? Number(ft[1]) : 0) + (inch ? Number(inch[1]) : 0) / 12;
  }
  return null;
}

/** A putt this long, holed, is a reaction-worthy "drains it" moment. */
const LONG_PUTT_FEET = 25;

export interface HoleGlory {
  /**
   * Descriptive fragment for a great hole, e.g. "holes out from 140 yds"
   * or "drains a 38 ft putt" — null when the eagle came the routine way
   * (reached the green, two-putt) and the generic headline is fine.
   */
  verdict: string | null;
  emoji: string;
}

/**
 * Inspect how a hole was *finished* — the holing stroke tells the story:
 * holed from off the green (a hole-out) or a long putt dropped.
 */
export function analyzeHighlightHole(strokes: PGAStroke[]): HoleGlory {
  if (strokes.length === 0) return { verdict: null, emoji: "🦅" };
  const holing = strokes[strokes.length - 1];

  // Holed from anywhere but the green — a hole-out. The rarest thrill.
  if (holing.fromLocationCode !== "OGR" && holing.distance) {
    return { verdict: `holes out from ${holing.distance}`, emoji: "🎯" };
  }

  // Holed a putt — only call it out when it was a genuine bomb.
  if (holing.fromLocationCode === "OGR" && holing.distance) {
    const feet = distanceToFeet(holing.distance);
    if (feet != null && feet >= LONG_PUTT_FEET) {
      return { verdict: `drains a ${holing.distance} putt`, emoji: "🎯" };
    }
  }

  return { verdict: null, emoji: "🦅" };
}

export function analyzeHole(hole: PGAShotHole): HoleDisaster {
  const { strokes, par } = hole;
  const score = Number(hole.score);
  const putts = strokes.filter(isPutt);
  const penalties = strokes.filter(isPenalty);
  const puttCount = putts.length;
  const penaltyCount = penalties.length;
  const firstPuttDistance = putts[0]?.distance ?? null;

  // Strokes taken to reach the green = strokes before the first putt.
  // If the player never putted (holed out from off the green) treat
  // the whole hole as "to green".
  const firstPuttIdx = strokes.findIndex(isPutt);
  const strokesToGreen =
    firstPuttIdx === -1 ? strokes.length : firstPuttIdx;
  // A green should be reached in (par - 2). Two+ strokes over that is
  // a genuine scramble — chunked it around, couldn't find the green.
  const greenOverage = strokesToGreen - Math.max(1, par - 2);
  const surfaces = visitedSurfaces(strokes);
  const overPar = Number.isFinite(score) ? score - par : 0;

  // Pick the single most dramatic storyline, most specific first:
  // penalties and putting woes are the surest stories; otherwise the
  // scramble is coloured by where the ball ended up or the raw number.
  let verdict: string | null = null;
  let emoji = "💥";

  if (penaltyCount >= 2) {
    verdict = `takes ${word(penaltyCount)} penalties`;
    emoji = "🌊";
  } else if (puttCount >= 4) {
    verdict = firstPuttDistance
      ? `4-putts from ${firstPuttDistance}`
      : "4-putts";
    emoji = "😱";
  } else if (penaltyCount === 1) {
    verdict = "finds a penalty";
    emoji = "🌊";
  } else if (puttCount === 3) {
    verdict = firstPuttDistance
      ? `3-putts from ${firstPuttDistance}`
      : "3-putts";
    emoji = "😬";
  } else if (greenOverage >= 2) {
    // A genuine scramble — colour it by trouble surface, then severity.
    if (surfaces.has("native")) {
      verdict = "lost in the native area";
      emoji = "🌾";
    } else if (surfaces.has("bunker")) {
      verdict = "buried in the bunker";
      emoji = "🏖️";
    } else if (overPar >= 3 && Number.isFinite(score)) {
      verdict = `scrambles to ${withArticle(score)}`;
      emoji = "😖";
    } else {
      verdict = "can't find the green";
      emoji = "😖";
    }
  }

  return {
    puttCount,
    firstPuttDistance,
    penaltyCount,
    verdict,
    emoji,
  };
}
