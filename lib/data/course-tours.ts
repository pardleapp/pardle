// Manual mapping of course id -> the major pro tours that course is
// associated with for the Holes daily-puzzle filter.
//
// PGA = US-based PGA Tour event venues + US-hosted majors (US Open, PGA
//       Championship, Players Championship, Masters)
// DPW = DP World Tour (formerly European Tour) event venues + The Open
//       Championship rota (which is co-sanctioned with the PGA Tour as a
//       major, so Open courses also appear in the PGA filter)
//
// Courses not in this map appear in the "All" filter only — typically
// destination resorts (Bandon, Cabot Cliffs) or Australasian / Asian Tour
// venues with limited PGA/DPW exposure.

import type { Tour } from "@/lib/game/holes-types";

export const COURSE_TOURS: Record<string, Tour[]> = {
  // Masters — invitational major, technically both tours' players play it.
  "augusta-national-golf-club": ["PGA", "DPW"],

  // The Open Championship rota — major co-sanctioned with DP World Tour.
  // Every Open venue appears in both filters.
  "old-course-at-st-andrews": ["PGA", "DPW"],
  "royal-troon-golf-club": ["PGA", "DPW"],
  "carnoustie-golf-links": ["PGA", "DPW"],
  "muirfield": ["PGA", "DPW"],
  "royal-birkdale-golf-club": ["PGA", "DPW"],
  "royal-liverpool-golf-club": ["PGA", "DPW"],
  "royal-st-georges-golf-club": ["PGA", "DPW"],
  "royal-portrush-golf-club": ["PGA", "DPW"],
  "royal-lytham-st-annes-golf-club": ["PGA", "DPW"],
  "trump-turnberry": ["PGA", "DPW"],

  // US-based PGA Tour majors / signature events — PGA only.
  // (Players sometimes count these for DPW points but they aren't DP World
  // Tour course pedigree.)
  "pebble-beach-golf-links": ["PGA"],
  "tpc-sawgrass": ["PGA"],
  "pinehurst-resort": ["PGA"],
  "bethpage-state-park": ["PGA"],
  "cypress-point-club": ["PGA"],
  "oakmont-country-club": ["PGA"],
  "shinnecock-hills-golf-club": ["PGA"],
  "winged-foot-golf-club": ["PGA"],
  "the-olympic-club": ["PGA"],
  "hazeltine-national-golf-club": ["PGA"],
  "medinah-country-club": ["PGA"],
  "valhalla-golf-club": ["PGA"],
  "merion-golf-club": ["PGA"],
  "baltusrol-golf-club": ["PGA"],
  "the-country-club": ["PGA"],
  "southern-hills-country-club": ["PGA"],
  "whistling-straits": ["PGA"],
  "torrey-pines-golf-course": ["PGA"],
  "east-lake-golf-club": ["PGA"],
  "quail-hollow-club": ["PGA"],
  "bay-hill-club-and-lodge": ["PGA"],
  "riviera-country-club": ["PGA"],
  "olympia-fields-country-club": ["PGA"],
  "inverness-club": ["PGA"],
  "erin-hills": ["PGA"],
  "chambers-bay": ["PGA"],
  "crooked-stick-golf-club": ["PGA"],
  "trump-national-doral-miami": ["PGA"],
  "pga-west": ["PGA"],
  "spyglass-hill-golf-course": ["PGA"],
  "pasatiempo-golf-club": ["PGA"],

  // DP World Tour-specific venues — European/Irish events.
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
