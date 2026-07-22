/**
 * Article: "Where the birdies live: reading the 3M Open's pin patterns"
 * Published 2026-07-22, week of the 3M Open.
 *
 * Sourced from scripts/analyze-pin-difficulty.py, run against
 * eight seasons of pin-birdie history (2019-2026) plus per-round
 * yardage + wind pulled from the historical archive.
 *
 * Copy rule: no third-party data-source names on user surfaces.
 * "Tour shot-tracking data", "the historical record" — not vendor names.
 */

import Link from "next/link";

const proseFont =
  "var(--font-archivo), 'Archivo', system-ui, sans-serif";
const numFont = "'IBM Plex Mono', ui-monospace, monospace";

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 15,
        lineHeight: 1.65,
        color: "oklch(0.26 0.04 155)",
        margin: "0 0 16px",
        fontFamily: proseFont,
      }}
    >
      {children}
    </p>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 18,
        margin: "28px 0 12px",
        fontFamily: proseFont,
        letterSpacing: -0.005,
      }}
    >
      {children}
    </h3>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <aside
      style={{
        padding: "12px 14px",
        margin: "20px 0",
        background: "oklch(0.96 0.02 155)",
        borderLeft: "3px solid oklch(0.50 0.13 155)",
        borderRadius: 6,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: "oklch(0.30 0.04 155)",
        fontFamily: proseFont,
      }}
    >
      {children}
    </aside>
  );
}

interface PinRow {
  hole: number;
  position: string;
  observed: number; // birdie %
  expected: number; // birdie %
  delta: number;    // percentage points
  sample: number;   // putts
}

const HARDER: PinRow[] = [
  { hole: 18, position: "upper-right", observed: 41.4, expected: 47.7, delta: -6.2, sample: 152 },
  { hole: 2,  position: "lower-right", observed: 12.7, expected: 18.2, delta: -5.5, sample: 669 },
  { hole: 12, position: "lower-center", observed: 49.4, expected: 54.9, delta: -5.4, sample: 908 },
  { hole: 17, position: "upper-center", observed: 10.6, expected: 14.3, delta: -3.7, sample: 669 },
  { hole: 10, position: "lower-center", observed: 21.0, expected: 24.6, delta: -3.6, sample: 309 },
  { hole: 13, position: "lower-center", observed: 8.0, expected: 11.2, delta: -3.2, sample: 514 },
];

const EASIER: PinRow[] = [
  { hole: 12, position: "middle-left", observed: 64.8, expected: 56.0, delta: 8.8, sample: 528 },
  { hole: 2,  position: "middle-right", observed: 25.9, expected: 17.7, delta: 8.1, sample: 673 },
  { hole: 18, position: "upper-center", observed: 42.0, expected: 37.3, delta: 4.7, sample: 514 },
  { hole: 10, position: "upper-right", observed: 24.4, expected: 20.7, delta: 3.7, sample: 509 },
  { hole: 9,  position: "upper-left", observed: 13.5, expected: 10.3, delta: 3.2, sample: 594 },
];

function PinRowRender({ p }: { p: PinRow }) {
  const positive = p.delta >= 0;
  const color = positive
    ? "oklch(0.50 0.13 155)"
    : "oklch(0.57 0.19 28)";
  return (
    <li
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid oklch(0.92 0.008 95)",
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontFamily: proseFont,
          fontWeight: 600,
        }}
      >
        H{p.hole} — {p.position}
      </span>
      <span
        style={{
          fontFamily: numFont,
          fontSize: 12,
          color: "oklch(0.45 0.02 150)",
          minWidth: 96,
          textAlign: "right",
        }}
      >
        {p.observed.toFixed(1)}% vs {p.expected.toFixed(1)}%
      </span>
      <span
        style={{
          fontFamily: numFont,
          fontSize: 13,
          color,
          fontWeight: 700,
          minWidth: 58,
          textAlign: "right",
        }}
      >
        {positive ? "+" : ""}
        {p.delta.toFixed(1)}pp
      </span>
      <span
        style={{
          fontFamily: numFont,
          fontSize: 11,
          color: "oklch(0.55 0.02 150)",
          minWidth: 70,
          textAlign: "right",
        }}
      >
        {p.sample.toLocaleString()} putts
      </span>
    </li>
  );
}

function PinList({ rows, label }: { rows: PinRow[]; label: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 11,
          fontFamily: proseFont,
          color: "oklch(0.55 0.02 150)",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 800,
          padding: "0 0 6px",
          borderBottom: "2px solid oklch(0.26 0.04 155)",
        }}
      >
        <span>{label}</span>
        <span style={{ display: "flex", gap: 10 }}>
          <span style={{ minWidth: 96, textAlign: "right" }}>
            actual vs expected
          </span>
          <span style={{ minWidth: 58, textAlign: "right" }}>Δ</span>
          <span style={{ minWidth: 70, textAlign: "right" }}>sample</span>
        </span>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <PinRowRender key={`${r.hole}-${r.position}`} p={r} />
        ))}
      </ul>
    </div>
  );
}

export default function ArticlePinDifficulty() {
  return (
    <div>
      <P>
        The pin sheet at TPC Twin Cities changes every day, but the
        set of positions the tournament uses barely does. Cross-reference
        eight years of pin coordinates and you find the same six or
        seven spots on each green come around again and again. That
        stability is a gift: it lets us ask whether a specific pin
        location plays consistently harder or easier than its raw
        birdie rate suggests — once you strip out the round it was
        used in.
      </P>

      <H3>Why raw birdie rates lie</H3>
      <P>
        Two identical pins can produce very different birdie numbers
        for reasons that have nothing to do with the pin. Wind on a
        Thursday morning can wipe half a stroke off a par-3. A
        forward-tee setup on a Saturday can turn a 305-yard par-4
        into a wedge fest. If a particular pin position happened to
        get used mostly in easy conditions, it looks easier than it
        is; if it landed mostly on brutal days, it looks harder.
      </P>
      <P>
        So we fit a model per hole:
        <span
          style={{
            display: "block",
            margin: "10px 0",
            padding: "8px 12px",
            background: "oklch(0.96 0.005 95)",
            borderRadius: 6,
            fontFamily: numFont,
            fontSize: 13,
            color: "oklch(0.28 0.04 155)",
          }}
        >
          birdie rate = a + b · yardage + c · wind
        </span>
        and asked, for every historical pin: <i>did this position
        birdie more or less often than the yardage and wind that
        day would predict?</i> That residual is the number worth
        looking at.
      </P>

      <H3>What the coefficients say about the course</H3>
      <P>
        Before we even get to the pins, the model tells us something
        useful about how TPC Twin Cities plays. Wind is by far the
        dominant round-level factor.
      </P>
      <P>
        The eighteenth is the most wind-sensitive hole on the
        property: <b>every extra 5 mph strips ~12 percentage points
        off its birdie rate</b>. Holes 6, 7, 8 and 16 all lose
        7&ndash;9pp per 5 mph. Length matters less than you might
        guess — the biggest per-hole yardage coefficient (hole 16,
        &minus;4pp per +10 yards) is meaningful but not
        overwhelming. If you want to bet birdie-heavy round scores
        this week, the wind forecast is the first thing to read.
      </P>

      <Callout>
        <b>How to read the tables below:</b> "actual vs expected" is
        the pin's real birdie rate over 2019&ndash;2025, next to the
        rate the model would have predicted given the yardage and
        wind on the days it was used. "Δ" is the gap between the
        two, in percentage points. Positive means the pin plays
        easier than conditions explain; negative means harder.
        "Sample" is total putts observed at that position across the
        eight seasons.
      </Callout>

      <H3>Pins that play harder than they look</H3>
      <P>
        These are positions where the field has under-performed
        even after accounting for length and wind. If you see one
        of these on Thursday's sheet, birdie sweats are worse
        propositions than the yardage would suggest.
      </P>
      <PinList rows={HARDER} label="Plays harder" />
      <P>
        The signal on <b>hole 12 lower-center</b> is the most
        statistically solid one on this list — 908 putts of exposure
        across seven pin positions. Twelve is a par-5, so the raw
        49% birdie rate looks fine on the leaderboard; the read
        here is that <i>relative to the other par-5 pins on the
        same green</i>, this one costs the field roughly five
        percentage points. Same logic on <b>hole 18
        upper-right</b>: it's the flag on the closing green that
        pulls the shot closest to the water short-right, and the
        field over-corrects into the fringe long-left.
      </P>

      <H3>Pins that play easier than they look</H3>
      <PinList rows={EASIER} label="Plays easier" />
      <P>
        <b>Hole 12 middle-left</b> is the clearest positive
        signal on the course. Combined with the lower-center flag
        being 5.4pp harder than expected, that's a <b>~15
        percentage-point swing in birdie probability between
        these two pins on the same green</b>, in the same
        conditions. When the pin sheet lands, that's the first
        thing worth checking on 12.
      </P>
      <P>
        <b>Hole 2 middle-right</b> and <b>hole 2 lower-right</b>
        tell the same story in miniature: pins that look
        superficially similar on the map produce a 14pp swing
        after conditions. The green tilts front-to-back and
        away from the middle-right shelf; the lower-right flag
        pulls the ball into the false-front runoff.
      </P>
      <P>
        <b>Hole 18 upper-center</b> is the flag you want to see
        for a birdie sweat on 18 — 4.7pp easier than expected,
        which is meaningful in a hole this wind-sensitive. On a
        calm Sunday with the flag there, closers get a real
        chance.
      </P>

      <H3>How to actually use this</H3>
      <P>
        When the tournament's daily pin sheet drops, spot-check the
        holes above. The strongest edges are:
      </P>
      <ul
        style={{
          fontSize: 15,
          lineHeight: 1.65,
          color: "oklch(0.26 0.04 155)",
          fontFamily: proseFont,
          margin: "0 0 16px 20px",
          padding: 0,
        }}
      >
        <li style={{ marginBottom: 6 }}>
          Hole 12 middle-left flag → lean birdie-heavy
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 12 lower-center flag → fade eagle/birdie parlays
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 18 upper-center flag, calm forecast → real birdie chance
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 18 upper-right flag, any wind → treat as bogey-neutral
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 2 middle-right → soft; lower-right → hard
        </li>
      </ul>
      <P>
        For everything else, the{" "}
        <Link
          href="/analysis/course-heatmap"
          style={{ color: "oklch(0.50 0.13 155)", fontWeight: 700 }}
        >
          course heat-map
        </Link>{" "}
        surface has the full pin-by-pin picture, filterable by
        year and by round.
      </P>

      <H3>The limits</H3>
      <P>
        Six years is a shortish sample. Each pin cluster has
        somewhere between 70 and 900 putts of exposure — enough to
        move a betting decision, not enough to be a season-defining
        edge. The model treats wind as a round average, which flatters
        the coefficients on gusty days. It doesn't know about pin
        proximity to hazards, green speed, or firmness. And it
        can't yet see 2026: this year's yardage and weather aren't
        in the archive until the tournament book publishes, so the
        residuals above are locked to 2019&ndash;2025 data.
      </P>
      <P>
        Treat it as a tiebreaker between two flags you're already
        pricing, not a system on its own. But when the pin sheet
        shows H12 middle-left in a calm Thursday morning wave —
        that's a nudge worth taking.
      </P>
    </div>
  );
}
