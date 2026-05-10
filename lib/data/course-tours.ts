// Manual mapping of course id -> the major pro tours that course has
// hosted regularly. Used to filter the daily puzzle pool in Holes.
//
// PGA = PGA Tour events (US-based tour, plus all four men's majors which
//       are PGA Tour-sanctioned events)
// DPW = DP World Tour (formerly European Tour) events, plus The Open
//       Championship which is co-sanctioned
//
// Courses not in this map appear in the "All" filter only — typically
// destination resorts (Bandon, Cabot Cliffs) or Australasian / Asian Tour
// venues with limited PGA/DPW exposure.

import type { Tour } from "@/lib/game/holes-types";

export const COURSE_TOURS: Record<string, Tour[]> = {
  // S tier — all major championship venues, hit both tours via the majors
  "augusta-national-golf-club": ["PGA", "DPW"],
  "old-course-at-st-andrews": ["PGA", "DPW"],
  "pebble-beach-golf-links": ["PGA", "DPW"],
  "tpc-sawgrass": ["PGA"],
  "pinehurst-resort": ["PGA", "DPW"],

  // The Open Championship rota — all major championship venues, both tours
  "royal-troon-golf-club": ["PGA", "DPW"],
  "carnoustie-golf-links": ["PGA", "DPW"],
  "muirfield": ["PGA", "DPW"],
  "royal-birkdale-golf-club": ["PGA", "DPW"],
  "royal-liverpool-golf-club": ["PGA", "DPW"],
  "royal-st-georges-golf-club": ["PGA", "DPW"],
  "royal-portrush-golf-club": ["PGA", "DPW"],
  "royal-lytham-st-annes-golf-club": ["PGA", "DPW"],
  "trump-turnberry": ["PGA", "DPW"],

  // US Open / PGA Championship venues — PGA Tour, plus majors trickle to DPW
  "bethpage-state-park": ["PGA", "DPW"],
  "cypress-point-club": ["PGA"],
  "oakmont-country-club": ["PGA", "DPW"],
  "shinnecock-hills-golf-club": ["PGA", "DPW"],
  "winged-foot-golf-club": ["PGA", "DPW"],
  "the-olympic-club": ["PGA", "DPW"],
  "hazeltine-national-golf-club": ["PGA", "DPW"],
  "medinah-country-club": ["PGA", "DPW"],
  "valhalla-golf-club": ["PGA", "DPW"],
  "merion-golf-club": ["PGA", "DPW"],
  "baltusrol-golf-club": ["PGA", "DPW"],
  "the-country-club": ["PGA", "DPW"],
  "southern-hills-country-club": ["PGA", "DPW"],
  "whistling-straits": ["PGA"],

  // Active PGA Tour stops (non-major)
  "torrey-pines-golf-course": ["PGA"],
  "east-lake-golf-club": ["PGA"],
  "quail-hollow-club": ["PGA"],
  "bay-hill-club-and-lodge": ["PGA"],
  "riviera-country-club": ["PGA"],
  "olympia-fields-country-club": ["PGA"],
  "inverness-club": ["PGA"],
  "erin-hills": ["PGA", "DPW"],
  "chambers-bay": ["PGA", "DPW"],
  "crooked-stick-golf-club": ["PGA"],
  "trump-national-doral-miami": ["PGA"],
  "pga-west": ["PGA"],
  "spyglass-hill-golf-course": ["PGA"],
  "pasatiempo-golf-club": ["PGA"],

  // DP World Tour venues — European events, Irish / Scottish opens etc.
  "wentworth-club": ["DPW"],
  "sunningdale-golf-club": ["DPW"],
  "le-golf-national": ["DPW"],
  "marco-simone-golf-and-country-club": ["DPW"],
  "valderrama-golf-club": ["DPW"],
  "royal-aberdeen-golf-club": ["DPW"],
  "royal-dornoch-golf-club": ["DPW"],
  "royal-county-down-golf-club": ["DPW"],
  "lahinch-golf-club": ["DPW"],
  "portmarnock-golf-club": ["DPW"],
  "the-k-club": ["DPW"],
  "loch-lomond-golf-club": ["DPW"],
  "kingsbarns-golf-links": ["DPW"],
  "castle-stuart-golf-links": ["DPW"],
  "gleneagles-hotel": ["DPW"],
  "royal-cinque-ports-golf-club": ["DPW"],
};
