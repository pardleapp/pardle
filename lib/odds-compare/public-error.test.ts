import { describe, expect, it } from "vitest";
import { publicError } from "@/lib/odds-compare/public-error";

/** The real strings these books have returned in production. */
const SCRAPER_CREDIT_ERROR =
  "PrizePicks 403: You have exhausted the API Credits available in this monthly cycle. You can upgrade your subscription or enable overages from your dashboard (https://dashboard.scraperapi.com/billing).";
const DK_LEAGUE_ERROR =
  "DraftKings league list 403: {\"error\":\"You have exhausted the API Credits available in this monthly cycle\"}";

describe("publicError", () => {
  it("never leaks the proxy vendor or its billing URL", () => {
    for (const raw of [SCRAPER_CREDIT_ERROR, DK_LEAGUE_ERROR]) {
      const out = publicError(raw) ?? "";
      expect(out.toLowerCase()).not.toContain("scraperapi");
      expect(out).not.toContain("http");
      expect(out.toLowerCase()).not.toContain("dashboard");
      expect(out.toLowerCase()).not.toContain("subscription");
    }
  });

  it("still says quota rather than a generic failure", () => {
    // The distinction matters: a quota problem is fixed in billing, a
    // reachability problem is fixed elsewhere. Collapsing them is how
    // this bug happened in the first place.
    expect(publicError(SCRAPER_CREDIT_ERROR)).toMatch(/quota/i);
    expect(publicError(DK_LEAGUE_ERROR)).toMatch(/quota/i);
  });

  it("passes through our own messages untouched", () => {
    for (const raw of [
      "home scraper offline",
      "no round-score lines posted",
      "DraftKings isn't carrying this event",
    ]) {
      expect(publicError(raw)).toBe(raw);
    }
  });

  it("falls back to a safe message for anything unrecognised", () => {
    // Deliberately free of the words the classifier keys on.
    const out = publicError("ECONNRESET at 10.0.0.4:443 while connecting") ?? "";
    expect(out).toBe("Couldn't reach this book right now");
  });

  it("stays undefined when there is no error", () => {
    expect(publicError(undefined)).toBeUndefined();
  });
});
