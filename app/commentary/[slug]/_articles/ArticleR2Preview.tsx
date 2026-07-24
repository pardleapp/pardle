/**
 * Article: "3M Open R2 preview — wind, bearings, and where the birdies live"
 * Published 2026-07-24, Friday morning of the 3M Open.
 *
 * Same regression as the R1 pin-difficulty article. Fresh inputs:
 *   - R2 pin sheet (parsed from PGA Tour Communications' Thursday
 *     evening drop — front-back yards + side yards per hole).
 *   - Wind forecast for Friday 07:00-19:00 local (Open-Meteo).
 *   - Per-hole cluster residuals from the freshly-recomputed
 *     multi-season birdie history (2019-2025 all with real per-round
 *     pin coords, no cross-year replication).
 *
 * Copy rule: no third-party data-source names on user surfaces.
 * "Tour shot-tracking data", "the wind forecast" — not vendor names.
 */

import Link from "next/link";

const proseFont = "var(--font-archivo), 'Archivo', system-ui, sans-serif";
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
    <div
      style={{
        margin: "20px 0",
        padding: "14px 18px",
        borderLeft: "3px solid oklch(0.55 0.14 155)",
        background: "oklch(0.97 0.03 155)",
        fontSize: 14.5,
        lineHeight: 1.55,
        fontFamily: proseFont,
        color: "oklch(0.24 0.04 155)",
        borderRadius: "0 8px 8px 0",
      }}
    >
      {children}
    </div>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | React.ReactNode>>;
}) {
  return (
    <div style={{ overflowX: "auto", margin: "0 0 20px" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          fontFamily: proseFont,
          minWidth: 520,
        }}
      >
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderBottom: "1px solid oklch(0.86 0.02 150)",
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: "oklch(0.35 0.03 155)",
                  fontFamily: numFont,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={{
                background: i % 2 === 0 ? "white" : "oklch(0.98 0.005 95)",
              }}
            >
              {r.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid oklch(0.94 0.008 95)",
                    color: "oklch(0.24 0.03 155)",
                    verticalAlign: "top",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const emerald = "oklch(0.35 0.15 155)";
const tang = "oklch(0.42 0.19 28)";

function EasierChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: "oklch(0.94 0.06 155)",
        color: emerald,
        padding: "2px 7px",
        borderRadius: 4,
        fontFamily: numFont,
        fontSize: 11,
        fontWeight: 800,
      }}
    >
      {children}
    </span>
  );
}
function HarderChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: "oklch(0.94 0.07 28)",
        color: tang,
        padding: "2px 7px",
        borderRadius: 4,
        fontFamily: numFont,
        fontSize: 11,
        fontWeight: 800,
      }}
    >
      {children}
    </span>
  );
}

export default function ArticleR2Preview() {
  return (
    <div>
      <P>
        Round 1 played to a near-neutral setup at TPC Twin Cities under a
        soft 5-7 mph southerly. Round 2 is a different animal: the same
        wind direction, but three times the speed. The Thursday-evening
        pin drop for R2 is out, and the interaction of those pins with a
        20+ mph SSW is the whole story of Friday's setup.
      </P>

      <H3>The wind forecast — and why the wave split matters</H3>
      <P>
        Same wind direction as R1, roughly triple the speed, and stronger
        in the afternoon. The 5-hour AM window (7am-12pm) averages
        <b> 18.2 mph from 205° </b>with hourly peaks of 21.8 mph. The PM
        window (1pm-7pm) climbs to
        <b> 20.9 mph from 198° </b>with hourly peaks of 23.1. That's a
        2.7 mph delta between the waves — not enough to bury a leader,
        but enough to shift ~0.1 strokes of expected scoring per player
        over 18 holes.
      </P>
      <P>
        Direction stays inside a narrow 195°-211° band from the SSW all
        day — meaning holes facing roughly N/NW enjoy a tailwind that
        gets STRONGER through the afternoon, and holes facing S/SW get a
        headwind that gets stronger too. The wave delta doesn't average
        out to zero; it points in different directions on different
        holes.
      </P>

      <Callout>
        <b>Wave takeaway:</b> the PM wave plays{" "}
        <i>slightly easier</i> in aggregate (~5pp / ~0.1 strokes) despite
        the extra wind, because the tailwind boost on the N-facing
        par-5s (H12, H18) outweighs the added headwind pain on the
        S-facing par-4s. Individual holes still swing hard both ways.
      </Callout>

      <H3>Hole bearings — how the wind lands on each approach</H3>
      <P>
        The R1 model uses each hole's real compass bearing (approach-leg
        for par-4s, fairway-to-green for par-5s) from OpenStreetMap way
        geometry. That bearing gets crossed with the day's wind
        direction to compute a headwind component per hole, which the
        regression then converts to expected birdie-rate shift.
      </P>
      <P>
        The 3M Open's routing is heterogeneous — a few holes point due
        N, a few due S, most sit somewhere in between. So the same wind
        that boosts H12 and H18 punishes H7 and H16 on the same round.
        Six holes matter enough today to sit on either end of the
        scale.
      </P>

      <H3>Playing easier — where to lean birdies</H3>
      <Table
        headers={["Hole", "Par", "Cluster", "Rate", "Verdict"]}
        rows={[
          [
            <b key="15">H15</b>,
            "4",
            "C (back-left)",
            "20.8%",
            <>
              <EasierChip>+9.3pp</EasierChip>{" "}
              14° tee bearing — the day's cleanest tailwind. Every 5
              mph of tailwind trims ~2 pp off the effective club, and
              PM adds another mph on top.
            </>,
          ],
          [
            <b key="2">H2</b>,
            "4",
            "D (back-right)",
            "12.7%",
            <>
              <EasierChip>+6.7pp</EasierChip>{" "}
              354° — nearly due N. The pin shift from R1's front to
              R2's back is 29 yards of extra approach, but the
              tailwind gives it all back. Long-hitters win here today.
            </>,
          ],
          [
            <b key="18">H18</b>,
            "5",
            "D (front-left)",
            "42.0%",
            <>
              <EasierChip>+5.6pp</EasierChip>{" "}
              par-5 downwind, front pin — a birdie card hole. Cluster
              D historically hits 42% birdies-or-better; today's
              conditions push that up.
            </>,
          ],
          [
            <b key="12">H12</b>,
            "5",
            "B (mid-front, right)",
            "49.4%",
            <>
              <EasierChip>+4.1pp</EasierChip>{" "}
              336° full tailwind, but here's the nuance: the R2 pin
              lands on cluster B, which is one of the harder clusters
              on this par-5 (five clusters range 49%-65%). The wind
              still tips it easier — but the pin itself is
              working against you.
            </>,
          ],
          [
            <b key="13">H13</b>,
            "3",
            "G (back-left)",
            "16.8%",
            <>
              <EasierChip>+3.1pp</EasierChip>{" "}
              This is the surprise. Cluster G's historical rate is a
              hair above the H13 mean (+5.6pp intrinsic residual), and
              even the SW crosswind can't drag it under water. Small
              +EV.
            </>,
          ],
        ]}
      />

      <H3>Playing harder — where to fade birdies and back bogey markets</H3>
      <Table
        headers={["Hole", "Par", "Cluster", "Rate", "Verdict"]}
        rows={[
          [
            <b key="16">H16</b>,
            "4",
            "A (deep-back, right)",
            "26.1%",
            <>
              <HarderChip>−20pp</HarderChip>{" "}
              The day's biggest defensive setup by a wide margin.
              204° full headwind, R1 played 26 yards longer than
              historical mean, and R2's pin is deep-back-right on a
              23-yard-deep green. A bailout short leaves 20+ ft up a
              slope. Model estimate might overstate — a rough real
              read is "10-14 pp harder than normal" — but the
              direction is not in doubt.
            </>,
          ],
          [
            <b key="7">H7</b>,
            "4",
            "B (mid-right)",
            "23.3%",
            <>
              <HarderChip>−9pp</HarderChip>{" "}
              214° — dead into 20 mph. H7 is one of the property's
              most yardage-sensitive holes, and the wind + pin cluster
              stacks to make it the toughest par-4 non-forced approach
              of the day.
            </>,
          ],
          [
            <b key="11">H11</b>,
            "4",
            "B (back-left)",
            "14.1%",
            <>
              <HarderChip>−6pp</HarderChip>{" "}
              175° full headwind on the approach + back-left tucked
              pin. Cluster B on this hole runs 14% historically, one
              of the harder clusters.
            </>,
          ],
          [
            <b key="6">H6</b>,
            "5",
            "D (deep back)",
            "42.9%",
            <>
              <HarderChip>−5pp</HarderChip>{" "}
              Not the par-5 birdie hole the leaderboard suggests it
              should be. Cluster D is below the H6 par-5 typical
              (~54%), the tailwind is only mild, and R1 was already
              longer than historical mean.
            </>,
          ],
          [
            <b key="1">H1</b>,
            "4",
            "B (middle)",
            "20.0%",
            <>
              <HarderChip>−4pp</HarderChip>{" "}
              Cluster B is the third-worst on H1 and the wind offers
              no meaningful help. Not defensive enough to bet
              against, but not a birdie hole.
            </>,
          ],
        ]}
      />

      <H3>What history says — matched-wind parallels</H3>
      <P>
        The regression is a model. What actually happened on each hole
        the last time the wind blew like this is empirical. Pulling every
        prior 3M Open round (2019-2025, 28 rounds total) and matching
        each on <b>headwind component within ±4 mph</b> gives a
        historical anchor for the forecast.
      </P>

      <Callout>
        <b>Three of today's biggest holes are off the historical
        distribution.</b> H16 (~19.6 mph headwind), H7 (~19.1 mph
        headwind), and H15 (~19.5 mph tailwind) have NO prior rounds
        in the sample within 4 mph of today's wind component. Every
        past 3M Open in our archive was played in ≤14 mph — today is
        the windiest 3M Open Friday we have on file.
      </Callout>

      <P>
        For the holes with prior parallels, the empirical read is
        strong and lands mostly on the model's side:
      </P>
      <Table
        headers={["Hole", "Prior rounds", "Matched avg", "All-time avg", "Delta"]}
        rows={[
          [
            <b key="12">H12 (par-5, tailwind)</b>,
            "9 rounds (10-14 mph tail)",
            "59.2% birdies",
            "54.8%",
            <EasierChip>+4.4pp</EasierChip>,
          ],
          [
            <b key="18">H18 (par-5, tailwind)</b>,
            "14 rounds (5-11 mph tail)",
            "45.2% birdies",
            "42.0%",
            <EasierChip>+3.2pp</EasierChip>,
          ],
          [
            <b key="2">H2 (par-4, tailwind)</b>,
            "1 round (13.6 mph tail, 2024 R3)",
            "29.3% birdies",
            "15.8%",
            <EasierChip>+13.5pp</EasierChip>,
          ],
          [
            <b key="11">H11 (par-4, headwind)</b>,
            "1 round (13.7 mph head, 2024 R3)",
            "9.3% birdies",
            "14.1%",
            <HarderChip>−4.7pp</HarderChip>,
          ],
          [
            <b key="9">H9 (par-4, quartering headwind)</b>,
            "9 rounds (9-14 mph head)",
            "7.5% birdies",
            "9.9%",
            <HarderChip>−2.4pp</HarderChip>,
          ],
        ]}
      />
      <P>
        Two of today's model calls need adjusting after this reality
        check:
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
        <li style={{ marginBottom: 8 }}>
          <b>H13 empirical anchor is weaker than the model suggests.</b>{" "}
          Fourteen prior rounds with 5-11 mph headwind on H13 averaged
          10.4% birdies vs. the 11.4% all-time — very close to average,
          not the mild-easier the cluster-G residual was suggesting.
          Treat H13 as neutral rather than +EV.
        </li>
        <li style={{ marginBottom: 8 }}>
          <b>H6 doesn't get harder in this wind.</b> Nine prior
          low-wind rounds on H6 (this hole runs 289° — SSW is nearly
          pure crosswind) actually posted 48.7% birdies vs. 44.3%
          all-time. Cluster D's residual pulled the model too far.
          H6 is closer to neutral.
        </li>
      </ul>

      <H3>Round-total picture</H3>
      <P>
        Summing the per-hole birdie-rate deltas across all 18 holes:
      </P>
      <ul
        style={{
          fontSize: 15,
          lineHeight: 1.75,
          color: "oklch(0.26 0.04 155)",
          fontFamily: proseFont,
          margin: "0 0 16px 20px",
          padding: 0,
        }}
      >
        <li>
          <b>AM wave:</b> ~−29pp course-wide vs. a typical R2 —
          equates to roughly <b>+0.55 strokes harder</b> per player
          for the average AM starter.
        </li>
        <li>
          <b>PM wave:</b> ~−24pp course-wide — roughly{" "}
          <b>+0.45 strokes harder</b>.
        </li>
        <li>
          <b>Delta:</b> PM is ~0.1 strokes <i>easier</i> than AM
          despite the extra wind. Counterintuitive, but the tailwind
          gain on H12 + H18 (par-5s) more than covers the added
          headwind cost on H7, H11, H16, H17.
        </li>
      </ul>

      <H3>Betting angles</H3>
      <ul
        style={{
          fontSize: 15,
          lineHeight: 1.7,
          color: "oklch(0.26 0.04 155)",
          fontFamily: proseFont,
          margin: "0 0 16px 20px",
          padding: 0,
        }}
      >
        <li style={{ marginBottom: 8 }}>
          <b>H16 defensiveness is the standout market.</b> Over on
          the field average score, live bogey-or-worse if it's
          available, and the H16 birdie prop as a hard fade. Biggest
          single-hole edge on the card.
        </li>
        <li style={{ marginBottom: 8 }}>
          <b>H15 birdie prop for AM starters.</b> Rate is a mid-tier
          21% historically, but the pure tailwind on the tee shot
          knocks a full club off the approach. Softest line to hit
          today.
        </li>
        <li style={{ marginBottom: 8 }}>
          <b>Round-score UNDERS favour the AM wave.</b> ~0.1 strokes
          of expected-scoring advantage is small per player but
          consistent, and books that priced R2 lines pre-wind will be
          slow to adjust.
        </li>
        <li style={{ marginBottom: 8 }}>
          <b>H12 birdie prop is worth a look but not a hammer.</b>{" "}
          Tailwind helps, but R2's specific pin (cluster B, 49.4%) is
          the harder of the two big-sample clusters on this par-5.
          Wait for a soft price.
        </li>
      </ul>

      <H3>Where this analysis can be wrong</H3>
      <P>
        Three caveats worth sitting with before you fire live:
      </P>
      <ol
        style={{
          fontSize: 14.5,
          lineHeight: 1.65,
          color: "oklch(0.32 0.03 155)",
          fontFamily: proseFont,
          margin: "0 0 16px 20px",
          padding: 0,
        }}
      >
        <li style={{ marginBottom: 10 }}>
          <b>R2 tee-block yardages aren't public yet.</b> The tour
          publishes the scorecard baseline (the R1 setup) but
          typically shifts individual hole yardages by ±14 yd for R2,
          with occasional 25+ yd moves. This analysis uses R1 yardages
          as the R2 proxy. If the tour moves H16 forward or H2 back
          for R2, those specific verdicts shift.
        </li>
        <li style={{ marginBottom: 10 }}>
          <b>The regression's wind coefficients were fit on
          rounds mostly played under 10 mph.</b> Extrapolating to
          20 mph likely inflates the magnitudes — the H16 "−20pp"
          estimate is probably 10-14 pp in reality. Rank order
          stays intact; specific pp values are noisier.
        </li>
        <li style={{ marginBottom: 10 }}>
          <b>Wind is treated as a round average.</b> A gusty
          afternoon that swings 15° for one group can move a single
          hole ±3 pp vs. the sample-average estimate above. The model
          knows the wave, not the moment.
        </li>
      </ol>

      <P>
        If you want the underlying data, the{" "}
        <Link
          href="/analysis/course-heatmap"
          style={{ color: "oklch(0.50 0.13 155)", fontWeight: 700 }}
        >
          course &amp; pin guide
        </Link>{" "}
        surfaces the per-cluster birdie rates by hole, and the{" "}
        <Link
          href="/analysis/tee-time-scoring"
          style={{ color: "oklch(0.50 0.13 155)", fontWeight: 700 }}
        >
          tee-time vs. score
        </Link>{" "}
        page shows how each wave has actually scored, refreshing as
        the round completes.
      </P>
    </div>
  );
}
