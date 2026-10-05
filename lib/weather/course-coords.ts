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
  "Detroit Golf Club": {
    lat: 42.4363,
    lon: -83.1245,
    tz: "America/Detroit",
    displayName: "Detroit Golf Club",
  },
  "Sedgefield Country Club": {
    lat: 36.0103,
    lon: -79.8843,
    tz: "America/New_York",
    displayName: "Sedgefield Country Club",
  },
  "TPC Southwind": {
    lat: 35.0552,
    lon: -89.8453,
    tz: "America/Chicago",
    displayName: "TPC Southwind",
  },
  "East Lake Golf Club": {
    lat: 33.7409,
    lon: -84.3103,
    tz: "America/New_York",
    displayName: "East Lake Golf Club",
  },
  // OSM golf_course polygon centroid. DataGolf's schedule coord
  // (37.168, -113.653) sits ~1.3 km north of the course.
  "Black Desert Resort": {
    lat: 37.1567,
    lon: -113.6507,
    tz: "America/Denver",
    displayName: "Black Desert Resort",
  },
  // Centroid of the West course hole ways in OSM, where 16 of the 18
  // tournament holes are. DataGolf's schedule coord (35.446, 139.549)
  // sits ~500 m east, between the two courses.
  "Yokohama Country Club": {
    lat: 35.4465,
    lon: 139.5435,
    tz: "Asia/Tokyo",
    displayName: "Yokohama Country Club",
  },
};

/** By PGA orchestrator tournament id (e.g. R2026525). Same coords
 *  as the course entry above but keyed for the live path. Suffix
 *  525 = 3M Open, 524 = Rocket Classic, 013 = Wyndham Championship,
 *  027 = FedEx St. Jude Championship, 060 = TOUR Championship,
 *  554 = Bank of Utah Championship, 527 = Baycurrent Classic. */
const BY_TOURNAMENT_ID: Record<string, CourseCoords> = {
  // 3M Open — TPC Twin Cities
  R2023525: BY_COURSE["TPC Twin Cities"],
  R2024525: BY_COURSE["TPC Twin Cities"],
  R2025525: BY_COURSE["TPC Twin Cities"],
  R2026525: BY_COURSE["TPC Twin Cities"],
  // Rocket Classic — Detroit Golf Club
  R2023524: BY_COURSE["Detroit Golf Club"],
  R2024524: BY_COURSE["Detroit Golf Club"],
  R2025524: BY_COURSE["Detroit Golf Club"],
  R2026524: BY_COURSE["Detroit Golf Club"],
  // Wyndham Championship — Sedgefield Country Club (Ross Course)
  R2023013: BY_COURSE["Sedgefield Country Club"],
  R2024013: BY_COURSE["Sedgefield Country Club"],
  R2025013: BY_COURSE["Sedgefield Country Club"],
  R2026013: BY_COURSE["Sedgefield Country Club"],
  // FedEx St. Jude Championship — TPC Southwind (Memphis)
  R2023027: BY_COURSE["TPC Southwind"],
  R2024027: BY_COURSE["TPC Southwind"],
  R2025027: BY_COURSE["TPC Southwind"],
  R2026027: BY_COURSE["TPC Southwind"],
  // TOUR Championship — East Lake Golf Club
  R2023060: BY_COURSE["East Lake Golf Club"],
  R2024060: BY_COURSE["East Lake Golf Club"],
  R2025060: BY_COURSE["East Lake Golf Club"],
  R2026060: BY_COURSE["East Lake Golf Club"],
  // Bank of Utah Championship (Black Desert Championship in 2024)
  R2024554: BY_COURSE["Black Desert Resort"],
  R2025554: BY_COURSE["Black Desert Resort"],
  R2026554: BY_COURSE["Black Desert Resort"],
  // Baycurrent Classic — Yokohama CC. 527 was the ZOZO at Narashino
  // through 2024, so only 2025 onward map here.
  R2025527: BY_COURSE["Yokohama Country Club"],
  R2026527: BY_COURSE["Yokohama Country Club"],
};

export function coordsForCourse(name: string | null | undefined): CourseCoords | null {
  if (!name) return null;
  return BY_COURSE[name] ?? null;
}

export function coordsForTournamentId(id: string | null | undefined): CourseCoords | null {
  if (!id) return null;
  return BY_TOURNAMENT_ID[id] ?? null;
}
