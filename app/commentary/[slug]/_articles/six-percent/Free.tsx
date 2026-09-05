import { REVERSION } from "./charts";

/**
 * The half of the article anyone can read. Ends on the reversion
 * finding — the insight is given away in full; what's gated is the
 * actionable side of it (the projection, the price, the staking).
 *
 * No headline or dek here: /commentary/[slug] renders those from the
 * ARTICLES registry, so repeating them would double the title.
 */
export default function Free() {
  return (
    <>
      <div className="byline">
        <span>
          <b>14,575</b> player-events in the reversion sample
        </span>
        <span>
          <b>150</b> rounds in his baseline
        </span>
        <span>
          <b>221</b> tournaments
        </span>
      </div>

      <section className="wrap">
        <div className="trio">
          <div className="stat">
            <div className="v bad">65th</div>
            <div className="l">Where he is rated</div>
            <div className="s">
              Of the 70 players who made the cut. He has spent two days as the
              second-best player in the field.
            </div>
          </div>
          <div className="stat">
            <div className="v good">6%</div>
            <div className="l">How much of it carries</div>
            <div className="s">
              The share of a hot 36 holes that shows up again in round 3, across
              every tournament we hold.
            </div>
          </div>
          <div className="stat">
            <div className="v">25/36</div>
            <div className="l">Greens hit</div>
            <div className="s">
              69.4% against a field average of 69.6%. He has been, precisely, an
              average ball-striker.
            </div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <h2>
          <span className="num">01 &mdash; THE SETUP</span>Two rounds that
          don&rsquo;t belong to him
        </h2>
        <p className="lead">
          65&ndash;64 is a serious 36 holes. At Crans it has Jeremy Paul tied
          second, one behind Thriston Lawrence, and in the final group on
          Saturday afternoon.
        </p>
        <p>
          It is also, by our reckoning, about eleven strokes better than he
          should have played. Paul comes into this week rated 65th of the 70
          players who survived the cut &mdash; a number built on 150 rounds, so
          it is not a small-sample artefact. He has been the second-best player
          in the field for two days and roughly the sixth-worst for three years.
        </p>
        <p>
          That gap is the bet. Not because he is a bad player &mdash; he is a
          tour professional having a wonderful week &mdash; but because the
          market is pricing Saturday as though the two days that just happened
          tell you more about tomorrow than the three years that preceded them.
          They do not. They tell you about six percent of it.
        </p>
      </section>

      <figure className="wide">
        <div
          className="chartbox"
          dangerouslySetInnerHTML={{ __html: REVERSION }}
        />
        <figcaption>
          Every player-event in our database where a player had at least 40
          rounds of history elsewhere. Horizontal axis: how far above his own
          established level he played over the first 36 holes. Vertical axis:
          how far above that same level he then played in round 3. If form
          carried, the green line would track the orange one. It is flat.
        </figcaption>
      </figure>

      <section className="wrap">
        <h2>
          <span className="num">02 &mdash; THE RULE</span>Six percent carries.
          Ninety-four doesn&rsquo;t.
        </h2>
        <p>
          Run the regression properly &mdash; predict a player&rsquo;s round-3
          score from two things, what he has just shot over 36 holes and what he
          has done over his career &mdash; and the two coefficients are not
          close:
        </p>
      </section>

      <div className="tablebox wrap">
        <table>
          <caption>Predicting round 3 &mdash; 14,575 player-events</caption>
          <thead>
            <tr>
              <th>Input</th>
              <th>Weight</th>
              <th>Std. error</th>
              <th>t</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>What he shot in rounds 1&ndash;2</td>
              <td>+0.046</td>
              <td>0.015</td>
              <td>3.0</td>
            </tr>
            <tr className="flag">
              <td>His long-run baseline</td>
              <td>+0.739</td>
              <td>0.040</td>
              <td>18.5</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="wrap">
        <p>
          Both are real &mdash; the hot hand is not nothing, and a 3.0
          t-statistic is a genuine signal. But the split is roughly{" "}
          <strong>6% this week, 94% career</strong>. A player running a stroke a
          round above his level projects to keep about five hundredths of it.
        </p>
        <p className="pull">
          Of the 358 players in our sample who arrived at Saturday more than four
          and a half strokes a round above their own level, the average round 3
          was &mdash; to the tenth &mdash; exactly their own level. Not a
          fraction of the form. None of it.
        </p>
        <p>
          Forty-seven percent of them actually shot <em>worse</em> than their
          career baseline on Saturday. Paul sits beyond even that group, at +5.7
          strokes a round.
        </p>
        <p>
          Which raises the obvious question: if none of this is real, what is he
          actually going to shoot on Saturday afternoon &mdash; and what is that
          worth?
        </p>
      </section>
    </>
  );
}
