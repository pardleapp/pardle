// Total yardage from the championship / back tees for each course.
// Hand-curated from published course records (PGA Tour course pages,
// the R&A's Open course pages, Augusta's official scorecard, etc).
// Numbers vary year to year as tees are stretched — values here are
// the most recent figure I'm confident about.
//
// Courses without an entry fall back to 7200 yards (typical championship
// length) which makes the reveal mid-of-range, not deceptive.

export const COURSE_YARDAGE: Record<string, number> = {
  // Majors / S tier
  "augusta-national-golf-club": 7510,
  "old-course-at-st-andrews": 7305,
  "pebble-beach-golf-links": 7075,
  "tpc-sawgrass": 7275,
  "pinehurst-resort": 7548,
  "bethpage-state-park": 7468,

  // Open rota
  "royal-troon-golf-club": 7208,
  "carnoustie-golf-links": 7402,
  "muirfield": 7245,
  "royal-birkdale-golf-club": 7156,
  "royal-liverpool-golf-club": 7383,
  "royal-st-georges-golf-club": 7189,
  "royal-portrush-golf-club": 7344,
  "royal-lytham-st-annes-golf-club": 7118,
  "trump-turnberry": 7489,

  // US majors / signature venues
  "cypress-point-club": 6524,
  "royal-county-down-golf-club": 7186,
  "oakmont-country-club": 7372,
  "shinnecock-hills-golf-club": 7440,
  "winged-foot-golf-club": 7477,
  "the-olympic-club": 7170,
  "torrey-pines-golf-course": 7765,
  "hazeltine-national-golf-club": 7674,
  "medinah-country-club": 7595,
  "valhalla-golf-club": 7458,
  "east-lake-golf-club": 7490,
  "merion-golf-club": 6996,
  "baltusrol-golf-club": 7375,
  "the-country-club": 7254,
  "southern-hills-country-club": 7556,
  "whistling-straits": 7790,

  // PGA Tour stops
  "quail-hollow-club": 7600,
  "bay-hill-club-and-lodge": 7466,
  "riviera-country-club": 7322,
  "trump-national-doral-miami": 7590,
  "spyglass-hill-golf-course": 6960,
  "pasatiempo-golf-club": 6692,
  "erin-hills": 7845,
  "chambers-bay": 7625,
  "crooked-stick-golf-club": 7569,
  "olympia-fields-country-club": 7383,
  "inverness-club": 7479,
  "pga-west": 7115,

  // DPW signature / Open + Irish venues
  "wentworth-club": 7283,
  "sunningdale-golf-club": 6692,
  "le-golf-national": 7400,
  "marco-simone-golf-and-country-club": 7268,
  "valderrama-golf-club": 7053,
  "royal-aberdeen-golf-club": 6539,
  "royal-dornoch-golf-club": 6748,
  "lahinch-golf-club": 6952,
  "portmarnock-golf-club": 7466,
  "the-k-club": 7350,
  "loch-lomond-golf-club": 7100,
  "kingsbarns-golf-links": 7227,
  "castle-stuart-golf-links": 6553,
  "gleneagles-hotel": 7296,
  "royal-cinque-ports-golf-club": 7204,

  // Resort / destination
  "pacific-dunes": 6800,
  "bandon-dunes-golf-resort": 6700,
  "kiawah-island-golf-resort": 7886,
  "streamsong-resort": 7148,
  "cabot-links": 6854,
  "cabot-cliffs": 6764,
  "barnbougle-dunes": 6770,
  "cape-kidnappers": 7137,
  "tara-iti-golf-club": 7240,
  "sand-hills-golf-club": 7089,

  // Australian sandbelt
  "royal-melbourne-golf-club": 6589,
  "kingston-heath-golf-club": 7079,

  // Lesser-known but recognisable
  "national-golf-links-of-america": 6925,
  "north-berwick-golf-club": 6500,
  "the-european-club": 7355,
  "old-head-golf-links": 7215,
  "walton-heath-golf-club": 7200,
  "the-berkshire-golf-club": 6420,
  "sebonack-golf-club": 7300,
  "garden-city-golf-club": 6900,
  "plainfield-country-club": 6859,
  "quaker-ridge-golf-club": 6745,
  "the-australian-golf-club": 7250,
  "royal-adelaide-golf-club": 6800,
};

const DEFAULT_YARDAGE = 7200;

export function yardageFor(courseId: string): number {
  return COURSE_YARDAGE[courseId] ?? DEFAULT_YARDAGE;
}
