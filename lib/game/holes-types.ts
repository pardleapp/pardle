import type { Continent, CellState, AttributeReveal } from "./types";

export type CourseType =
  | "Links"
  | "Parkland"
  | "Heathland"
  | "Stadium"
  | "Resort"
  | "Sandbelt";

export type CourseTier = "S" | "A" | "B" | "C";

export type Difficulty = "easy" | "hard";

export interface Course {
  id: string;
  name: string;
  shortName: string;
  country: string;
  countryCode: string;
  continent: Continent;
  yearFounded: number;
  courseType: CourseType;
  par: number;
  /** Latitude of the course centroid (degrees). Used for the easy view. */
  lat: number;
  /** Longitude of the course centroid (degrees). Used for the easy view. */
  lng: number;
  /** Mapbox zoom level for the easy view. 14 fits the whole property; 16 zooms tighter. */
  zoom: number;
  /** The iconic hole revealed in the answer card. */
  iconicHole: number;
  iconicHoleNote?: string;
  /**
   * Optional precise coordinates of the iconic hole's green. When present,
   * the hard-difficulty view centres the satellite image on this point at
   * a high zoom, showing the actual hole rather than the whole property.
   * When absent, hard mode falls back to the course centroid at zoom 17.
   */
  iconicHoleLat?: number;
  iconicHoleLng?: number;
  iconicHoleZoom?: number;
  tier: CourseTier;
}

export interface CourseGuessReveal {
  course: Course;
  country: AttributeReveal;
  yearFounded: AttributeReveal;
  courseType: AttributeReveal;
  par: AttributeReveal;
  isWin: boolean;
}

export const HOLES_MAX_GUESSES = 6;

// Re-exports so the holes page only imports from this module.
export type { CellState, AttributeReveal };
