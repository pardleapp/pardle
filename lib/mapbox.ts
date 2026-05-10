/**
 * Mapbox Static Images URL builder. Used by the Holes game to fetch
 * satellite imagery for a given lat/lng/zoom. Token is a Mapbox public
 * token (`pk....`) injected at build time via NEXT_PUBLIC_MAPBOX_TOKEN.
 *
 * Free tier covers 50,000 requests/month — well above the traffic we
 * expect in validation. Cache headers are set by Mapbox itself, and
 * the URL is deterministic per coords/zoom so the browser/CDN cache
 * naturally dedupes repeat fetches.
 *
 * If the token isn't set we return null so the UI can render a
 * friendly placeholder rather than a broken image.
 */

const STYLE = "satellite-v9";

export interface SatelliteRequest {
  lat: number;
  lng: number;
  zoom: number;
  width?: number;
  height?: number;
  /** True for retina displays — doubles pixel density at the same dimensions. */
  retina?: boolean;
  /** Bearing rotation in degrees (0-360). Default 0 (north up). */
  bearing?: number;
}

export function mapboxStaticUrl({
  lat,
  lng,
  zoom,
  width = 640,
  height = 640,
  retina = true,
  bearing = 0,
}: SatelliteRequest): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const dims = `${width}x${height}${retina ? "@2x" : ""}`;
  const camera = `${lng},${lat},${zoom},${bearing},0`;
  return `https://api.mapbox.com/styles/v1/mapbox/${STYLE}/static/${camera}/${dims}?access_token=${token}&logo=false&attribution=false`;
}
