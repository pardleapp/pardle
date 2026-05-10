import type { Continent, CellState, AttributeReveal } from "./types";

export type CourseType =
  | "Links"
  | "Parkland"
  | "Stadium"
  | "Resort"
  | "Sandbelt";

export type CourseTier = "S" | "A" | "B" | "C";

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
  /** Latitude of the course centroid (degrees). */
  lat: number;
  /** Longitude of the course centroid (degrees). */
  lng: number;
  /** Mapbox zoom level. 14 fits the whole property; 16 zooms to a hole-area. */
  zoom: number;
  /** The hole that's revealed in the answer card — a famous one. */
  iconicHole: number;
  iconicHoleNote?: string;
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
