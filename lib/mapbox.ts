/**
 * Mapbox Static Images URL builder. Used by the Holes game to fetch
 * satellite imagery for a given lat/lng/zoom, optionally with an
 * encoded polyline overlay tracing a hole's tee→green centreline.
 *
 * Token is a Mapbox public token (`pk....`) injected at build time
 * via NEXT_PUBLIC_MAPBOX_TOKEN. Free tier covers 50,000 requests/
 * month.
 *
 * If the token isn't set we return null so the UI can render a
 * friendly placeholder rather than a broken image.
 */

const STYLE = "satellite-v9";

export interface SatelliteRequest {
  lat: number;
  lng: number;
  zoom: number;
  /** Mapbox auto-fits the image to this rectangle when provided. */
  bbox?: [number, number, number, number];
  /** Google polyline-encoded path overlaid on the satellite. */
  path?: string;
  /** Hex colour for the path (no leading '#'). Default: gold-yellow. */
  pathColor?: string;
  width?: number;
  height?: number;
  retina?: boolean;
}

export function mapboxStaticUrl(req: SatelliteRequest): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const width = req.width ?? 640;
  const height = req.height ?? 640;
  const retina = req.retina ?? true;
  const dims = `${width}x${height}${retina ? "@2x" : ""}`;

  const overlay = req.path
    ? `path-4+${req.pathColor ?? "ffd64a"}-0.95(${encodeURIComponent(req.path)})/`
    : "";

  const camera = req.bbox
    ? `[${req.bbox.join(",")}]`
    : `${req.lng},${req.lat},${req.zoom},0,0`;

  return `https://api.mapbox.com/styles/v1/mapbox/${STYLE}/static/${overlay}${camera}/${dims}?access_token=${token}&logo=false&attribution=false`;
}
