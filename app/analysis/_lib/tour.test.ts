import { describe, expect, it } from "vitest";
import { apiFor, hrefFor, parseTour } from "./tour";

describe("analysis tour switch", () => {
  it("only treats ?tour=dpwt as the DP World Tour", () => {
    expect(parseTour("dpwt")).toBe("dpwt");
    expect(parseTour(undefined)).toBe("pga");
    expect(parseTour(["dpwt"])).toBe("pga");
    expect(parseTour("DPWT")).toBe("pga");
  });

  it("routes API calls to the DP World mirror and leaves PGA untouched", () => {
    expect(apiFor("dpwt", "/api/analysis/tournaments")).toBe("/api/dpwt/analysis/tournaments");
    expect(apiFor("dpwt", "/api/course-pins?tournamentId=D2025134")).toBe("/api/dpwt/course-pins?tournamentId=D2025134");
    expect(apiFor("pga", "/api/course-pins?tournamentId=R2025527")).toBe("/api/course-pins?tournamentId=R2025527");
  });

  it("keeps the tour on in-app links", () => {
    expect(hrefFor("dpwt", "/analysis")).toBe("/analysis?tour=dpwt");
    expect(hrefFor("dpwt", "/analysis/course-heatmap?hole=7")).toBe("/analysis/course-heatmap?hole=7&tour=dpwt");
    expect(hrefFor("pga", "/analysis/hole-scoring")).toBe("/analysis/hole-scoring");
  });
});
