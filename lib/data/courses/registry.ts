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
];

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
