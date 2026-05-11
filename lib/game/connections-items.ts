/**
 * Registry of golf-related word/phrase items that can appear in a
 * Pardle: Connections puzzle, alongside player full-names sourced
 * from GOLFERS. Categories in connections-library.ts reference items
 * by id from EITHER source.
 *
 * The cleverness of the game lives in cross-domain overlap. "Wood"
 * could be a golf club, Tiger Woods' surname (he shows up as "Tiger
 * Woods"), or trees on a course. "Bunker" could be a course feature
 * or "bunker shot". The puzzle is figuring out which intended
 * grouping each item belongs to *today*.
 */

export const ITEM_REGISTRY: Record<string, string> = {
  // ─── Golf clubs ────────────────────────────────────────────────
  "w-club-driver": "Driver",
  "w-club-iron": "Iron",
  "w-club-wood": "Wood",
  "w-club-wedge": "Wedge",
  "w-club-putter": "Putter",
  "w-club-hybrid": "Hybrid",

  // ─── Course features ──────────────────────────────────────────
  "w-feature-fairway": "Fairway",
  "w-feature-bunker": "Bunker",
  "w-feature-green": "Green",
  "w-feature-rough": "Rough",
  "w-feature-tee": "Tee",
  "w-feature-pin": "Pin",

  // ─── Scoring terms (under par) ────────────────────────────────
  "w-score-eagle": "Eagle",
  "w-score-birdie": "Birdie",
  "w-score-albatross": "Albatross",
  "w-score-ace": "Ace",
  "w-score-condor": "Condor",

  // ─── Ball flight / shot shape ─────────────────────────────────
  "w-shot-slice": "Slice",
  "w-shot-hook": "Hook",
  "w-shot-fade": "Fade",
  "w-shot-draw": "Draw",

  // ─── Open Championship venues ─────────────────────────────────
  "w-venue-carnoustie": "Carnoustie",
  "w-venue-birkdale": "Birkdale",
  "w-venue-troon": "Troon",
  "w-venue-hoylake": "Hoylake",
  "w-venue-muirfield": "Muirfield",
  "w-venue-st-andrews": "St Andrews",
  "w-venue-portrush": "Portrush",
  "w-venue-turnberry": "Turnberry",

  // ─── Augusta National landmarks ───────────────────────────────
  //   Amen Corner / Magnolia Lane / Eisenhower Tree / Hogan Bridge
  "w-augusta-amen": "Amen",
  "w-augusta-magnolia": "Magnolia",
  "w-augusta-eisenhower": "Eisenhower",
  "w-augusta-hogan": "Hogan",

  // ─── Golf equipment brands ────────────────────────────────────
  "w-brand-titleist": "Titleist",
  "w-brand-callaway": "Callaway",
  "w-brand-taylormade": "TaylorMade",
  "w-brand-ping": "Ping",
  "w-brand-cobra": "Cobra",
  "w-brand-mizuno": "Mizuno",

  // ─── "____ club" — words that can precede CLUB ────────────────
  "w-pre-club-golf": "Golf",
  "w-pre-club-country": "Country",
  "w-pre-club-night": "Night",
  "w-pre-club-driving": "Driving",

  // ─── "____ shot" — words that can precede SHOT ────────────────
  "w-pre-shot-trick": "Trick",
  "w-pre-shot-money": "Money",
  "w-pre-shot-hero": "Hero",
  "w-pre-shot-punch": "Punch",

  // ─── "Golf ____" — words that can follow GOLF ─────────────────
  "w-post-golf-ball": "Ball",
  "w-post-golf-cart": "Cart",
  "w-post-golf-bag": "Bag",
  "w-post-golf-glove": "Glove",
  "w-post-golf-cap": "Cap",

  // ─── Famous golfer first names (when ALL members are first names) ─
  // These are SEPARATE from the GOLFERS dataset — the items show
  // just the first name. Useful for a "Famous golfer first names"
  // category that crosses with first-name patterns elsewhere.
  "w-fname-tiger": "Tiger",
  "w-fname-phil": "Phil",
  "w-fname-rory": "Rory",
  "w-fname-jack": "Jack",
  "w-fname-bubba": "Bubba",
  "w-fname-sergio": "Sergio",
};

export function itemTextOrNull(id: string): string | null {
  return ITEM_REGISTRY[id] ?? null;
}
