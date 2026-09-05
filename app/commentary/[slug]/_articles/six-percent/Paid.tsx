import { DIST, RANKS, WIND } from "./charts";
import { LEADERBOARD, SENSITIVITY } from "./data";

/**
 * Everything behind the email gate. Only rendered when the reader
 * cookie is present, so for a first-time visitor none of this markup
 * is in the response at all — the gate is not a CSS overlay.
 */
export default function Paid() {
  return (
    <>
      <section className="wrap">
        <h2>
          <span className="num">03 &mdash; THE MECHANISM</span>He has hit 25
          greens
        </h2>
        <p className="lead">
          Here is where the two rounds came from, and it is not from playing
          well from tee to green.
        </p>
        <p>
          Across 36 holes Paul has hit{" "}
          <strong>
            25 of 36 greens in regulation &mdash; 69.4%, against a field average
            of 69.6%
          </strong>
          . He has been, precisely, an average ball-striker. On Friday he ranked
          81st in the field for greens hit and shot 64.
        </p>
        <p>
          What he has done is hole everything. Fifty-two putts over two rounds
          against a field average of 58.9 &mdash; nearly{" "}
          <strong>seven strokes gained on the greens alone</strong>, out of a
          total of 9.2 strokes gained on the field. Three quarters of his entire
          advantage this week has come from the flat stick, on rounds where he
          ranked 10th and 5th in the field for putts.
        </p>
      </section>

      <figure className="wide">
        <div className="chartbox" dangerouslySetInnerHTML={{ __html: RANKS }} />
        <figcaption>
          Paul&rsquo;s category ranks in each of the first two rounds. The two
          putting rows sit at the elite end. Everything that involves striking a
          golf ball sits in the middle of the field or worse &mdash; including
          greens in regulation, where he ranked 53rd and 81st.
        </figcaption>
      </figure>

      <section className="wrap">
        <p>
          We want to be careful here, because the obvious next claim is the one
          the data does not quite support. We tested whether hot putting reverts{" "}
          <em>faster</em> than hot ball-striking across 2,519 events with full
          shot-category data. Directionally it does &mdash; putting persists at
          0.09, ball-striking at 0.13 &mdash; but the standard errors are 0.05
          and 0.04, so the two are not reliably distinguishable. We are not going
          to tell you the putter is special.
        </p>
        <p>
          We do not need to. The point is the one from section two, and it is
          much stronger:{" "}
          <strong>
            almost none of a hot 36 holes carries, whatever produced it.
          </strong>{" "}
          The putting split does not add to the case. It just makes it obvious
          why nobody should be surprised.
        </p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">04 &mdash; THE DRAW</span>The worst tee time on
          the property
        </h2>
        <p>
          Leading has a cost at Crans, and on Saturday it is a heavy one. Round 3
          goes off a single tee in leaderboard order, 07:15 through 13:10. Paul
          is in the final group.
        </p>
        <p>
          The wind here is a thermal &mdash; the valley warms, air moves up the
          slope, and the course changes character through the afternoon. Our work
          on this venue puts the scoring cost at roughly{" "}
          <strong>0.13 strokes per mph of gust</strong>. Paul&rsquo;s five hours
          on the course carry an average of <strong>21.8 mph</strong> against a
          field average of 16.7.
        </p>
      </section>

      <figure className="wide">
        <div className="chartbox" dangerouslySetInnerHTML={{ __html: WIND }} />
        <figcaption>
          Saturday&rsquo;s forecast gust profile, corrected against the station
          readings we have been verifying all week. The early groups play in 13
          mph. The final group walks into the afternoon build and finishes in the
          worst of it.
        </figcaption>
      </figure>

      <section className="wrap">
        <p>
          That is worth <strong>+0.65 strokes</strong> to his projection on its
          own &mdash; and it is the part of this bet that is most reliably
          mispriced, because round-score lines are generally set off the
          leaderboard and the player, not off the hour he tees off.
        </p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">05 &mdash; THE NUMBER</span>Where 70.9 comes from
        </h2>
      </section>

      <div className="tablebox wrap">
        <table>
          <caption>Jeremy Paul &mdash; projected round 3</caption>
          <thead>
            <tr>
              <th>Component</th>
              <th>Strokes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Field scoring level, round 3</td>
              <td>69.52</td>
            </tr>
            <tr>
              <td>His own standard vs this field</td>
              <td>+0.72</td>
            </tr>
            <tr>
              <td>Final group, windiest window</td>
              <td>+0.65</td>
            </tr>
            <tr className="flag">
              <td>Projected score</td>
              <td>70.89</td>
            </tr>
          </tbody>
        </table>
      </div>

      <figure className="wide">
        <div className="chartbox" dangerouslySetInnerHTML={{ __html: DIST }} />
        <figcaption>
          The full projected distribution, standard deviation 3.02 strokes,
          including the common day-to-day conditions shock. Everything at 70 or
          higher wins the bet.
        </figcaption>
      </figure>

      <section className="wrap">
        <h2>
          <span className="num">06 &mdash; THE PRICE</span>What it&rsquo;s worth
        </h2>
        <p>
          At &minus;114 you need this to land <strong>53.3%</strong> of the time.
          We make it <strong>67.8%</strong>. That is a{" "}
          <strong>14.5 point</strong> edge and <strong>+27.2%</strong> expected
          value per unit &mdash; the sort of number that normally means you have
          made an error somewhere, so we stress-tested the one assumption it
          hangs on.
        </p>
        <p>
          The model has to decide how much credit to give Paul for the two rounds
          he has just played. Our own data says 6%. If we instead force the model
          to be as generous as the outright market implicitly is, and then more
          generous still, the bet survives comfortably:
        </p>
      </section>

      <div className="tablebox wrap">
        <table>
          <caption>
            Sensitivity &mdash; credit given to this week&rsquo;s form
          </caption>
          <thead>
            <tr>
              <th>Assumption</th>
              <th>P(over 69.5)</th>
              <th>EV at &minus;114</th>
            </tr>
          </thead>
          <tbody>
            {SENSITIVITY.map((s) => (
              <tr key={s.basis}>
                <td>{s.basis}</td>
                <td>{s.p.toFixed(1)}%</td>
                <td className="good">
                  {s.ev > 0 ? "+" : ""}
                  {s.ev.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="wrap">
        <p>
          Even crediting him with more than five times the form persistence our
          sample supports, it is still an 18% edge. Strip the wind adjustment out
          entirely and it is still profitable. There is no reasonable setting of
          the dials that turns this into a bad bet.
        </p>
        <p className="pull">
          Full Kelly is 31% of bankroll. Do not bet full Kelly on a golf round.
          We are playing this to <strong>15.5%</strong>.
        </p>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">07 &mdash; THE FIELD</span>He is the outlier, not
          the leader
        </h2>
        <p>
          Worth seeing the top of the leaderboard with each player&rsquo;s
          standing in the field attached. Lawrence is 30th of 70 &mdash;
          underrated, and leading. Elvira is 15th, Nakajima 8th. Those are normal
          contenders having good weeks. Paul is 65th.
        </p>
      </section>

      <div className="tablebox wrap">
        <table>
          <caption>After 36 holes &mdash; position against standing</caption>
          <thead>
            <tr>
              <th>Player</th>
              <th>36h</th>
              <th>Sat tee</th>
              <th>Field rank</th>
              <th>Proj. R3</th>
            </tr>
          </thead>
          <tbody>
            {LEADERBOARD.map((r) => (
              <tr
                key={r.name}
                className={r.name === "Jeremy Paul" ? "flag" : undefined}
              >
                <td>{r.name}</td>
                <td>
                  {r.tot > 0 ? "+" : ""}
                  {r.tot}
                </td>
                <td>{r.tee}</td>
                <td className={r.rank > 55 ? "bad" : undefined}>{r.rank}th</td>
                <td>{r.exp.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="wrap">
        <h2>
          <span className="num">08 &mdash; THE OTHER SIDE</span>What beats us
        </h2>
      </section>

      <div className="verdict wide">
        <div className="vcard no">
          <div className="tag">Risk</div>
          <h4>The baseline is stale</h4>
          <p>
            If Paul has genuinely improved &mdash; new coach, new equipment,
            something structural &mdash; a career average built on 150 rounds
            understates him, and it will keep understating him all weekend.
          </p>
          <div className="r">
            <span>Severity</span>
            <b>Real but slow</b>
          </div>
        </div>
        <div className="vcard no">
          <div className="tag">Risk</div>
          <h4>The wind doesn&rsquo;t arrive</h4>
          <p>
            Our afternoon build is a forecast. If Saturday stays still, 0.65
            strokes come straight off the projection and the edge roughly halves.
          </p>
          <div className="r">
            <span>Cost if wrong</span>
            <b>&minus;0.65 str</b>
          </div>
        </div>
        <div className="vcard yes">
          <div className="tag">In our favour</div>
          <h4>Variance is the enemy of a low number</h4>
          <p>
            He needs to shoot 69 or better to beat us, from the hardest tee time,
            as the sixth-worst player left. Every dial we are unsure about still
            points the same way.
          </p>
          <div className="r">
            <span>Our price</span>
            <b>&minus;210</b>
          </div>
        </div>
      </div>

      <section className="wrap">
        <h2>
          <span className="num">09 &mdash; THE BET</span>Jeremy Paul over 69.5
        </h2>
        <p className="lead">
          Over 69.5 at &minus;114. Play to &minus;125. Our fair is &minus;210, so
          there is room to take the worst of a line move and still be well in
          front.
        </p>
        <p>
          The story of the tournament will be whether Lawrence holds on. The bet
          is not about that. It is about the fact that a player rated 65th of 70
          has just played two rounds worth of the best putting of his life, is
          teeing off last into the wind, and is being priced as though any of
          that continues.
        </p>
        <p>Six percent of it does.</p>
      </section>

      <div className="method wrap">
        <h3>Method</h3>
        <p>
          Round-3 projections combine a field scoring level, a player rating, and
          a tee-time wind adjustment specific to this venue.
        </p>
        <ul>
          <li>
            <b>Reversion sample</b> &mdash; 14,575 player-events across 221
            completed tournaments, restricted to players with 40+ rounds of
            history outside the event in question, so the baseline is never
            contaminated by the week being measured.
          </li>
          <li>
            <b>Shot-category test</b> &mdash; 2,519 events carrying full
            strokes-gained splits.
          </li>
          <li>
            <b>Wind</b> &mdash; each player&rsquo;s exposure is the mean forecast
            gust across his actual five hours on the course, bias-corrected
            against station readings we have been verifying against all week,
            priced at 0.126 strokes per mph.
          </li>
          <li>
            <b>Distribution</b> &mdash; normal, standard deviation 3.02,
            comprising the player&rsquo;s own round-to-round variation and a
            common conditions shock shared by the field.
          </li>
          <li>
            <b>Staking</b> &mdash; half Kelly, capped. Full Kelly on a single golf
            round is a good way to find out what a 3-putt feels like.
          </li>
        </ul>
      </div>
    </>
  );
}
