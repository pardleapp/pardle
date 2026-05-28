/**
 * Shape of the per-course geometry JSON written by
 * scripts/extract-courses.mjs. Imported by the CourseMap renderer
 * + the api route that streams course data to the client.
 */

/** [lng, lat] tuple. Matches GeoJSON convention everywhere we
 *  pass course data through the wire. */
export type LngLat = [number, number];

/** A polygon: array of [lng, lat] points. May be open or closed —
 *  the extractor sets `closed` separately but renderers can also
 *  detect via first/last equality. */
export type Polygon = LngLat[];

export interface CourseFeature {
  id: number;
  coords: Polygon;
  holeNum: number | null;
  par: number | null;
}

export interface CourseHolePath extends CourseFeature {
  yardage: number | null;
}

export interface CourseHole {
  number: number;
  par: number | null;
  yardage: number | null;
  /** [lng, lat] of the tee box — either explicit OSM tee tag or
   *  the start of the hole path. May be null when neither is
   *  tagged in OSM. */
  tee: LngLat | null;
  /** [lng, lat] of the green — either a green polygon centroid
   *  or the end of the hole path. */
  green: LngLat | null;
}

export interface CourseGeo {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  /** [minLng, minLat, maxLng, maxLat] padded by ~3% beyond
   *  feature extents. Drives the SVG viewport. */
  bbox: [number, number, number, number];
  holes: CourseHole[];
  fairways: CourseFeature[];
  greens: CourseFeature[];
  tees: CourseFeature[];
  bunkers: CourseFeature[];
  rough: CourseFeature[];
  water: CourseFeature[];
  holePaths: CourseHolePath[];
  drivingRange: CourseFeature[];
  extractedAt: string;
  attribution: string;
}
