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
  /** Lie this shot was played FROM, lowercased, when the orchestrator
   *  prefixes the pbp with "From rough, …" / "From bunker, …". Null
   *  when the prefix wasn't present. */
  fromLie: string | null;
  /** Club used, normalised to title-case ("Driver", "7-iron", "Wedge",
   *  "Putter"), when the orchestrator prefixes the pbp with the club.
   *  Null when not present. */
  club: string | null;
}

/** Match "X yds to <lie>". Captures the yardage and the lie text. */
const SHOT_RE = /(\d+)\s*yds?\s+to\s+([a-z][a-z\s]*?)(?:,|$)/i;
/** Match "Y yds to hole" or "Y ft <Z in.> to hole". */
const TO_HOLE_YDS_RE = /(\d+)\s*yds?\s+to\s+hole\b/i;
const TO_HOLE_FT_RE = /(\d+)\s*ft(?:\s+(\d+)\s*in\.?)?\s+to\s+hole\b/i;

/** "From rough, …" / "From left bunker, …" lead-in giving the lie the
 *  shot was played from. Strip when present, return the lie. */
const FROM_LIE_RE = /^from\s+([a-z][a-z\s]*?)\s*,\s*/i;

/** Club-name lead-in. Matches the orchestrator's most common formats:
 *    "Driver, …"  "3-wood, …"  "7 iron, …"  "Wedge, …"  "Hybrid, …"
 *  Conservative — only matches a known club word, not arbitrary text,
 *  so we don't mistake "Right green" or "Tee shot" for a club. */
const CLUB_RE =
  /^((?:Driver|3-wood|5-wood|7-wood|Wood|[2-9][- ]?iron|[2-9]\s*iron|[2-9]-?hybrid|Hybrid|PW|GW|SW|LW|Wedge|Putter))\s*,\s*/i;

function normaliseLie(s: string): string {
  const t = s.trim().toLowerCase();
  // Strip directional qualifiers ("right green" → "green") since the
  // direction doesn't affect reaction-worthiness.
  return t.replace(/^(left|right|center|centre)\s+/, "");
}

/** Normalise a club name to a consistent display form. */
function normaliseClub(s: string): string {
  const t = s.trim();
  // Lowercase except first letter — "Driver" / "3-iron" / "Wedge"
  if (/^[2-9]/.test(t)) {
    // Numeric prefix: keep digit, lower-case the rest, collapse "7 iron" → "7-iron"
    return t.toLowerCase().replace(/\s+/g, "-");
  }
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function parsePlayByPlay(pbp: string | null): ParsedShot | null {
  if (!pbp) return null;
  const text = pbp.trim();
  if (text === "Round Complete") {
    return {
      shotYards: null,
      endsAt: null,
      toHoleFeet: null,
      status: "complete",
      fromLie: null,
      club: null,
    };
  }
  if (/waiting to tee off/i.test(text) || /^at tee$/i.test(text)) {
    return {
      shotYards: null,
      endsAt: null,
      toHoleFeet: null,
      status: "waiting",
      fromLie: null,
      club: null,
    };
  }

  // Strip optional "From <lie>," and "[Club]," lead-ins so the main
  // shot regex sees the canonical "Xyds to Y" body. Order matters —
  // both can appear, but "From" always comes first when present.
  let body = text;
  let fromLie: string | null = null;
  const fromMatch = FROM_LIE_RE.exec(body);
  if (fromMatch) {
    fromLie = normaliseLie(fromMatch[1]);
    body = body.slice(fromMatch[0].length);
  }
  let club: string | null = null;
  const clubMatch = CLUB_RE.exec(body);
  if (clubMatch) {
    club = normaliseClub(clubMatch[1]);
    body = body.slice(clubMatch[0].length);
  }

  let shotYards: number | null = null;
  let endsAt: string | null = null;
  const m1 = SHOT_RE.exec(body);
  if (m1) {
    shotYards = Number(m1[1]);
    endsAt = normaliseLie(m1[2]);
  }

  let toHoleFeet: number | null = null;
  const ft = TO_HOLE_FT_RE.exec(body);
  if (ft) {
    const f = Number(ft[1]);
    const i = ft[2] ? Number(ft[2]) : 0;
    toHoleFeet = f + i / 12;
  } else {
    const yds = TO_HOLE_YDS_RE.exec(body);
    if (yds) toHoleFeet = Number(yds[1]) * 3;
  }

  if (shotYards === null && toHoleFeet === null) return null;
  return { shotYards, endsAt, toHoleFeet, status: null, fromLie, club };
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

  // Penalty / water: emit regardless of shot number. Add club + from-lie
  // detail only when present — "tugs a 7-iron from the rough into the
  // water" is far more evocative than "finds the water".
  if (parsed.endsAt && PENALTY_LIES.has(parsed.endsAt)) {
    const verdict = buildPenaltyVerdict(parsed);
    return {
      kind: "penalty",
      verdict,
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
  // 5 ft. The shot before a near-certain birdie/eagle look. Enrich
  // with club + approach distance + from-lie when the orchestrator
  // gave them to us — "stiffs a 192-yard 7-iron from the rough to
  // 4 ft" is the DataGolf-level copy we're aiming for.
  if (
    shotNumber >= 2 &&
    parsed.endsAt === "green" &&
    parsed.toHoleFeet !== null &&
    parsed.toHoleFeet > 0 &&
    parsed.toHoleFeet <= STUFFED_PROXIMITY_FT
  ) {
    const dist =
      parsed.toHoleFeet < 1
        ? `${Math.round(parsed.toHoleFeet * 12)} in`
        : `${Math.round(parsed.toHoleFeet)} ft`;
    return {
      kind: "stuffed",
      verdict: buildStuffedVerdict(parsed, dist),
      emoji: "🎯",
      lowlight: false,
      highlight: true,
    };
  }

  return null;
}

/**
 * "stiffs a [192-yard ][7-iron ]approach[ from the rough] to 4 ft".
 * Each enrichment slot turns on independently when the orchestrator
 * gave us the data — falls back to the original short form when none
 * of the slots fired.
 */
function buildStuffedVerdict(parsed: ParsedShot, dist: string): string {
  const yardBit =
    parsed.shotYards != null && parsed.shotYards > 0
      ? `${parsed.shotYards}-yard `
      : "";
  const clubBit = parsed.club ? `${parsed.club} ` : "";
  // Fairway is the default lie — no need to call it out. Tee/rough/
  // bunker/etc. add real colour to the moment.
  const fromBit =
    parsed.fromLie && parsed.fromLie !== "fairway"
      ? ` from the ${parsed.fromLie}`
      : "";
  // When club is known we want "stiffs an 8-iron approach" not "stiffs
  // a 192-yard 8-iron approach" — the yardage adds little next to a
  // named club. Yardage is the fallback when club is unknown. Both
  // empty falls back to "an approach". The previous form combined
  // yardBit with a noun that *already* contained yardBit, producing
  // "stiffs 69-yard 69-yard approach".
  const subject = clubBit
    ? `a ${clubBit}approach`
    : yardBit
      ? `${yardBit}approach`
      : "an approach";
  return `stiffs ${subject.trim()}${fromBit} to ${dist}`;
}

/**
 * "tugs a [7-iron ][from the rough ]into the water" / fallback "finds
 * the water". Penalty verdicts get verb variety when club is known —
 * a Driver into hazard reads differently than a wedge.
 */
function buildPenaltyVerdict(parsed: ParsedShot): string {
  if (!parsed.endsAt) return "finds trouble";
  const clubBit = parsed.club ? ` ${parsed.club}` : "";
  const fromBit =
    parsed.fromLie && parsed.fromLie !== "fairway"
      ? ` from the ${parsed.fromLie}`
      : "";
  if (clubBit) {
    return `pushes a${clubBit}${fromBit} into the ${parsed.endsAt}`;
  }
  return `finds the ${parsed.endsAt}`;
}
