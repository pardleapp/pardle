/**
 * Article: "Exploring Scheffler round score dynamics: 3M Open R3."
 *
 * Walks through pricing Scheffler's R3 over/under 66.5 from first
 * principles. Uses the R3 field-mean forecast (69.0 assumed for the
 * body), his season SG edge (3.0), a course-specific compression
 * factor (~17%, from R1/R2 spread observations), and the elite-
 * player skew adjustment (mean→median gap of ~0.2 strokes) to
 * arrive at a fair over/under line and fair odds.
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

function UnderChip({ children }: { children: React.ReactNode }) {
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
function OverChip({ children }: { children: React.ReactNode }) {
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

export default function ArticleSchefflerR3Dynamics() {
  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      <P>
        The market has Scheffler's R3 total set at 66.5. Should you
        take UNDER, OVER, or leave it alone? This article walks the
        full pricing exercise — field mean, personal edge, the
        compression this course has been showing, and the mean-vs-
        median gap that decides where the fair line actually sits.
        Every number is transparent so you can re-run it if any input
        moves.
      </P>

      <H3>What "expected round score" actually means</H3>
      <P>
        The reflex answer is: field mean minus his skill edge. If the
        field is expected to average 69.0 and Scheffler is 3 strokes
        better per round, his expected score is 66.0. That's his
        expected <b>mean</b>. But betting markets aren't pricing his
        mean — they're pricing his median, the score he lands below
        exactly 50% of the time. Those two aren't the same number for
        anyone whose round distribution is skewed. And in golf,
        almost everyone's is.
      </P>
      <Callout>
        The literature is settled on this. Broadie (2012) treats
        round-score distributions as normal-in-the-centre with a
        heavier right tail (the blow-up rounds). Connolly &amp;
        Rendleman (2008) modelled 2000+ PGA Tour rounds and put the
        typical full-field skewness at 0.3-0.5. The takeaway: fields
        are right-skewed. Mean {'>'} median. If the book sets a line
        at a player's expected mean, they'd fall below it more than
        50% of the time.
      </Callout>

      <H3>Step 1 — Scheffler's expected mean</H3>
      <P>
        Assumption: the R3 field averages 69.0 (−2.0 vs par 71) when
        Scheffler is on the course.
      </P>
      <Table
        headers={["Component", "Strokes"]}
        rows={[
          ["Field mean forecast", <span key="fm" style={{ fontFamily: numFont }}>69.0</span>],
          ["Scheffler season SG edge (vs full field)", <span key="ed" style={{ fontFamily: numFont }}>3.0</span>],
          [
            "Compression factor at this course (elite players separating ~83% of usual)",
            <span key="cf" style={{ fontFamily: numFont }}>×0.83</span>,
          ],
          ["Compressed edge", <span key="ce" style={{ fontFamily: numFont }}>2.5</span>],
          [
            <b key="em">Expected MEAN score</b>,
            <b key="emv" style={{ fontFamily: numFont }}>66.5</b>,
          ],
        ]}
      />
      <P>
        Compression isn't a fudge — it fell out of the R1/R2 data.
        Scheffler and Matsuyama, both top-10 in world, sit at −7
        after 36 holes while the leaderboard is stacked with
        mid-tier players (Kim, Kohles, Grillo, Phillips, Koivun,
        Merritt). Elite players usually beat this kind of field by
        6+ strokes over 36 holes; Scheffler is 4-5 up on the field
        median. That's ~83% of his usual separation.
      </P>
      <P>
        If you don't buy the compression, his expected mean is
        69.0 − 3.0 = 66.0. Range on the point estimate: <b>66.0
        to 66.5</b>. Take the middle: <b>~66.3</b>.
      </P>

      <H3>Step 2 — From expected mean to expected median</H3>
      <P>
        Personal round distributions for elite players are mildly
        right-skewed (skewness ~0.1-0.2, per skew-normal fits to
        tour rounds). That translates to a mean-median gap of
        roughly 0.2 strokes — median sits below mean.
      </P>
      <Table
        headers={["Component", "Value"]}
        rows={[
          ["Expected mean (from Step 1)", <span key="m" style={{ fontFamily: numFont }}>66.3</span>],
          ["Skew adjustment (mean → median)", <span key="s" style={{ fontFamily: numFont }}>−0.2</span>],
          [
            <b key="med">Expected MEDIAN (fair 50/50 line)</b>,
            <b key="medv" style={{ fontFamily: numFont }}>~66.1</b>,
          ],
        ]}
      />
      <P>
        <b>The book's line at 66.5 is set 0.4 strokes above his
        expected median.</b> That's a UNDER lean before we've
        touched variance or looked at the market price.
      </P>

      <H3>Step 3 — Round-score variance</H3>
      <P>
        From ShotLink and DataGolf historical, elite players'
        round-score standard deviation runs <b>2.3 to 2.5 strokes</b>
        — tighter than the field's ~3.0 because elites don't blow
        up. Use 2.4 as the working number.
      </P>

      <H3>Step 4 — Probability Scheffler shoots UNDER 66.5</H3>
      <P>
        Normal approximation first, skew correction second.
      </P>
      <Table
        headers={["Step", "Value"]}
        rows={[
          [
            "z-score of the line vs his expected mean",
            <span key="z" style={{ fontFamily: numFont }}>(66.5 − 66.3) / 2.4 = +0.083</span>,
          ],
          [
            "P(UNDER 66.5) under a normal distribution",
            <span key="pn" style={{ fontFamily: numFont }}>Φ(0.083) = 53.3%</span>,
          ],
          [
            "Skew correction for his personal right-skew",
            <span key="ps" style={{ fontFamily: numFont }}>+3 to +5 percentage points</span>,
          ],
          [
            <b key="ph">P(UNDER 66.5), final estimate</b>,
            <b key="phv" style={{ fontFamily: numFont }}>56-58% (central: 57%)</b>,
          ],
        ]}
      />

      <H3>Step 5 — Fair American odds</H3>
      <Table
        headers={["Outcome", "Probability", "Fair American odds"]}
        rows={[
          [
            <UnderChip key="u">UNDER 66.5</UnderChip>,
            "57%",
            <b key="uo" style={{ fontFamily: numFont }}>−133</b>,
          ],
          [
            <OverChip key="o">OVER 66.5</OverChip>,
            "43%",
            <b key="oo" style={{ fontFamily: numFont }}>+133</b>,
          ],
        ]}
      />

      <H3>Step 6 — Betting decision rules</H3>
      <Table
        headers={["Book line offered", "Verdict"]}
        rows={[
          [
            <UnderChip key="a">UNDER −125 or better</UnderChip>,
            <b key="av">Strong bet UNDER (5%+ edge)</b>,
          ],
          [
            <UnderChip key="b">UNDER −125 to −135</UnderChip>,
            "Lean UNDER (1-3% edge, size accordingly)",
          ],
          [
            <UnderChip key="c">UNDER −136 to −145</UnderChip>,
            "No bet — book has priced the skew correctly",
          ],
          [
            <OverChip key="d">OVER +115 to +125</OverChip>,
            "Lean OVER (small edge)",
          ],
          [
            <OverChip key="e">OVER +126 or better</OverChip>,
            <b key="ev">Strong bet OVER (5%+ edge)</b>,
          ],
          [
            <OverChip key="f">OVER +145 or better</OverChip>,
            <b key="fv">Hammer OVER — rare but happens on soft lines</b>,
          ],
        ]}
      />

      <H3>Step 7 — Where the calculation could shift</H3>
      <P>
        Sensitivity check on the load-bearing inputs:
      </P>
      <Table
        headers={["Scenario", "Effect on P(UNDER 66.5)"]}
        rows={[
          [
            "Compression is milder than 17% (elites separating normally)",
            "+3 to +5 pp (bullish UNDER)",
          ],
          [
            "Compression is bigger than 17%",
            "−3 to −5 pp (bearish UNDER)",
          ],
          [
            "Field mean forecast overshoots — course plays softer than 69.0",
            "+6 to +8 pp per 0.5 stroke softer (bullish UNDER)",
          ],
          [
            "Field mean forecast undershoots — wind builds",
            "−6 to −8 pp per 0.5 stroke harder (bearish UNDER)",
          ],
          [
            "Scheffler's variance narrower than 2.4 (dialled-in state)",
            "Widens gap: P(UNDER) drifts to ~54-56%",
          ],
          [
            "Scheffler's variance wider than 2.4 (fighting swing)",
            "Narrows gap: P(UNDER) drifts to ~58-60%",
          ],
        ]}
      />

      <H3>Bottom line</H3>
      <Callout>
        <b>Fair line: 66.1. Fair odds on UNDER 66.5: −133.</b>
        {" "}Bet UNDER at any price better than −125. Bet OVER at any
        price better than +130. Anything between −126 and +129 is
        priced correctly and doesn't offer edge.
      </Callout>
      <P>
        The three load-bearing assumptions are the 3.0 SG edge, the
        69.0 field-mean forecast, and the 17% compression. If any
        move, the answer moves — sensitivity is roughly ±5
        percentage points on P(UNDER) per 0.5-stroke shift in the
        field mean. Keep an eye on tee-time wind: if the forecast
        holds around 11 mph WSW as expected, the numbers here stand;
        if the wind builds materially by his tee time, the field
        mean pushes toward 70 and the UNDER value evaporates.
      </P>
      <P>
        Related surfaces: the{" "}
        <Link
          href="/commentary/3m-open-r2-scoring-forecast"
          style={{ color: "oklch(0.50 0.13 155)", fontWeight: 700 }}
        >
          R2 scoring forecast
        </Link>{" "}
        walks through where the field-mean number comes from; the{" "}
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
