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

const GREEN_IMAGE: Record<number, string> = {
  2: "https://pga-tour-res.cloudinary.com/c_fill,b_rgb:ffffff,w_1600,f_auto,q_auto/tourcastPickle/holes_2026_r_525_883_overhead_green_2_land.png",
  12: "https://pga-tour-res.cloudinary.com/c_fill,b_rgb:ffffff,w_1600,f_auto,q_auto/tourcastPickle/holes_2026_r_525_883_overhead_green_12_land.png",
  18: "https://pga-tour-res.cloudinary.com/c_fill,b_rgb:ffffff,w_1600,f_auto,q_auto/tourcastPickle/holes_2026_r_525_883_overhead_green_18_land.png",
};

interface GreenPin {
  x: number; // 0-1
  y: number; // 0-1
  label: string;
  delta: number; // pp — positive = easier, negative = harder
}

function GreenCard({
  hole,
  pin,
}: {
  hole: number;
  pin: GreenPin;
}) {
  const positive = pin.delta >= 0;
  const dotColor = positive
    ? "oklch(0.55 0.16 155)"
    : "oklch(0.60 0.19 28)";
  const chipBg = positive
    ? "oklch(0.94 0.06 155)"
    : "oklch(0.94 0.07 28)";
  const chipInk = positive
    ? "oklch(0.32 0.13 155)"
    : "oklch(0.38 0.15 28)";
  const img = GREEN_IMAGE[hole];
  if (!img) return null;
  return (
    <figure
      style={{
        margin: 0,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid oklch(0.9 0.008 95)",
        background: "white",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          background: "oklch(0.94 0.008 95)",
          lineHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img}
          alt={`Green at hole ${hole}`}
          style={{ display: "block", width: "100%", height: "auto" }}
          loading="lazy"
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: `${pin.x * 100}%`,
            top: `${pin.y * 100}%`,
            width: 18,
            height: 18,
            marginLeft: -9,
            marginTop: -9,
            borderRadius: "50%",
            background: dotColor,
            border: "2px solid white",
            boxShadow: "0 1px 4px oklch(0 0 0 / 0.3)",
          }}
        />
      </div>
      <figcaption
        style={{
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderTop: "1px solid oklch(0.95 0.008 95)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontFamily: proseFont,
            color: "oklch(0.26 0.04 155)",
          }}
        >
          <b>H{hole}</b> — {pin.label}
        </div>
        <span
          style={{
            fontFamily: numFont,
            fontSize: 12,
            fontWeight: 800,
            padding: "3px 8px",
            borderRadius: 999,
            background: chipBg,
            color: chipInk,
          }}
        >
          {positive ? "+" : ""}
          {pin.delta.toFixed(1)}pp
        </span>
      </figcaption>
    </figure>
  );
}

function GreenCompare({
  hole,
  easy,
  hard,
}: {
  hole: number;
  easy: GreenPin;
  hard: GreenPin;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
        margin: "16px 0 20px",
      }}
    >
      <GreenCard hole={hole} pin={easy} />
      <GreenCard hole={hole} pin={hard} />
    </div>
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
  { hole: 12, position: "front-right", observed: 49.4, expected: 57.4, delta: -7.9, sample: 908 },
  { hole: 18, position: "middle-right", observed: 36.4, expected: 43.0, delta: -6.6, sample: 516 },
  { hole: 13, position: "middle-right", observed: 8.0, expected: 12.3, delta: -4.3, sample: 514 },
  { hole: 17, position: "middle-left", observed: 10.6, expected: 14.3, delta: -3.7, sample: 669 },
  { hole: 2,  position: "back-right", observed: 12.7, expected: 16.3, delta: -3.5, sample: 669 },
  { hole: 1,  position: "front-left", observed: 20.0, expected: 23.1, delta: -3.1, sample: 746 },
];

const EASIER: PinRow[] = [
  { hole: 12, position: "front-center", observed: 64.8, expected: 58.6, delta: 6.1, sample: 528 },
  { hole: 18, position: "front-left", observed: 42.0, expected: 36.1, delta: 5.9, sample: 514 },
  { hole: 2,  position: "back-left", observed: 25.9, expected: 20.3, delta: 5.5, sample: 673 },
  { hole: 12, position: "back-left", observed: 56.8, expected: 53.3, delta: 3.4, sample: 599 },
  { hole: 6,  position: "front-center", observed: 46.8, expected: 43.6, delta: 3.3, sample: 741 },
  { hole: 10, position: "back-left", observed: 24.4, expected: 21.5, delta: 2.9, sample: 509 },
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
          birdie rate = a + b<sub>y</sub>&middot;yards + b<sub>h</sub>&middot;headwind
        </span>
        where <i>headwind</i> is the wind's speed projected onto the
        hole's actual play direction (positive = into the player's
        face on the approach). Each hole's play bearing is the real
        compass direction from fairway landing to green, pulled from
        OpenStreetMap way geometry — so a 15mph south wind is
        correctly identified as a headwind on a hole playing south
        and a tailwind on a hole playing north. Then we ask, for
        every historical pin: <i>did this position birdie more or
        less often than the yardage and directional wind that day
        would predict?</i> That residual is the number worth
        looking at.
      </P>

      <H3>What the coefficients say about the course</H3>
      <P>
        Before we even get to the pins, the model tells us something
        useful about how TPC Twin Cities plays. Directional wind is
        the dominant round-level factor at this course.
      </P>
      <P>
        <b>Hole 6 and hole 12 are the most wind-sensitive on the
        property</b>: each loses about ~4pp of birdie rate for every
        5 mph of headwind on the approach. Hole 18 loses ~3pp per
        5 mph headwind. Yardage still matters: the biggest per-hole
        yardage coefficient (hole 16, &minus;2pp per +10 yards) is
        meaningful but rarely dominant. If you want to bet
        birdie-heavy round scores this week, the wind forecast —
        and specifically <i>which way</i> the wind is coming
        from — is the first thing to read.
      </P>

      <Callout>
        <b>How to read the tables below:</b> "actual vs expected" is
        the pin's real birdie rate over 2019&ndash;2025, next to the
        rate the model would have predicted given the yardage and
        wind on the days it was used. "Δ" is the gap between the
        two, in percentage points. Positive means the pin plays
        easier than conditions explain; negative means harder.
        "Sample" is total putts observed at that position across the
        eight seasons. Pin positions ("front-left", "back-right")
        are described from the player's perspective standing on the
        fairway looking at the green — the fairway direction on each
        hole was derived from where the field's approach shots
        actually came from.
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
        The signal on <b>hole 12 front-right</b> is the most
        statistically solid one on this list — 908 putts of exposure
        across seven pin positions. Twelve is a par-5, so the raw
        49% birdie rate looks fine on the leaderboard; the read
        here is that <i>relative to the other par-5 pins on the
        same green in comparable conditions</i>, this one costs
        the field nearly eight percentage points. <b>Hole 18
        middle-right</b> tells the same story: birdie rate looks
        reasonable in isolation, but sat next to what the yardage
        and directional wind on those days should have produced,
        it's the biggest under-performer on the closing green.
      </P>

      <H3>Pins that play easier than they look</H3>
      <PinList rows={EASIER} label="Plays easier" />
      <P>
        <b>Hole 12</b> has the biggest same-green swing on the
        property: the front-center flag plays +6.1pp <i>above</i>
        expectation and the front-right flag &minus;7.9pp
        <i>below</i> — <b>a 14pp swing in birdie probability</b>
        between two pins a wedge apart on the same par-5 green,
        in comparable conditions.
      </P>
      <GreenCompare
        hole={12}
        easy={{ x: 0.403, y: 0.482, label: "front-center flag", delta: 6.1 }}
        hard={{ x: 0.520, y: 0.684, label: "front-right flag", delta: -7.9 }}
      />
      <div
        style={{
          fontSize: 12,
          fontFamily: proseFont,
          color: "oklch(0.55 0.02 150)",
          margin: "-8px 0 20px",
          textAlign: "center",
        }}
      >
        Two front pins on the twelfth: the centre flag is a birdie
        zone, the right flag isn't.
      </div>
      <P>
        <b>Hole 18</b> tells the same story on the closing green:
        front-left flag +5.9pp, middle-right flag &minus;6.6pp —
        a 12pp swing between two pins on 18. The effect is real
        even though H18 itself is only moderately wind-sensitive
        once you use the actual play direction; some pins on
        that green are just genuinely harder than the yardage
        would predict.
      </P>
      <GreenCompare
        hole={18}
        easy={{ x: 0.497, y: 0.156, label: "front-left flag", delta: 5.9 }}
        hard={{ x: 0.406, y: 0.583, label: "middle-right flag", delta: -6.6 }}
      />
      <div
        style={{
          fontSize: 12,
          fontFamily: proseFont,
          color: "oklch(0.55 0.02 150)",
          margin: "-8px 0 20px",
          textAlign: "center",
        }}
      >
        On the closing hole, two flags on the same green produce a
        ~12pp swing in birdie probability after conditions —
        front-left is a green light, middle-right isn't.
      </div>
      <P>
        <b>Hole 2</b> is a smaller-scale example of the same
        pattern: the back-left flag plays +5.5pp above expectation,
        the back-right &minus;3.5pp below. A 9pp swing between
        two flags on the back shelf of the same green — a real
        edge, if smaller than 12 or 18.
      </P>
      <GreenCompare
        hole={2}
        easy={{ x: 0.569, y: 0.449, label: "back-left flag", delta: 5.5 }}
        hard={{ x: 0.581, y: 0.725, label: "back-right flag", delta: -3.5 }}
      />
      <div
        style={{
          fontSize: 12,
          fontFamily: proseFont,
          color: "oklch(0.55 0.02 150)",
          margin: "-8px 0 20px",
          textAlign: "center",
        }}
      >
        Both on the back of the second green — the left side is a
        green light, the right side a trap.
      </div>

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
          Hole 12 front-center flag → lean birdie-heavy
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 12 front-right flag → fade eagle/birdie parlays
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 18 front-left flag → real birdie chance
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 18 middle-right flag → treat as bogey-neutral
        </li>
        <li style={{ marginBottom: 6 }}>
          Hole 2 back-left → soft; back-right → hard
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

      <H3>Round 1 read — the Thursday setup</H3>
      <P>
        The R1 pin sheet dropped Wednesday afternoon, and the
        Thursday forecast is a <b>steady southerly, 5-7 mph all
        day</b>. Plugged into the same regression above, here's
        what today's set-up says vs. a typical R1 at TPC Twin
        Cities.
      </P>

      <H3>Playing easier today</H3>
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
          <b>H12 (par-5) — the day's biggest edge, ~+8pp above
          normal.</b> The R1 flag sits on the back-left cluster
          (+5.5pp on its historical record), and the south wind is a
          strong tailwind on 12 — every 5 mph of tailwind lifts
          birdie rate ~+4pp on this hole. Both effects stack.
        </li>
        <li style={{ marginBottom: 6 }}>
          <b>H5 (par-4) — ~+5pp above normal.</b> Today's flag lands
          on a smaller-sample cluster the regression rates as
          consistently over-performing (~+6pp intrinsic). Wind is
          essentially crosswind on the approach, so this is a
          pin-driven edge.
        </li>
        <li style={{ marginBottom: 6 }}>
          <b>H15 (par-4) — ~+4pp above normal.</b> The tee shot runs
          nearly due-north, which turns today's south wind into a
          straight tailwind off the tee — the hole plays shorter.
          Neutral pin, but the wind boost is real.
        </li>
        <li style={{ marginBottom: 6 }}>
          <b>H2 and H18 — mild + (each ~+2pp).</b> Strong tailwinds
          on long holes, roughly neutral pins.
        </li>
      </ul>

      <H3>Playing harder today</H3>
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
          <b>H16 — the day's biggest defensive setup.</b> Back tee
          at 411 yards + south wind is a direct headwind on the
          approach. Neutral pin, but the yardage-and-wind stack
          alone puts the hole ~6&ndash;8pp harder than a typical
          R1. (The regression's raw estimate is bigger than that
          but is inflated by anomalous drivable-hole setups in the
          historical record.)
        </li>
        <li style={{ marginBottom: 6 }}>
          <b>H7 — ~−4pp below normal.</b> South wind hits the
          approach directly, and H7 is one of the property's most
          yardage-sensitive holes.
        </li>
        <li style={{ marginBottom: 6 }}>
          <b>H6 — ~−3pp below normal.</b> The R1 pin sits on a
          smaller-sample cluster with a mildly negative residual,
          and the tailwind bonus isn't enough to flip it. Not the
          par-5 birdie opportunity it looks like on the leaderboard.
        </li>
        <li style={{ marginBottom: 6 }}>
          <b>H13 — ~−5pp below normal.</b> This is the article's
          flagged middle-right harder pin (&minus;4.3pp intrinsic),
          plus today's south wind hits the tee shot as a moderate
          headwind. Both effects stack. Solid <b>fade the birdie
          sweat here</b>.
        </li>
      </ul>

      <P>
        <b>Net-net across the round:</b> once H13's flagged harder
        pin is factored in, the easier and defensive holes roughly
        cancel. Sum of the per-hole birdie-rate deltas comes in
        near zero — the four eased holes lift ~+21pp and the four
        defensive ones drag ~−21pp, so today's setup is basically
        <b>a neutral R1 relative to the historical average</b>
        rather than a round-wide easy day.
      </P>
      <P>
        That <i>doesn't</i> mean the flagged holes don't matter.
        The <b>H12 birdie edge</b> (+~8pp) and the <b>H13 + H16
        defensiveness</b> (~−5 and ~−8pp respectively, after
        correcting H16 down for the drivable-hole distortion in the
        historical baseline) are the strongest single-hole signals
        of the day — worth playing on their own even when the
        round-total is roughly a coin flip. Player-specific
        matchups on those four holes are where the real edge sits.
      </P>
      <P>
        One caveat: the H16 penalty above is the model's raw
        output — a more honest estimate, stripping the anomalous
        drivable-hole setups from the yardage baseline, is closer
        to −6 to −8pp harder than normal.
      </P>

      <H3>The limits</H3>
      <P>
        Six years is a shortish sample. Each pin cluster has
        somewhere between 300 and 900 putts of exposure — enough
        to move a betting decision, not enough to be a
        season-defining edge. The model treats wind as a round
        average (speed and direction), which flatters the
        coefficients on gusty days when the wind veers. It doesn't
        know about pin proximity to hazards, green speed, or
        firmness. And it can't yet see 2026: this year's yardage
        and weather aren't in the archive until the tournament book
        publishes, so the residuals above are locked to
        2019&ndash;2025 data.
      </P>
      <P>
        Each round's wind is projected onto the hole's real compass
        bearing (pulled from OpenStreetMap way geometry — the
        approach-leg direction on par-4s, the fairway-to-green
        direction on par-5s). One bearing per hole is a
        simplification of what a second-shot decision on a par-5
        actually looks like, and public-data bearings are
        approximate on the doglegs — so treat any single residual
        as a &pm;2pp estimate rather than a point value.
      </P>
      <P>
        Treat it as a tiebreaker between two flags you're already
        pricing, not a system on its own. But when the pin sheet
        shows H12 front-center or H18 front-left on any morning,
        that's a nudge worth taking.
      </P>
    </div>
  );
}
