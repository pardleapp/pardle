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

import type { PGAStroke } from "@/lib/golf-api/pgatour";
import { resultFor, type ScoreResult } from "./types";

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
   * Descriptive fragment for a great finish, e.g. "holes out from
   * 140 yds" or "drains a 38 ft putt" — null when the hole was finished
   * the routine way and the generic headline is fine.
   */
  verdict: string | null;
  emoji: string;
  /**
   * True when the *way it finished* is genuinely reaction-worthy — a
   * hole-out from off the green or a long putt dropped. This is what
   * promotes an ordinary birdie into the Shots-of-the-day reel.
   */
  great: boolean;
  /**
   * Which kind of great finish — drives the tracer's framing. A long
   * putt or short chip-in (distance in feet, off the green) zooms to
   * the green; a longer hole-out (distance in yards) shows the whole
   * hole so the distance reads.
   */
  kind: "holeout" | "chipin" | "longputt" | null;
}

/**
 * Inspect how a hole was *finished* — the holing stroke tells the story:
 * holed from off the green (a hole-out) or a long putt dropped. Works
 * for any score: a chip-in for birdie is as much a "shot of the day"
 * as a holed approach for eagle.
 */
export function analyzeHighlightHole(strokes: PGAStroke[]): HoleGlory {
  if (strokes.length === 0)
    return { verdict: null, emoji: "🦅", great: false, kind: null };
  const holing = strokes[strokes.length - 1];

  // Holed from anywhere but the green — a hole-out. The rarest thrill.
  if (holing.fromLocationCode !== "OGR" && holing.distance) {
    // Distance in feet/inches = a short chip or pitch from just off
    // the green; distance in yards = a longer holed approach. The
    // tracer wants different framings for each.
    const isChip = /\bft\b|\bin\.?\b/i.test(holing.distance);
    return {
      verdict: `holes out from ${holing.distance}`,
      emoji: "🎯",
      great: true,
      kind: isChip ? "chipin" : "holeout",
    };
  }

  // Holed a putt — only call it out when it was a genuine bomb.
  if (holing.fromLocationCode === "OGR" && holing.distance) {
    const feet = distanceToFeet(holing.distance);
    if (feet != null && feet >= LONG_PUTT_FEET) {
      return {
        verdict: `drains a ${holing.distance} putt`,
        emoji: "🎯",
        great: true,
        kind: "longputt",
      };
    }
  }

  return { verdict: null, emoji: "🦅", great: false, kind: null };
}

/**
 * The Worst-of reel is reserved for the genuinely reaction-worthy
 * disasters: multi-putts and balls in the water. A sloppy double from
 * missing a green or visiting a bunker just isn't interesting enough —
 * those get NO verdict, stay out of the reel, and still show in the
 * main feed as a plain "doubles the Nth".
 */
export function analyzeHole(strokes: PGAStroke[]): HoleDisaster {
  const putts = strokes.filter(isPutt);
  const penalties = strokes.filter(isPenalty);
  const puttCount = putts.length;
  const penaltyCount = penalties.length;
  const firstPuttDistance = putts[0]?.distance ?? null;

  // Most dramatic storyline first. Only multi-putts and penalties
  // qualify — everything else returns a null verdict.
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
  }

  return {
    puttCount,
    firstPuttDistance,
    penaltyCount,
    verdict,
    emoji,
  };
}

export interface HoleSummary {
  /** Short line describing how the hole played out, e.g. "up and down for par". */
  synopsis: string;
  emoji: string;
}

const RESULT_LABEL: Record<ScoreResult, string> = {
  albatross: "albatross",
  eagle: "eagle",
  birdie: "birdie",
  par: "par",
  bogey: "bogey",
  double: "double",
  "triple-plus": "triple+",
};

const SAND_FROM = new Set(["OST", "OBK", "OSA", "OFB", "OGB"]);
const ROUGH_FROM = new Set(["ORO", "OPR", "OFR", "ONA"]);

/**
 * One-line synopsis of how a hole played out — used in the player card's
 * "Recent holes" feed. Looks at the stroke pattern, not just the score,
 * so a scrambled par reads "up and down for par" while a tap-in birdie
 * reads "stuffed it close, birdie".
 */
export function summarizeHole(
  strokes: PGAStroke[],
  par: number,
  score: number,
): HoleSummary {
  const result = resultFor(score, par);
  const label = RESULT_LABEL[result];

  if (strokes.length === 0) return { synopsis: label, emoji: "—" };

  if (strokes.length === 1 && score === 1) {
    return { synopsis: "HOLE IN ONE", emoji: "🏌️" };
  }

  const putts = strokes.filter(isPutt);
  const penaltyCount = strokes.filter(isPenalty).length;
  const puttCount = putts.length;
  const holing = strokes[strokes.length - 1];

  if (holing.fromLocationCode !== "OGR" && strokes.length > 1) {
    const where = holing.distance ? `from ${holing.distance} ` : "";
    return { synopsis: `holes out ${where}for ${label}`, emoji: "🎯" };
  }

  if (penaltyCount >= 2) {
    return { synopsis: `two penalties, ${label}`, emoji: "🌊" };
  }
  if (penaltyCount === 1) {
    return { synopsis: `penalty drop, ${label}`, emoji: "🌊" };
  }

  if (puttCount >= 4) return { synopsis: `4-putts for ${label}`, emoji: "😱" };
  if (puttCount === 3) return { synopsis: `3-putts for ${label}`, emoji: "😬" };

  if (puttCount === 1 && holing.fromLocationCode === "OGR") {
    const feet = distanceToFeet(holing.distance);
    if (feet != null && feet >= LONG_PUTT_FEET) {
      return {
        synopsis: `drains a ${holing.distance} putt for ${label}`,
        emoji: "🎯",
      };
    }
  }

  // The stroke that reached the green is the one right before the first
  // putt — derive it by index, not by toLocationCode (which the
  // orchestrator sometimes labels as fringe/other even when the next
  // stroke is a putt).
  const approachIdx = strokes.length - puttCount - 1;
  const approach = approachIdx >= 0 ? strokes[approachIdx] : null;
  const approachStrokeNum = approach?.strokeNumber ?? strokes.length;
  const gir =
    approach !== null && approachStrokeNum <= Math.max(1, par - 2);
  const reachFrom = approach?.fromLocationCode ?? "";

  if (!gir) {
    if (puttCount === 1) {
      if (SAND_FROM.has(reachFrom))
        return { synopsis: `sand save for ${label}`, emoji: "🙌" };
      return { synopsis: `up and down for ${label}`, emoji: "🙌" };
    }
    if (SAND_FROM.has(reachFrom))
      return { synopsis: `from the sand, ${label}`, emoji: "😬" };
    if (ROUGH_FROM.has(reachFrom))
      return { synopsis: `missed the green, ${label}`, emoji: "😬" };
    return { synopsis: `missed the green, ${label}`, emoji: "😬" };
  }

  if (puttCount <= 1 && (result === "birdie" || result === "eagle" || result === "albatross")) {
    return { synopsis: `stuffs it close, ${label}`, emoji: "🦅" };
  }
  if (puttCount === 1) {
    return { synopsis: `1-putt ${label}`, emoji: "✅" };
  }
  return {
    synopsis: `2-putt ${label}`,
    emoji: result === "bogey" || result === "double" || result === "triple-plus" ? "😬" : "🟢",
  };
}
