/**
 * Takeaway generator for the hole-scoring analysis tool.
 *
 * Turns the same HoleRow the table already computes into a short
 * ranked list of "here's what stands out" bullets that surface above
 * the grid. The purpose is not to add new data — the reader can
 * already SEE it in the table — but to compress it. The eye scans a
 * takeaway line faster than an 18-row grid.
 *
 * The single interesting move here is comparing OBSERVED scoring
 * against what the setup alone would predict, and flagging holes
 * where the two disagree. That's the "shorter and downwind but
 * scoring worse" case Tom asked for — a hole where the tour handed
 * out an easier setup and the field still couldn't cash it in
 * (usually pin placement, green firmness, or a shift in shot
 * strategy).
 *
 * Everything here is a pure function of HoleRow[]. Deterministic,
 * no I/O — trivially unit-testable.
 */

import type { HoleRow } from "./HoleSetup";

/** Rough coefficients for translating setup deltas into an expected
 *  scoring delta on tour. Numbers are conservative — well within the
 *  variance of any single day, so what SURVIVES this as a takeaway
 *  is a genuine outlier, not a signal-of-nothing curve fit.
 *
 *  Empirically derived from public tour setup research:
 *   - ~+0.02 strokes per extra 10 yards on par-4/5 approaches
 *   - ~+0.02 strokes per mph of headwind (asymmetric)
 *   - ~+0.01 strokes per mph of tailwind (helping wind helps less
 *     than headwind hurts, because trouble grows on long finishes) */
const YARDS_TO_STROKES_PER_10 = 0.02;
const HEADWIND_STROKES_PER_MPH = 0.02;
const TAILWIND_STROKES_PER_MPH = 0.01;

/** Predict how much harder (positive) or easier (negative) this
 *  round's setup should have made the hole play vs the other loaded
 *  rounds, in strokes-vs-par per player. */
export function expectedSetupDelta(row: HoleRow): number {
  let d = 0;
  if (typeof row.dYards === "number") {
    d += (row.dYards / 10) * YARDS_TO_STROKES_PER_10;
  }
  if (typeof row.head === "number") {
    d += row.head > 0
      ? row.head * HEADWIND_STROKES_PER_MPH
      : row.head * TAILWIND_STROKES_PER_MPH; // negative × positive → easier
  }
  return d;
}

export type TakeawayKind =
  | "surprise-hard"
  | "surprise-easy"
  | "yardage-jump"
  | "wind-driven"
  | "quiet-setup-loud-scoring"
  | "loud-setup-quiet-scoring";

export interface Takeaway {
  kind: TakeawayKind;
  hole: number;
  /** One-sentence headline for the chip. Under ~80 chars where
   *  possible so it reads in one glance on mobile. */
  headline: string;
  /** Secondary explanatory line — surfaces the specific numbers
   *  behind the headline. */
  detail: string;
  /** Higher = surface earlier. Roughly the |surprise| in strokes. */
  severity: number;
}

/** Render a signed delta as "+0.42" / "−0.18" with Unicode minus. */
function fmtDelta(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  const s = x.toFixed(digits);
  return x > 0 ? `+${s}` : s.replace(/^-/, "−");
}

/** Compass-agnostic wind describer — "into a 12 mph wind",
 *  "downwind 8 mph", "cross wind 9 mph". */
function windPhrase(row: HoleRow): string | null {
  if (row.windKind == null) return null;
  const speed = Math.max(Math.abs(row.head ?? 0), row.cross ?? 0);
  if (!Number.isFinite(speed) || speed < 2) return null;
  const mph = Math.round(speed);
  switch (row.windKind) {
    case "into":
      return `into a ${mph} mph wind`;
    case "down":
      return `downwind ${mph} mph`;
    case "cross":
      return `${mph} mph crosswind`;
  }
}

/** yardage direction phrase — "back 22 yds", "up 15 yds", null when
 *  the movement is trivial. */
function yardsPhrase(row: HoleRow): string | null {
  if (typeof row.dYards !== "number") return null;
  if (Math.abs(row.dYards) < 8) return null;
  const y = Math.round(Math.abs(row.dYards));
  return row.dYards > 0 ? `back ${y} yds` : `up ${y} yds`;
}

/** Main entry point. Returns takeaways ranked by severity, capped at
 *  the supplied limit (default 4 — mobile screen real estate). */
export function deriveTakeaways(
  rows: HoleRow[],
  { limit = 4 }: { limit?: number } = {},
): Takeaway[] {
  const found: Takeaway[] = [];

  for (const row of rows) {
    if (row.dScore == null || !Number.isFinite(row.dScore)) continue;

    const expected = expectedSetupDelta(row);
    const surprise = row.dScore - expected;
    const yph = yardsPhrase(row);
    const wph = windPhrase(row);

    // 1. Big positive surprise — setup should have eased but scoring
    //    got worse. "Shorter and downwind but the field played it
    //    harder." Usually pin placement or firm greens.
    if (surprise > 0.18 && row.dScore > 0.1 && expected < -0.02) {
      const setupBits: string[] = [];
      if (yph && row.dYards! < 0) setupBits.push(yph);
      if (wph && row.windKind === "down") setupBits.push(wph);
      found.push({
        kind: "surprise-hard",
        hole: row.hole,
        headline: `Hole ${row.hole} — softer setup, harder scoring`,
        detail: `${setupBits.join(", ") || "Setup was neutral"} — field played it ${fmtDelta(row.dScore)} to par (expected ${fmtDelta(expected)}).`,
        severity: Math.abs(surprise) + 0.05,
      });
      continue;
    }

    // 2. Big negative surprise — setup was tough but scoring came in
    //    easier. Long + into wind but field beat it up. Pin gave a
    //    hand, or players attacked a hole they'd been avoiding.
    if (surprise < -0.18 && row.dScore < -0.1 && expected > 0.02) {
      const setupBits: string[] = [];
      if (yph && row.dYards! > 0) setupBits.push(yph);
      if (wph && row.windKind === "into") setupBits.push(wph);
      found.push({
        kind: "surprise-easy",
        hole: row.hole,
        headline: `Hole ${row.hole} — tougher setup, softer scoring`,
        detail: `${setupBits.join(", ") || "Setup was tough"} — field scored ${fmtDelta(row.dScore)} to par (expected ${fmtDelta(expected)}).`,
        severity: Math.abs(surprise) + 0.05,
      });
      continue;
    }

    // 3. Very quiet setup, loud scoring move — nothing physical
    //    changed but the number did. Highlights pin difficulty as
    //    the driver.
    if (
      Math.abs(row.dYards ?? 0) < 8 &&
      Math.abs(row.head ?? 0) < 3 &&
      (row.cross == null || row.cross < 3) &&
      Math.abs(row.dScore) > 0.22
    ) {
      found.push({
        kind: "quiet-setup-loud-scoring",
        hole: row.hole,
        headline: `Hole ${row.hole} — same setup, different result`,
        detail: `Length and wind unchanged; scoring shifted ${fmtDelta(row.dScore)} vs the other rounds — pin placement doing the work.`,
        severity: Math.abs(row.dScore),
      });
      continue;
    }

    // 4. Loud setup, quiet scoring — hole went way back or into a
    //    strong wind, but the field absorbed it. Worth flagging
    //    because it says the hole has slack to give.
    if (
      Math.abs(expected) > 0.15 &&
      Math.abs(row.dScore) < 0.06
    ) {
      const bits = [yph, wph].filter(Boolean);
      if (bits.length > 0) {
        found.push({
          kind: "loud-setup-quiet-scoring",
          hole: row.hole,
          headline: `Hole ${row.hole} — setup moved, scoring didn't`,
          detail: `${bits.join(", ")} — expected ${fmtDelta(expected)} but field played it ${fmtDelta(row.dScore)}. Setup change didn't bite.`,
          severity: 0.14 + Math.abs(expected) * 0.4,
        });
        continue;
      }
    }

    // 5. Biggest yardage jumps in either direction — surface even
    //    when scoring did what was expected, since the setup itself
    //    is news.
    if (Math.abs(row.dYards ?? 0) >= 25) {
      const bits = [yph, wph].filter(Boolean);
      found.push({
        kind: "yardage-jump",
        hole: row.hole,
        headline: `Hole ${row.hole} — ${row.dYards! > 0 ? "stretched" : "shortened"} ${Math.round(Math.abs(row.dYards!))} yds`,
        detail: `${bits.join(", ")}. Field played it ${fmtDelta(row.dScore)} vs the other rounds.`,
        severity: 0.10 + Math.abs(row.dYards!) * 0.005,
      });
      continue;
    }

    // 6. Big wind hole
    if ((row.head != null && Math.abs(row.head) >= 8) || (row.cross ?? 0) >= 8) {
      const bits = [wph, yph].filter(Boolean);
      found.push({
        kind: "wind-driven",
        hole: row.hole,
        headline: `Hole ${row.hole} — wind is the story`,
        detail: `${bits.join(", ")}. Field played it ${fmtDelta(row.dScore)} to par.`,
        severity: 0.08 + Math.max(Math.abs(row.head ?? 0), row.cross ?? 0) * 0.01,
      });
    }
  }

  found.sort((a, b) => b.severity - a.severity);
  // De-duplicate by hole (a hole shouldn't take two slots; keep the
  // highest-severity classification for that hole).
  const seen = new Set<number>();
  const out: Takeaway[] = [];
  for (const t of found) {
    if (seen.has(t.hole)) continue;
    seen.add(t.hole);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}
