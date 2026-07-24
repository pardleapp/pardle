/**
 * Article: "3M Open R2: what the field averages today."
 *
 * The intro sets up what we're predicting (R2 field scoring average)
 * and how (per-hole WLS regression on avg-vs-par against yardage and
 * headwind, weighted by pin sample size, calibrated against
 * yesterday's actual scoring). Softness — the -0.74 stroke residual
 * that fell out of R1 — is the colour, not the lead: it flavours the
 * central estimate and the caveats but the article opens by naming
 * the question.
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
    <div
      className="article-table-wrap"
      style={{
        overflowX: "auto",
        margin: "0 0 20px",
        maxWidth: "100%",
        minWidth: 0,
        WebkitOverflowScrolling: "touch",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          fontFamily: proseFont,
          minWidth: 460,
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

export default function ArticleR2ScoringForecast() {
  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      <P>
        The question this article asks is a simple one: what will the
        field average at TPC Twin Cities today? Not the leaders — the
        field. Round-total scoring is the number every other market
        prices around. Round-score UNDERs, cut-line specials,
        head-to-heads, matchup props: they all hinge on where the
        median score lands. If we can put a number on that today, we
        can price everything else against it.
      </P>
      <P>
        Method, in three sentences. For every pin position ever used
        at this event we have the field-average strokes vs par at that
        spot. We fit a per-hole regression against yardage and
        headwind (the wind component blowing into the hole) using
        every historical round in the sample, then apply it to today's
        R2 conditions to get a per-hole shift vs a typical R2. And
        because yesterday just happened, we can back-test the same
        model against R1 — the gap between what the model expected
        and what the field actually shot tells us how the course is
        playing this week, independent of wind and pins.
      </P>

      <H3>The historical R2 baseline</H3>
      <P>
        Field-average scores for R2 of every 3M Open in the archive:
      </P>
      <Table
        headers={["Year", "Field avg", "vs par", "Wind"]}
        rows={[
          ["2019", "70.44", "−0.56", "9 mph N/NE"],
          ["2020", "71.73", "+0.73", "13 mph S"],
          ["2021", "71.56", "+0.56", "11 mph SSW"],
          ["2022", "72.33", "+1.33", "12 mph W"],
          ["2023", "70.31", "−0.69", "11 mph NE"],
          ["2024", "72.05", "+1.05", "13 mph SSE"],
          ["2025", "70.12", "−0.88", "6 mph SE"],
          [
            <b key="mean">Mean</b>,
            <b key="meanv">71.22</b>,
            <b key="meanp">+0.22</b>,
            <b key="meanw">11 mph</b>,
          ],
        ]}
      />
      <P>
        A one-and-a-quarter stroke swing between the softest and
        stickiest R2s, and the pattern is clean — under 10 mph the
        field averages around 70.3; over 12 mph it averages around
        72.0. Wind speed is the single biggest lever on round total,
        comfortably ahead of pin difficulty.
      </P>

      <H3>Today's inputs</H3>
      <P>
        <b>Wind (HRRR).</b> 17 mph SSW in the morning window building
        to 21 mph SSW in the afternoon — from a locked 200° all day.
        Every prior R2 in the archive was played in 13 mph or less.
        Nobody in this field has played a 3M Open R2 in wind like
        this.
      </P>
      <P>
        <b>Pins.</b> Today's pin sheet is a mixed bag by cluster: two
        historically-benign spots (H2 in cluster D, H13 in cluster G),
        two neutral clusters through most of the front, and one
        genuine outlier — the back-right shelf on H16, a spot that
        already averages a fifth of a stroke above the hole's mean
        even in benign wind.
      </P>

      <H3>The wind-and-pin adjustment (before any calibration)</H3>
      <Callout>
        Plug today's wind and today's pin cluster into the fitted
        model and it says R2 plays <b>+0.22 strokes harder than a
        typical R2</b>. AM and PM come out effectively identical —
        the tailwind boost on the N-facing par-5s in the afternoon
        cancels the added headwind cost on the S-facing par-4s.
      </Callout>
      <P>
        Most of the +0.22 lives in two holes on opposite sides of
        zero. H16 (par 4, back-right shelf, 20 mph direct headwind)
        comes in{" "}
        <HarderChip>+0.33 strokes</HarderChip>{" "}
        harder than typical R2. H2 (par 4, back-right pin, full
        tailwind on the 354° tee) comes in{" "}
        <EasierChip>−0.33 strokes</EasierChip>{" "}
        easier. Everywhere else is scatter — the four par-4s dead into
        the wind pick up about +0.14 each; three N-facing tailwind
        holes give about −0.10 back. The residual is +0.22 and that's
        what pushes the field number from a wind-quiet 70.3 to a
        wind-heavy 71.5. Or would, if wind were the only thing in
        play.
      </P>

      <H3>What yesterday tells us</H3>
      <P>
        R1 wind: <b>10 mph from 170°</b>. R1 pins: cluster A or B on
        almost every hole — the "typical" pins the model has seen
        many times. Plug those inputs into the same regression and it
        predicts R1 would play about <b>+0.25 strokes harder</b> than
        the historical R1 baseline. A slightly hard wind angle plus
        neutral pins = expect a slightly-harder-than-average R1.
      </P>
      <P>
        <b>The field shot 70.02 — half a stroke softer than the
        historical R1 mean.</b> That's about three-quarters of a
        stroke below what the model expected. Neither wind nor pins
        explains it.
      </P>
      <Callout>
        The most likely reason is <b>course softness</b>. Rain earlier
        in the week left the greens receptive; approach shots stop
        instead of bounding out, spin control is easier, and back
        pins that normally play harder start playing normal.
        Softness is a level shift — it lowers the whole scoring
        distribution, and unless conditions change materially
        overnight it carries into today.
      </Callout>

      <H3>The forecast</H3>
      <P>
        Combining the wind-and-pin adjustment (+0.22 vs typical R2)
        with the R1-derived softness residual (−0.74):
      </P>
      <Table
        headers={["Component", "Strokes"]}
        rows={[
          [
            "Historical R2 mean field avg",
            <span
              key="hist"
              style={{ fontFamily: numFont }}
            >
              71.22 (+0.22 vs par)
            </span>,
          ],
          [
            "Wind + pin adjustment for today",
            <span key="wp" style={{ fontFamily: numFont }}>+0.22</span>,
          ],
          [
            "R1-derived softness level shift",
            <span key="soft" style={{ fontFamily: numFont }}>−0.74</span>,
          ],
          [
            <b key="fcast">R2 forecast</b>,
            <b key="fcastv" style={{ fontFamily: numFont }}>
              70.70 (−0.30 vs par)
            </b>,
          ],
        ]}
      />
      <Callout>
        <b>Central estimate: the field averages around 70.7 today.</b>
        {" "}That's about a quarter-stroke softer than the historical
        R2 mean, despite the wind being harder than anything the model
        has seen — because the greens are giving strokes back that a
        firm setup wouldn't.
      </Callout>
      <P>
        There's a range around that number worth naming. The wind
        coefficient in our regression was fit on historical rounds
        that peaked at 13 mph. Extrapolating it to 20 mph almost
        certainly under-estimates the true damage on the biggest
        headwind holes — non-linear effects (club-up decisions, more
        greens missed, chip-out lies) kick in. If we push the wind
        term to +0.4 strokes instead of +0.22, the forecast shifts to
        70.9. And if some of the R1 softness partly dries out through
        the day, add another tenth. Reasonable window:{" "}
        <b>70.5 to 71.0</b> (−0.5 to par).
      </P>

      <H3>Where the number lives — the two hero holes</H3>
      <P>
        The forecast is a course average; the interesting story is
        which holes are carrying it.
      </P>
      <P>
        <b>H16 (par 4).</b>{" "}
        <HarderChip>+0.33 strokes</HarderChip>{" "}
        harder than typical R2 on the wind-and-pin term alone, plus
        whatever softness effect it captures. The back-right shelf is
        already a difficult pin (avg vs par sits above the hole's
        overall mean); dropping a wedge into 20 mph of headwind at
        that target is a genuinely hard shot. Watch the leaderboard
        turn every 40 minutes as the last group in each wave plays
        16.
      </P>
      <P>
        <b>H2 (par 4).</b>{" "}
        <EasierChip>−0.33 strokes</EasierChip>{" "}
        easier than typical R2. 354° tee angle = pure tailwind, on a
        cluster D pin (back-right) that already plays about a fifth
        of a stroke under the hole's mean. Reachable in one for the
        long hitters if the wind holds; a real birdie hole for the
        rest.
      </P>
      <P>
        These two cancel each other in the round total. Most of what
        moves the +0.22 wind-and-pin term is spread across secondary
        movers:
      </P>
      <Table
        headers={["Hole", "Par", "Cluster", "Model Δ", "Note"]}
        rows={[
          [
            <b key="7">H7</b>,
            "4",
            "B",
            <HarderChip>+0.14</HarderChip>,
            "214° hole into 20 mph. Approach length matters — every 10 yards of extra club shows up here.",
          ],
          [
            <b key="11">H11</b>,
            "4",
            "B",
            <HarderChip>+0.14</HarderChip>,
            "175° dead into. Tucked back pin adds another 10 yards of effective approach.",
          ],
          [
            <b key="9">H9</b>,
            "4",
            "D",
            <HarderChip>+0.14</HarderChip>,
            "Cluster D historically plays flat; wind is doing all the work here.",
          ],
          [
            <b key="15">H15</b>,
            "4",
            "C",
            <EasierChip>−0.13</EasierChip>,
            "14° hole — cleanest tailwind on the property today. Even the back pin gets reachable.",
          ],
          [
            <b key="12">H12</b>,
            "5",
            "B",
            <EasierChip>−0.11</EasierChip>,
            "Par-5 tailwind but a mid-tier pin. Birdie hole, not eagle bait.",
          ],
          [
            <b key="13">H13</b>,
            "3",
            "G",
            <EasierChip>−0.10</EasierChip>,
            "Cluster G intrinsically easier (−0.10 residual). Crosswind doesn't add much either way.",
          ],
        ]}
      />

      <H3>What ~70.7 means</H3>
      <P>
        <b>For the leaders.</b> Leaders through R1 sit in the −7 to −9
        range. A projected R2 of 70.7 means anyone shooting 69 or
        better today gains ground on the field; 71 or worse loses
        ground. Names shooting 71 today drop toward the pack; names
        shooting 68 get close to the top of the board. Expect the
        leaderboard to compress by 2 to 3 strokes.
      </P>
      <P>
        <b>For the cut line.</b> R2 cut lines at 3M Open sit between
        −4 and −5 in a typical year. Today isn't a typical year — a
        soft course cuts deeper. Cut line likely lands at <b>−4 to
        −6</b>. If you're on a made-cut prop for a player currently at
        even par, a 71-72 today is a coin-flip; a 69 makes it
        comfortably.
      </P>
      <P>
        <b>For the birdie hunters.</b> Two clean spots (H2, H15) plus
        the reachable par-5s (H12, H18). Four dead-into-wind par-4s
        (H7, H11, H16, and to a lesser extent H9) are hold-for-par
        surfaces. Aggressive lines on H7, H11, H16 are penalty-prone
        today.
      </P>

      <H3>Betting angles</H3>
      <P>
        Round-score UNDERs on elite players. For a Scheffler-tier
        player whose R2 line is set at 67 or 68 (3-4 under), soft
        conditions plus a wind edge on the easier holes means UNDER
        is a lean; +100 or better is a take.
      </P>
      <P>
        <b>H16 field-average score OVER.</b> Model has us around 4.3
        for the field. If the market offers OVER 4.15, take it at{" "}
        <b>−130 or better</b>.
      </P>
      <P>
        <b>H2 field-average score UNDER.</b> Model has us around 3.85
        for the field. UNDER 4.05 at <b>−125 or better</b> is a take.
      </P>

      <H3>Where this can be wrong</H3>
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
          <b>The R1 residual assumes yesterday's wind estimate was
          right.</b> If the actual wind was gentler than 10 mph, some
          of the "softness" is really over-forecasted wind, and the
          level shift is smaller. Even at half the wind assumption,
          the residual is still around −0.6 — softness is the
          dominant story, just not by quite as much.
        </li>
        <li style={{ marginBottom: 10 }}>
          <b>Wind coefficients were fit inside 5 to 13 mph.</b>{" "}
          Extrapolating to 20 mph likely under-states the damage on
          the biggest headwind holes and over-states the boost on the
          biggest tailwind holes. Rank order of holes stays right;
          the specific magnitudes on H16 and H2 are conservative in
          both directions.
        </li>
        <li style={{ marginBottom: 10 }}>
          <b>Softness can partly dry out.</b> A gusty 20 mph
          afternoon does move moisture; if greens firm up through the
          day, the −0.74 residual attenuates and the PM wave plays
          closer to the wind-only forecast. Watch approach spin on
          the early PM tee times as a tell.
        </li>
      </ol>
      <P>
        Related surfaces: the{" "}
        <Link
          href="/analysis/course-heatmap"
          style={{ color: "oklch(0.50 0.13 155)", fontWeight: 700 }}
        >
          course &amp; pin guide
        </Link>{" "}
        surfaces per-cluster avg-vs-par by hole (default view); the{" "}
        <Link
          href="/analysis/tee-time-scoring"
          style={{ color: "oklch(0.50 0.13 155)", fontWeight: 700 }}
        >
          tee-time vs. score
        </Link>{" "}
        page shows how each wave has actually scored as the round
        completes.
      </P>
    </div>
  );
}
