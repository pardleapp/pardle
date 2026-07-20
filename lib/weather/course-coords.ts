/**
 * Coarse lat/lon per PGA Tour venue we render weather for. Add
 * entries here when adding weather to a new tournament's analysis
 * views. Match by course name from DataGolf's historical `course_name`
 * or by tournament id / name for the live path.
 *
 * `tz` must be a valid IANA zone — Open-Meteo daily aggregates are
 * bucketed in that timezone, so getting it wrong shifts each round's
 * weather by up to a day.
 */

export interface CourseCoords {
  lat: number;
  lon: number;
  tz: string;
  displayName: string;
}

const BY_COURSE: Record<string, CourseCoords> = {
  "TPC Twin Cities": {
    lat: 45.148,
    lon: -93.219,
    tz: "America/Chicago",
    displayName: "TPC Twin Cities",
  },
};

/** By PGA orchestrator tournament id (e.g. R2026525). Same coords
 *  as the course entry above but keyed for the live path. */
const BY_TOURNAMENT_ID: Record<string, CourseCoords> = {
  R2023525: BY_COURSE["TPC Twin Cities"],
  R2024525: BY_COURSE["TPC Twin Cities"],
  R2025525: BY_COURSE["TPC Twin Cities"],
  R2026525: BY_COURSE["TPC Twin Cities"],
};

export function coordsForCourse(name: string | null | undefined): CourseCoords | null {
  if (!name) return null;
  return BY_COURSE[name] ?? null;
}

export function coordsForTournamentId(id: string | null | undefined): CourseCoords | null {
  if (!id) return null;
  return BY_TOURNAMENT_ID[id] ?? null;
}
