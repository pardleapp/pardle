import styles from "./six-percent/article.module.css";
import { CHANGES, DIST, PUTTS, R1HIST, RAIN, THREEPUTT, WATERFALL, WIND } from "./espana-r2/charts";
import { TOP20 } from "./espana-r2/data";

/**
 * Article: Open de Espana round 2 forecast — why round 1 played hard and
 * how the round-2 expectations are built. Reuses the six-percent series
 * stylesheet so the pieces read as one series. All figures are frozen from
 * the analysis run on the evening of round 1 (pga-model/esp_*.py).
 * Copy rule: no third-party data-source names (ratings, odds, shot-tracking,
 * weather-model brands) in anything the reader sees.
 */

function Chart({ svg, caption }: { svg: string; caption: React.ReactNode }) {
  return (
    <figure>
      <div className="chartbox" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const HOLES: Array<[string, string, string, string]> = [
  ["6th", "4", "+0.35", "437 yards"],
  ["13th", "4", "+0.27", "One of the three hardest holes of the day"],
  ["16th", "4", "+0.27", ""],
  ["2nd", "4", "+0.26", "Played into the wind in the morning"],
  ["5th", "4", "+0.24", ""],
  ["9th", "3", "+0.18", "Par 3 back at full length (moved forward in last year's round 2)"],
  ["3rd", "3", "+0.15", "Same: 222 yards on Thursday"],
  ["10th", "4", "−0.14", ""],
  ["15th", "4", "−0.11", ""],
  ["14th", "5", "−0.09", "The eagle hole: Ayora and Chacarra both made 3"],
];

export default function ArticleEspanaR2() {
  return (
    <div className={styles.article}>
      <div className="byline">
        <span>
          <b>2,464</b> rounds at Club de Campo since 2019
        </span>
        <span>
          <b>125</b> round-1 cards in the calibration
        </span>
        <span>
          <b>131</b> players priced for round 2
        </span>
      </div>

      <section className="wrap">
        <div className="trio">
          <div className="stat">
            <div className="v bad">72.34</div>
            <div className="l">Thursday field average</div>
            <div className="s">
              1.34 over par. The hardest first round here since 2019, bar the 2024 gale.
            </div>
          </div>
          <div className="stat">
            <div className="v bad">−0.7</div>
            <div className="l">Close birdie looks per round</div>
            <div className="s">
              Greens hit inside 20 feet, same players as last year&rsquo;s round 1. Soft greens spun the ball away.
            </div>
          </div>
          <div className="stat">
            <div className="v good">70.9</div>
            <div className="l">Friday forecast</div>
            <div className="s">Field average. Almost all of the improvement is the wind dropping.</div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">01 &mdash; THE ROUND</span>A soft course that refused to give anything away
        </h2>
        <p className="lead">
          Everything pointed to a birdie-fest. Madrid had its wettest build-up to this event in years, the
          greens were receptive, and on Tuesday Shane Lowry said the scoring was
          &ldquo;going to be pretty low out here.&rdquo; Then the field went out and averaged 72.34.
        </p>
        <p>
          Thirteen of the 18 holes played over par and the lead was just −5, the highest first-round lead at
          Club de Campo since 2019 (previous years ranged from −6 to −10). Set against every first round on this course,
          Thursday sits second only to 2024, when the opening round was played in a full-blown gale.
        </p>
        <Chart
          svg={R1HIST}
          caption="Round 1 field scoring average against par at Club de Campo. 2026 is the morning and afternoon waves combined."
        />
        <p>
          So the interesting question for Friday is not just <em>how hard</em> it played but <em>why</em> &mdash;
          because some of the reasons carry into round 2 and some of them don&rsquo;t. We pulled apart the
          round three ways: what the players said, what the shot-level numbers say, and what the weather
          actually did.
        </p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">02 &mdash; THE RAIN</span>Soft is not the same as easy
        </h2>
        <p>
          The course went into the week bone dry after a hot September &mdash; highs of 30 to 34&deg;C until
          the last week of the month &mdash; and then took roughly 25mm of rain in the five days before
          the first tee shot, including a thunderstorm on Tuesday that pulled players off the range for an
          hour and a half. On the same rain gauge two kilometres from the course, only one previous edition
          comes close.
        </p>
        <Chart
          svg={RAIN}
          caption="Rain recorded in the 14 days before round 1, same gauge every year (no reading available for 2019)."
        />
        <p>
          That one is 2021, and 2021 produced the easiest scoring in the course&rsquo;s recent history. The
          natural read &mdash; and the one we made before the round &mdash; was that a soft course would play
          the same way. It didn&rsquo;t, and the reason is the most useful thing we learned all day: soft
          greens here don&rsquo;t make the course easier to score on, they make the ball impossible to stop
          where you want it.
        </p>
        <p className="pull">
          &ldquo;The course this year is very soft, because normally we play a hard, firm course. You have to
          take one more club and take off distance, so it&rsquo;s not very easy to get the ball close to the
          pin.&rdquo; &mdash; &Aacute;ngel Ayora, 67
        </p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">03 &mdash; IN THEIR WORDS</span>Spin, footprints, rough and a wind that wouldn&rsquo;t sit still
        </h2>
        <p>
          We went through every post-round interview, the tournament&rsquo;s own coverage, the broadcast
          clips and the Spanish press. Four explanations came up again and again.
        </p>
        <h3>1. The ball spun back off everything</h3>
        <p>
          &ldquo;The ball spins back a huge amount. With anything below a 6-iron you have to hit little
          controlled shots so it doesn&rsquo;t come back too far,&rdquo; said Sergio Garc&iacute;a after a
          67 in the afternoon. Ayora talked about having to &ldquo;take 10 to 15 metres off a club&rdquo; even
          with an 8- or 9-iron, and the tournament&rsquo;s own site summed it up as &ldquo;controlling the
          backspin has been torture.&rdquo;
        </p>
        <h3>2. The greens got trampled</h3>
        <p>
          Soft greens mark easily. Ayora predicted it straight after his morning round &mdash; &ldquo;the last
          groups are going to have a rough time, because the footprints show and affect it a lot&rdquo; &mdash;
          and Garc&iacute;a confirmed it that evening: &ldquo;a difficult afternoon, with very gusty wind and
          the greens quite trampled.&rdquo; Notably, nobody called the greens slow. The players and the TV
          pundits described them as soft <em>and</em> quick, rolling well where they hadn&rsquo;t been walked on.
        </p>
        <h3>3. Long, wet rough and tight, tree-lined fairways</h3>
        <p>
          &ldquo;The rough is very high and very wet &mdash; if you&rsquo;re in it the ball can sit very
          badly,&rdquo; said Ayora, whose 67 beat his two playing partners by 13 shots combined. &ldquo;The moment
          you miss the fairway, you&rsquo;re going to suffer.&rdquo; Ludvig &Aring;berg: &ldquo;The fairways are skinny. You
          have to drive it well.&rdquo; Preferred lies were in force on the fairways, so the penalty was all
          in the rough.
        </p>
        <h3>4. Swirling, gusty wind</h3>
        <p>
          &ldquo;The wind swirls with the trees, it comes from every side, and judging whether a crosswind
          helps or hurts is harder,&rdquo; said Manuel Elvira. The broadcast team, walking the course mid-
          morning, put it more bluntly: &ldquo;downwind on one hole, and logically the next should be into it,
          and it isn&rsquo;t &mdash; players make a lot of club-selection errors.&rdquo;
        </p>
        <p>
          Just as telling is what nobody blamed: not one player mentioned the pin positions or the length of
          the par 3s.
        </p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">04 &mdash; THE NUMBERS</span>Same greens hit. Fewer close looks.
        </h2>
        <p>
          Quotes tell you what players felt. To see where the shots actually went, we compared the 85
          players who played both this year and last on the shot-tracking data. Last year&rsquo;s round 1
          is the fair comparison: same long setup, same par-3 yardages, almost to the yard.
        </p>
        <div className="tablebox">
          <table>
            <caption>Same players, round 1: 2026 against 2025</caption>
            <thead>
              <tr>
                <th>Measure</th>
                <th>2026 R1</th>
                <th>2025 R1</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Driving distance (yards)</td>
                <td>271.6</td>
                <td>279.4</td>
                <td className="bad">−7.8</td>
              </tr>
              <tr>
                <td>Driver used off the tee</td>
                <td>70.5%</td>
                <td>76.0%</td>
                <td className="bad">−5.5 pts</td>
              </tr>
              <tr>
                <td>Fairways hit</td>
                <td>45.4%</td>
                <td>44.4%</td>
                <td>+1.0 pt</td>
              </tr>
              <tr>
                <td>Greens in regulation</td>
                <td>59.9%</td>
                <td>61.4%</td>
                <td>−1.6 pts</td>
              </tr>
              <tr className="flag">
                <td>Greens hit inside 20 ft (share of holes)</td>
                <td>30.9%</td>
                <td>34.6%</td>
                <td className="bad">−3.7 pts</td>
              </tr>
              <tr>
                <td>Birdies or better (per round)</td>
                <td>3.04</td>
                <td>3.61</td>
                <td className="bad">−0.57</td>
              </tr>
              <tr>
                <td>Bogeys or worse (per round)</td>
                <td>4.27</td>
                <td>3.36</td>
                <td className="bad">+0.90</td>
              </tr>
              <tr>
                <td>Three-putts (share of holes)</td>
                <td>5.5%</td>
                <td>3.3%</td>
                <td className="bad">+2.2 pts</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Drives went about eight yards shorter &mdash; the ball simply stopped where it landed &mdash; and
          players hit fewer drivers. They still found as many fairways and nearly as many greens as a year
          ago. The damage is in <em>where</em> those greens were hit. The share of greens hit inside 20 feet
          fell by almost four points, which is about two-thirds of a realistic birdie chance lost per
          round, and birdies fell by more than half a shot while bogeys rose by nearly a full shot.
        </p>
        <Chart
          svg={CHANGES}
          caption="Change per round against last year's round 1, same 85 players. The close birdie looks disappeared and the bogeys went up."
        />
        <p>
          The average first-putt distance on greens hit barely moved &mdash; about a foot &mdash; because
          the change sits at the ends: fewer greens were hit inside 10 feet, where birdies are likely, and
          more were hit with 30 feet or more still to go.
          That is exactly what Ayora and Garc&iacute;a described: approaches spinning back off soft greens,
          and players taking an extra club and still not being able to get the ball close.
        </p>
        <h3>So was it the putting?</h3>
        <p>
          Less than it looks. Three-putts did jump, but longer first putts produce more putts from any
          golfer. So we split the extra putts on greens hit into two parts: what the longer distances alone
          would cause on a normal tour putting curve, and what&rsquo;s left over &mdash; the putting itself.
        </p>
        <Chart
          svg={PUTTS}
          caption="Extra putts per round on greens hit, whole field. Against last year's round 1 almost all of it is the longer first putts; the big putting gap only appears against last year's round 2, which was an unusually good putting day."
        />
        <p>
          Against the like-for-like round, the field putted no worse than a year ago once you allow for
          the extra distance &mdash; about 0.05 of a putt per round. The extra three-putts are mostly a
          consequence of where the approaches finished, plus the trampled greens late in the day. Against
          last year&rsquo;s round 2 putting looks far worse, but that round was the outlier: the field holed
          everything its distances said it should.
        </p>
        <Chart
          svg={THREEPUTT}
          caption="Share of holes three-putted across the whole field. Much of Thursday's rise follows from the longer first putts."
        />
        <p className="pull">
          Thursday was lost on the approach, not on the greens: soft surfaces that spun the ball back took
          away the close birdie looks, and the wet rough and gusting wind added the bogeys.
        </p>
        <div className="tablebox">
          <table>
            <caption>Hole averages against last year&rsquo;s round 2</caption>
            <thead>
              <tr>
                <th>Hole</th>
                <th>Par</th>
                <th>Vs 2025 R2</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {HOLES.map(([h, par, d, note]) => (
                <tr key={h}>
                  <td>{h}</td>
                  <td>{par}</td>
                  <td className={d.startsWith("+") ? "bad" : "good"}>{d}</td>
                  <td className="rowlab" style={{ textAlign: "left" }}>
                    {note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">05 &mdash; THE WIND</span>Gusts at 11am, a stiff breeze by 5pm
        </h2>
        <p>
          The weather station at Madrid&rsquo;s main airport is the most reliable record of what the air was
          doing across the city. It shows two separate problems: a gusty spell in the middle of the morning,
          with gusts of 43 km/h reported at 11:00 and 11:30, and then a steady build from mid-afternoon to
          around 30 km/h &mdash; right as the afternoon wave reached its closing holes.
        </p>
        <Chart
          svg={WIND}
          caption="Observed wind at Madrid's main airport on Thursday against the two pre-round forecasts for the same spot. The high-resolution model saw both the morning burst and the late build; the global model did not."
        />
        <p>
          Over a player&rsquo;s round that works out to roughly 14 km/h for the morning wave and 17 km/h for
          the afternoon on our wind scale. Our course model, fitted on every round here since 2019, puts the
          cost of wind at about 0.1 of a shot per round for every km/h &mdash; so Thursday&rsquo;s breeze was
          worth roughly 1.3 to 1.6 shots on its own. The afternoon wave did score slightly worse, but once the
          extra wind is accounted for the gap between the waves disappears.
        </p>
        <p>It was also cold: the coldest first round of any edition here since 2019, three to four degrees below the usual.</p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">06 &mdash; WHO IT SUITED</span>Length paid
        </h2>
        <p>
          With the ball stopping dead and the rough this thick, the players who could carry it a long way and
          still find the fairway had a real advantage: they were hitting shorter irons into greens that would
          only hold a high, soft shot. We measured it directly, holding each player&rsquo;s overall rating
          fixed and asking whether driving distance explained what was left.
        </p>
        <Chart
          svg={DIST}
          caption="Extra strokes gained per round for each standard deviation of driving distance (about eight yards), after allowing for overall skill. Long hitters beat their rating by two to three times the usual amount in the hard opening rounds."
        />
        <p>
          On a normal day at Club de Campo, length is worth a little. In the three toughest first rounds it
          has been worth two to three times that. The leaderboard agrees: Eugenio Chacarra (66) and Ayora (67), both well above average
          length, made two eagles each.
        </p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">07 &mdash; FRIDAY</span>What changes and what doesn&rsquo;t
        </h2>
        <div className="verdict">
          <div className="vcard yes">
            <div className="tag">Changes</div>
            <h4>The wind almost disappears</h4>
            <p>
              Both forecast models have Friday close to dead calm &mdash; around 2 to 3 km/h over a round for
              either wave, with gusts barely reaching the mid-teens.
            </p>
            <div className="r">
              <span>Effect</span>
              <b>about −1.3 shots</b>
            </div>
          </div>
          <div className="vcard yes">
            <div className="tag">Probably changes</div>
            <h4>The par 3s move forward</h4>
            <p>
              Last year the 3rd, 9th and 11th all came forward by 11 to 16 yards for round 2. Thursday&rsquo;s
              setup matched last year&rsquo;s round 1 almost to the yard. If the pattern repeats it is worth
              about half a shot; we take half of that as our central case.
            </p>
            <div className="r">
              <span>Effect</span>
              <b>−0.25 central</b>
            </div>
          </div>
          <div className="vcard no">
            <div className="tag">Doesn&rsquo;t change</div>
            <h4>The course stays soft</h4>
            <p>
              &ldquo;It will dry out a bit, but it will still be soft all week,&rdquo; says Ayora. Spin, wet rough
              and the advantage for long, straight drivers carry straight into round 2.
            </p>
            <div className="r">
              <span>Effect</span>
              <b>built into the baseline</b>
            </div>
          </div>
          <div className="vcard no">
            <div className="tag">New</div>
            <h4>A cold start</h4>
            <p>
              The morning wave tees off at about 6&deg;C, and averages 13&deg;C across its round against
              nearly 17&deg;C on Thursday. Colder air flies shorter, and the greens will be damp with dew.
            </p>
            <div className="r">
              <span>Effect</span>
              <b>+0.15 for the morning wave</b>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">08 &mdash; THE MODEL</span>From 72.34 to 70.9
        </h2>
        <p>
          Our round-1 forecast leaned on history and expected a soft course to play easy. For round 2 we have
          something much better: a full day of real scoring on this exact course in these exact conditions.
          So the forecast starts from what actually happened on Thursday and only adjusts for what changes.
        </p>
        <Chart
          svg={WATERFALL}
          caption="Field average: Thursday's actual score, with Thursday's wind taken out, Friday's wind and setup put back in, and a small allowance for the cold morning."
        />
        <ol>
          <li>
            <strong>Thursday&rsquo;s baseline.</strong> For each wave, how a player of average ability actually
            scored, holding every player&rsquo;s rating fixed.
          </li>
          <li>
            <strong>Remove Thursday&rsquo;s wind</strong> using each player&rsquo;s exposure over their own
            five hours on the course. What&rsquo;s left is the course itself: soft greens, wet rough and all.
          </li>
          <li>
            <strong>Add Friday&rsquo;s wind</strong> for every tee time, from the average of the two forecast
            models.
          </li>
          <li>
            <strong>Setup and cold</strong> as above.
          </li>
          <li>
            <strong>Each player&rsquo;s own level</strong> comes from our player ratings, plus a small extra
            credit for length (about a fifth of a shot per standard deviation, between Thursday&rsquo;s
            measured effect and the long-run average). Thursday&rsquo;s score itself barely moves the
            number &mdash; one round is mostly noise.
          </li>
        </ol>
        <p>
          The result: a field average of <strong>about 70.9</strong>, with the morning wave around 71.0 and
          the afternoon around 70.7. The afternoon edge comes from the cold, not the wind, which is calm for
          both.
        </p>
      </section>

      <section className="wide">
        <div className="wrap">
          <h2>
            <span className="num">09 &mdash; THE EXPECTATIONS</span>Round 2: the top 20
          </h2>
        </div>
        <div className="tablebox">
          <table>
            <caption>Expected round 2 score and chance of breaking each line</caption>
            <thead>
              <tr>
                <th>Player</th>
                <th>Tee</th>
                <th>R1</th>
                <th>Expected</th>
                <th>Under 70.5</th>
                <th>Under 69.5</th>
                <th>Under 68.5</th>
              </tr>
            </thead>
            <tbody>
              {TOP20.map((r) => (
                <tr key={r.name} className={r.name === "Ludvig Åberg" ? "flag" : undefined}>
                  <td>
                    {r.name}
                    {r.name === "Eugenio Chacarra" ? " *" : ""}
                  </td>
                  <td>{r.tee}</td>
                  <td>{r.r1}</td>
                  <td className="good">{r.exp.toFixed(2)}</td>
                  <td>{r.u705}%</td>
                  <td>{r.u695}%</td>
                  <td>{r.u685}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="wrap" style={{ fontSize: 14, color: "var(--muted)", marginTop: 14 }}>
          Tee times before 12:00 are the cold morning wave. Probabilities use each player&rsquo;s normal
          round-to-round spread, widened for the uncertainty in the field forecast. * Chacarra played round 1
          with a fractured toe and said afterwards he may not start round 2.
        </p>
      </section>

      <section className="wrap">
        <div className="method">
          <h3>How sure are we?</h3>
          <p>
            Less sure than the decimal places suggest, and we&rsquo;d rather say so. Our round-1 forecast
            missed by more than two shots because it trusted the history of soft weeks here over what the
            course was actually doing. Three things could still move Friday&rsquo;s number:
          </p>
          <ul>
            <li>
              <b>The setup.</b> If the par 3s stay at their long round-1 yardages, add about 0.25 to every
              number above; if they come forward as last year, take 0.25 off. The first tee times will tell
              us.
            </li>
            <li>
              <b>The greens.</b> A calm, sunny day could firm and quicken them &mdash; or the footprinting
              could return for the late groups. Neither is in the numbers.
            </li>
            <li>
              <b>The wind model at near-calm.</b> Taking out 1.3 shots for wind assumes the course&rsquo;s
              wind effect holds all the way down to a still day. Last year the course improved by 1.1 shots
              from round 1 to round 2, which is reassuringly close.
            </li>
          </ul>
          <p>
            Treat the field level as roughly <b>&plusmn;0.8 of a shot</b>. The ranking of players is more
            reliable than the level.
          </p>
        </div>
      </section>

      <footer>
        <span>
          <b>Data</b> 2,464 rounds at Club de Campo 2019&ndash;2025, shot-tracking data for 2025 and 2026, airport
          and local weather stations, two weather forecast models
        </span>
        <span>
          <b>Frozen</b> evening of round 1
        </span>
      </footer>
    </div>
  );
}
