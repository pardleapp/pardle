/**
 * PGA Tour / DP World Tour switch for the analysis tools. The DP World
 * Tour tools are the same pages fed by mirror routes under /api/dpwt/,
 * selected with ?tour=dpwt.
 */
export type AnalysisTour = "pga" | "dpwt";

export function parseTour(v: string | string[] | undefined | null): AnalysisTour {
  return v === "dpwt" ? "dpwt" : "pga";
}

/** API path for the tour: /api/x -> /api/dpwt/x on the DP World Tour. */
export function apiFor(tour: AnalysisTour, p: string): string {
  return tour === "dpwt" ? p.replace(/^\/api\//, "/api/dpwt/") : p;
}

/** In-app link that keeps the tour selection. */
export function hrefFor(tour: AnalysisTour, p: string): string {
  if (tour !== "dpwt") return p;
  return `${p}${p.includes("?") ? "&" : "?"}tour=dpwt`;
}
