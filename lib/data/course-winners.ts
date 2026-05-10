// Most recent winner of the headline tournament at each course.
// Hand-curated from well-documented events; courses where there's no
// regular headline event (resort / private / Asian / Australasian
// venues) are intentionally absent and show "—" in the Hard-mode
// reveal grid.
//
// Update when a course hosts a new major / signature event.

export const COURSE_WINNERS: Record<string, string> = {
  // 2025 majors (most recent headline event at each)
  "augusta-national-golf-club": "Rory McIlroy",      // 2025 Masters
  "tpc-sawgrass": "Rory McIlroy",                    // 2025 Players
  "quail-hollow-club": "Scottie Scheffler",          // 2025 PGA Championship
  "royal-portrush-golf-club": "Scottie Scheffler",   // 2025 Open Championship
  "oakmont-country-club": "J.J. Spaun",              // 2025 US Open

  // Recent Opens
  "royal-troon-golf-club": "Xander Schauffele",      // 2024 Open
  "royal-liverpool-golf-club": "Brian Harman",       // 2023 Open
  "old-course-at-st-andrews": "Cameron Smith",       // 2022 Open
  "royal-st-georges-golf-club": "Collin Morikawa",   // 2021 Open
  "royal-birkdale-golf-club": "Jordan Spieth",       // 2017 Open
  "carnoustie-golf-links": "Francesco Molinari",     // 2018 Open
  "muirfield": "Phil Mickelson",                     // 2013 Open
  "royal-lytham-st-annes-golf-club": "Ernie Els",    // 2012 Open
  "trump-turnberry": "Stewart Cink",                 // 2009 Open

  // US Opens
  "pinehurst-resort": "Bryson DeChambeau",           // 2024 US Open
  "torrey-pines-golf-course": "Jon Rahm",            // 2021 US Open
  "winged-foot-golf-club": "Bryson DeChambeau",      // 2020 US Open
  "pebble-beach-golf-links": "Gary Woodland",        // 2019 US Open
  "shinnecock-hills-golf-club": "Brooks Koepka",     // 2018 US Open
  "merion-golf-club": "Justin Rose",                 // 2013 US Open
  "the-country-club": "Matt Fitzpatrick",            // 2022 US Open
  "the-olympic-club": "Webb Simpson",                // 2012 US Open

  // Recent PGA Championships
  "valhalla-golf-club": "Xander Schauffele",         // 2024 PGA Championship
  "southern-hills-country-club": "Justin Thomas",    // 2022 PGA Championship
  "bethpage-state-park": "Brooks Koepka",            // 2019 PGA Championship
  "whistling-straits": "Jason Day",                  // 2015 PGA Championship
  "baltusrol-golf-club": "Jimmy Walker",             // 2016 PGA Championship
  "medinah-country-club": "Tiger Woods",             // 2006 PGA Championship
  "hazeltine-national-golf-club": "Y.E. Yang",       // 2009 PGA Championship

  // Active PGA Tour stops (signature/flagship events)
  "bay-hill-club-and-lodge": "Russell Henley",       // 2025 Arnold Palmer
  "riviera-country-club": "Hideki Matsuyama",        // 2024 Genesis
  "trump-national-doral-miami": "Patrick Reed",      // 2016 WGC Cadillac (last big event)

  // DP World Tour signature events
  "wentworth-club": "Billy Horschel",                // 2024 BMW PGA Championship
  "le-golf-national": "Ludvig Åberg",                // 2024 Open de France (best-effort)
  "marco-simone-golf-and-country-club": "Team Europe", // 2023 Ryder Cup
  "the-k-club": "Team Europe",                        // 2006 Ryder Cup
  "gleneagles-hotel": "Team Europe",                  // 2014 Ryder Cup
};
