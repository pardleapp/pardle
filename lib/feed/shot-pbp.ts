/**
 * Parse the PGA orchestrator's `playByPlay` string into a structured
 * shot description, and decide whether the shot is reaction-worthy
 * enough to put in the live feed.
 *
 * The orchestrator publishes playByPlay AS EACH SHOT LANDS — minutes
 * before the per-hole score field updates. Polling this field is how
 * we surface shot-level events ("big drive", "stuffed approach",
 * "penalty") at near-real-time speed instead of waiting for the hole
 * to finish.
 *
 * Observed playByPlay shapes:
 *   "331 yds to right bunker, 168 yds to hole"
 *   "106 yds to right green, 18 ft 6 in. to hole"
 *   "Driver, 312 yds to fairway, 105 yds to hole"
 *   "Waiting to tee off"
 *   "Round Complete"
 */

export interface ParsedShot {
  /** Distance the shot travelled, in yards. Null if the text was a status line. */
  shotYards: number | null;
  /** Where the ball came to rest, lowercased — e.g. "fairway", "rough", "green", "bunker", "water". */
  endsAt: string | null;
  /** Distance remaining to the hole, in feet (for short remainders) or yards-as-feet. Null if "in hole". */
  toHoleFeet: number | null;
  /** True when this is a pre-shot/post-round status, not an actual stroke. */
  status: "waiting" | "complete" | null;
}

/** Match "X yds to <lie>". Captures the yardage and the lie text. */
const SHOT_RE = /(\d+)\s*yds?\s+to\s+([a-z][a-z\s]*?)(?:,|$)/i;
/** Match "Y yds to hole" or "Y ft <Z in.> to hole". */
const TO_HOLE_YDS_RE = /(\d+)\s*yds?\s+to\s+hole\b/i;
const TO_HOLE_FT_RE = /(\d+)\s*ft(?:\s+(\d+)\s*in\.?)?\s+to\s+hole\b/i;

function normaliseLie(s: string): string {
  const t = s.trim().toLowerCase();
  // Strip directional qualifiers ("right green" → "green") since the
  // direction doesn't affect reaction-worthiness.
  return t.replace(/^(left|right|center|centre)\s+/, "");
}

export function parsePlayByPlay(pbp: string | null): ParsedShot | null {
  if (!pbp) return null;
  const text = pbp.trim();
  if (text === "Round Complete") {
    return { shotYards: null, endsAt: null, toHoleFeet: null, status: "complete" };
  }
  if (/waiting to tee off/i.test(text) || /^at tee$/i.test(text)) {
    return { shotYards: null, endsAt: null, toHoleFeet: null, status: "waiting" };
  }

  let shotYards: number | null = null;
  let endsAt: string | null = null;
  const m1 = SHOT_RE.exec(text);
  if (m1) {
    shotYards = Number(m1[1]);
    endsAt = normaliseLie(m1[2]);
  }

  let toHoleFeet: number | null = null;
  const ft = TO_HOLE_FT_RE.exec(text);
  if (ft) {
    const f = Number(ft[1]);
    const i = ft[2] ? Number(ft[2]) : 0;
    toHoleFeet = f + i / 12;
  } else {
    const yds = TO_HOLE_YDS_RE.exec(text);
    if (yds) toHoleFeet = Number(yds[1]) * 3;
  }

  if (shotYards === null && toHoleFeet === null) return null;
  return { shotYards, endsAt, toHoleFeet, status: null };
}

export type ShotKind = "drive" | "stuffed" | "penalty";

export interface ShotVerdict {
  kind: ShotKind;
  /** Headline fragment (player name + hole get added by the engine). */
  verdict: string;
  emoji: string;
  /** True for "in the worst-of" treatment (currently: penalty). */
  lowlight: boolean;
  /** True for "in the shot-of-the-day" treatment (currently: stuffed). */
  highlight: boolean;
}

const PENALTY_LIES = new Set([
  "water",
  "lake",
  "hazard",
  "penalty",
  "penalty area",
  "out of bounds",
  "ob",
  "lateral hazard",
  "creek",
  "lost ball",
]);
const LONG_DRIVE_YARDS = 330;
const STUFFED_PROXIMITY_FT = 5;

/**
 * Classify a parsed shot. Returns null for routine shots that don't
 * belong in the live feed.
 */
export function classifyShot(
  parsed: ParsedShot,
  shotNumber: number,
  par: number | null,
): ShotVerdict | null {
  if (parsed.status !== null) return null;

  // Penalty / water: emit regardless of shot number.
  if (parsed.endsAt && PENALTY_LIES.has(parsed.endsAt)) {
    return {
      kind: "penalty",
      verdict: `finds the ${parsed.endsAt}`,
      emoji: "💦",
      lowlight: true,
      highlight: false,
    };
  }

  // Long drive: tee shot on a par 4/5, big yardage, settling on
  // playable turf. We don't want to celebrate a 330-yd hook into the
  // trees.
  if (
    shotNumber === 1 &&
    parsed.shotYards !== null &&
    parsed.shotYards >= LONG_DRIVE_YARDS &&
    par !== null &&
    par >= 4 &&
    parsed.endsAt !== null &&
    (parsed.endsAt === "fairway" ||
      parsed.endsAt === "rough" ||
      parsed.endsAt === "green")
  ) {
    return {
      kind: "drive",
      verdict: `crushes a ${parsed.shotYards}-yard drive`,
      emoji: "💪",
      lowlight: false,
      highlight: false,
    };
  }

  // Stuffed approach: not a tee shot, ball ends on the green inside
  // 5 ft. The shot before a near-certain birdie/eagle look.
  if (
    shotNumber >= 2 &&
    parsed.endsAt === "green" &&
    parsed.toHoleFeet !== null &&
    parsed.toHoleFeet > 0 &&
    parsed.toHoleFeet <= STUFFED_PROXIMITY_FT
  ) {
    // Format remaining nicely: <= 1 ft → "inches", else "X ft".
    const dist =
      parsed.toHoleFeet < 1
        ? `${Math.round(parsed.toHoleFeet * 12)} in`
        : `${Math.round(parsed.toHoleFeet)} ft`;
    return {
      kind: "stuffed",
      verdict: `stiffs an approach to ${dist}`,
      emoji: "🎯",
      lowlight: false,
      highlight: true,
    };
  }

  return null;
}
