/**
 * Tournament → course lookup. The orchestrator gives us a
 * tournament name like "THE CJ CUP Byron Nelson"; we match it
 * against the keywords below to find which extracted course
 * geometry to load.
 *
 * Keywords are case-insensitive substring matches. First hit wins.
 * Add more events as we extract more courses.
 */

export interface CourseRegistryEntry {
  /** Slug matching the per-course JSON in lib/data/courses/{id}.json */
  id: string;
  /** Friendly course name for the header. */
  name: string;
  /** Substring keywords matched against the live tournament name. */
  matchers: string[];
}

export const COURSE_REGISTRY: CourseRegistryEntry[] = [
  {
    id: "augusta-national",
    name: "Augusta National Golf Club",
    matchers: ["Masters", "Augusta"],
  },
  {
    id: "tpc-sawgrass",
    name: "TPC Sawgrass",
    matchers: ["Players Championship", "THE PLAYERS", "TPC Sawgrass"],
  },
  {
    id: "pinehurst-no-2",
    name: "Pinehurst No. 2",
    matchers: ["Pinehurst", "U.S. Open Pinehurst"],
  },
  {
    id: "muirfield-village",
    name: "Muirfield Village Golf Club",
    matchers: ["Memorial Tournament", "Muirfield Village"],
  },
  {
    id: "riviera-country-club",
    name: "The Riviera Country Club",
    matchers: ["Genesis Invitational", "Riviera"],
  },
  {
    id: "quail-hollow",
    name: "Quail Hollow Club",
    matchers: ["Wells Fargo", "Truist Championship", "Quail Hollow", "PGA Championship"],
  },
  {
    id: "pebble-beach",
    name: "Pebble Beach Golf Links",
    matchers: ["Pebble Beach", "AT&T Pro-Am"],
  },
  {
    id: "royal-birkdale",
    name: "Royal Birkdale Golf Club",
    matchers: ["Royal Birkdale", "Birkdale"],
  },
  {
    id: "royal-portrush",
    name: "Royal Portrush Golf Club",
    matchers: ["Royal Portrush", "Portrush"],
  },
  {
    id: "st-andrews-old",
    name: "St Andrews Old Course",
    matchers: ["St Andrews", "Old Course"],
  },
  {
    id: "royal-troon",
    name: "Royal Troon Golf Club",
    matchers: ["Royal Troon", "Troon"],
  },
  {
    id: "royal-liverpool",
    name: "Royal Liverpool Golf Club",
    matchers: ["Royal Liverpool", "Hoylake"],
  },
  {
    id: "colonial-cc",
    name: "Colonial Country Club",
    matchers: ["Charles Schwab Challenge", "Colonial Country Club"],
  },
  {
    id: "tpc-craig-ranch",
    name: "TPC Craig Ranch",
    matchers: ["CJ Cup Byron Nelson", "Byron Nelson", "TPC Craig Ranch"],
  },
  {
    id: "detroit-golf-club",
    name: "Detroit Golf Club",
    matchers: ["Rocket Mortgage Classic", "Rocket Classic", "Detroit Golf"],
  },
  {
    id: "memorial-park-houston",
    name: "Memorial Park Golf Course",
    matchers: [
      "Texas Children's Houston Open",
      "Houston Open",
      "Memorial Park",
    ],
  },
  {
    id: "sedgefield-country-club",
    name: "Sedgefield Country Club",
    matchers: ["Wyndham Championship", "Sedgefield"],
  },
  {
    id: "east-lake",
    name: "East Lake Golf Club",
    matchers: ["Tour Championship", "East Lake"],
  },
  {
    id: "bay-hill",
    name: "Bay Hill Club",
    matchers: ["Arnold Palmer Invitational", "Bay Hill"],
  },
  {
    id: "waialae-country-club",
    name: "Waialae Country Club",
    matchers: ["Sony Open", "Waialae"],
  },
  {
    id: "tpc-scottsdale",
    name: "TPC Scottsdale Stadium Course",
    matchers: ["Phoenix Open", "WM Phoenix Open", "TPC Scottsdale"],
  },
  {
    id: "tpc-summerlin",
    name: "TPC Summerlin",
    matchers: ["Shriners Children's Open", "Shriners Open", "TPC Summerlin"],
  },
  {
    id: "harbour-town",
    name: "Harbour Town Golf Links",
    matchers: ["RBC Heritage", "Harbour Town", "Hilton Head"],
  },
  {
    id: "trinity-forest",
    name: "Trinity Forest Golf Club",
    matchers: ["Trinity Forest"],
  },
];

/** The Open Championship's host rotates each year. When a
 *  tournament name is just "The Open Championship" without an
 *  explicit venue, this gives us the per-year route. Update
 *  annually. */
export const OPEN_VENUE_BY_YEAR: Record<number, string> = {
  2026: "royal-birkdale",
  2025: "royal-portrush",
  2024: "royal-troon",
  2023: "royal-liverpool",
};

export function lookupCourseForTournament(
  tournamentName: string | null,
): CourseRegistryEntry | null {
  if (!tournamentName) return null;
  const haystack = tournamentName.toLowerCase();
  for (const c of COURSE_REGISTRY) {
    for (const m of c.matchers) {
      if (haystack.includes(m.toLowerCase())) return c;
    }
  }
  return null;
}
