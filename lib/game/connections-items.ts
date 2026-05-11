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
  // Note: "Money" lives at w-word-money below — shared between
  //   "___ shot" (money shot) and "Pure shot" categories.
  "w-pre-shot-trick": "Trick",
  "w-pre-shot-hero": "Hero",
  "w-pre-shot-punch": "Punch",

  // ─── "Golf ____" — words that can follow GOLF ─────────────────
  // Note: "Cart" lives at w-word-cart below — shared between
  //   "Golf ___" (golf cart) and "Bag types" (cart bag) categories.
  "w-post-golf-ball": "Ball",
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

  // ─── Parts of the golf swing ──────────────────────────────────
  "w-swing-setup": "Setup",
  "w-swing-backswing": "Backswing",
  "w-swing-downswing": "Downswing",
  "w-swing-followthrough": "Follow-through",

  // ─── Mis-hit terms (every golfer's nightmare vocabulary) ──────
  "w-mishit-shank": "Shank",
  "w-mishit-chunk": "Chunk",
  "w-mishit-skull": "Skull",
  "w-mishit-thin": "Thin",
  "w-mishit-fat": "Fat",
  "w-mishit-top": "Top",

  // ─── Insider words for a perfectly struck shot ────────────────
  "w-pure-pure": "Pure",
  "w-pure-flush": "Flush",
  "w-pure-sweet": "Sweet",
  "w-pure-stripe": "Stripe",

  // ─── Famous golf grip styles ──────────────────────────────────
  "w-grip-interlocking": "Interlocking",
  "w-grip-overlapping": "Overlapping",
  "w-grip-baseball": "Baseball",
  "w-grip-vardon": "Vardon",

  // ─── Augusta back-nine "flower" holes ─────────────────────────
  //   12 Golden Bell · 13 Azalea · 16 Redbud · 18 Holly
  "w-azalea-golden-bell": "Golden Bell",
  "w-azalea-azalea": "Azalea",
  "w-azalea-redbud": "Redbud",
  "w-azalea-holly": "Holly",

  // ─── Things on a golf hole that all have non-golf meanings ────
  "w-hole-cup": "Cup",
  "w-hole-flag": "Flag",
  "w-hole-hole": "Hole",
  // Note: "Pin" already exists as w-feature-pin.

  // ─── Anatomy of a golf ball ───────────────────────────────────
  "w-ball-dimple": "Dimple",
  "w-ball-cover": "Cover",
  "w-ball-core": "Core",
  "w-ball-compression": "Compression",

  // ─── Types of water hazard ────────────────────────────────────
  "w-water-lake": "Lake",
  "w-water-pond": "Pond",
  "w-water-creek": "Creek",
  "w-water-stream": "Stream",

  // ─── Types of golf bag ────────────────────────────────────────
  // Note: "Cart" shared with "Golf ___" — see w-word-cart below.
  "w-bag-staff": "Staff",
  "w-bag-carry": "Carry",
  "w-bag-tour": "Tour",

  // ─── PGA Tour events whose names are also common words ────────
  "w-event-players": "Players",
  "w-event-memorial": "Memorial",
  "w-event-travelers": "Travelers",
  "w-event-heritage": "Heritage",
  "w-event-genesis": "Genesis",

  // ─── Materials used in golf club construction ─────────────────
  // Steel / Graphite / Titanium pair with Wood and Iron from the
  // clubs section above — the same word IS both a club and a
  // material, which is exactly the cross-meaning trick we want.
  "w-mat-steel": "Steel",
  "w-mat-graphite": "Graphite",
  "w-mat-titanium": "Titanium",

  // ─── Aspects of golf practice ─────────────────────────────────
  // "Driving" is also in the "___ club" filler — same word, two
  // intended readings (driving club / driving practice).
  "w-practice-putting": "Putting",
  "w-practice-chipping": "Chipping",
  "w-practice-approach": "Approach",

  // ─── Words shared across multiple category meanings ───────────
  // Single registry entry per display text — categories reference
  // the same id when they want the same word to appear under
  // different interpretations.
  "w-word-money": "Money", // "___ shot" + perfectly struck shot
  "w-word-cart": "Cart", // "Golf ___" + type of bag
};

export function itemTextOrNull(id: string): string | null {
  return ITEM_REGISTRY[id] ?? null;
}
