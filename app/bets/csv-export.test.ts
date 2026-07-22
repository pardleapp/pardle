/**
 * Tests for the small CSV helpers used by the /bets Export CSV button.
 * These are inlined in BetsClient.tsx (client component). We recreate
 * them here so we can pin the escaping semantics without pulling the
 * React component into a test environment.
 */
import { describe, expect, it } from "vitest";

function csvCell(v: string | number | undefined | null): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvPnlNumber(pl: string): number {
  const sign = pl.startsWith("−") || pl.startsWith("-") ? -1 : 1;
  const abs = parseFloat(pl.replace(/[^0-9.]/g, "")) || 0;
  return sign * abs;
}

describe("csvCell — RFC 4180 escaping", () => {
  it("passes plain strings through", () => {
    expect(csvCell("Rory McIlroy")).toBe("Rory McIlroy");
    expect(csvCell("Outright")).toBe("Outright");
  });
  it("wraps + doubles quotes when the value contains a comma", () => {
    expect(csvCell("McIlroy, Rory")).toBe('"McIlroy, Rory"');
  });
  it("wraps + doubles internal double quotes", () => {
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
  });
  it("wraps values that contain newlines", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
  it("stringifies numbers without quoting", () => {
    expect(csvCell(50)).toBe("50");
    expect(csvCell(2.75)).toBe("2.75");
  });
  it("returns empty string for null / undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("csvPnlNumber — parse formatted P&L back to signed number", () => {
  it("parses positive £", () => {
    expect(csvPnlNumber("+£340")).toBe(340);
  });
  it("parses negative Unicode minus", () => {
    expect(csvPnlNumber("−$50")).toBe(-50);
  });
  it("parses negative ASCII hyphen", () => {
    expect(csvPnlNumber("-$50")).toBe(-50);
  });
  it("parses unit stakes with decimal", () => {
    expect(csvPnlNumber("+2.5u")).toBe(2.5);
    expect(csvPnlNumber("−1.5u")).toBe(-1.5);
  });
  it("returns 0 on garbage input", () => {
    expect(csvPnlNumber("")).toBe(0);
  });
});
