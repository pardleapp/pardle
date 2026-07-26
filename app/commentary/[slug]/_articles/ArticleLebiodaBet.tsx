/**
 * Article: "Why we bet £1,149 on Hank Lebioda".
 *
 * Marketing-style piece pitched at non-analytics readers. The hook:
 * a real six-figure-pence bet the model told us to place. Then a
 * quick, visual walk through what the model does differently:
 *   - HRRR wind at his SPECIFIC tee time (not a day-average)
 *   - Pin-specific historical scoring at TPC Twin Cities (not
 *     cluster averages — the technical thing that makes this
 *     model different)
 *   - Course softness signal from R3 correctly attributed
 *
 * Ends on the odds gap: market 60%, model 75%. The 15-point edge
 * is why we bet.
 */

/* eslint-disable react/no-unescaped-entities */

const proseFont = "var(--font-archivo), 'Archivo', system-ui, sans-serif";
const numFont = "'IBM Plex Mono', ui-monospace, monospace";
const emerald = "oklch(0.35 0.15 155)";
const tang = "oklch(0.42 0.19 28)";

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 16,
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
        fontSize: 20,
        margin: "36px 0 12px",
        fontFamily: proseFont,
        letterSpacing: -0.005,
      }}
    >
      {children}
    </h3>
  );
}

export default function ArticleLebiodaBet() {
  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      {/* ── Bet slip visual ─────────────────────────────────── */}
      <div
        style={{
          margin: "0 0 32px",
          padding: "20px 22px",
          background:
            "linear-gradient(135deg, oklch(0.22 0.04 155) 0%, oklch(0.30 0.05 155) 100%)",
          color: "white",
          borderRadius: 12,
          boxShadow: "0 8px 32px oklch(0 0 0 / 0.25)",
          fontFamily: proseFont,
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: "oklch(0.75 0.05 155)",
            marginBottom: 8,
            fontWeight: 700,
          }}
        >
          The bet
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            Hank Lebioda · R4 UNDER 69.5
          </div>
          <div
            style={{
              fontFamily: numFont,
              fontSize: 22,
              fontWeight: 800,
              color: "oklch(0.85 0.14 90)",
            }}
          >
            1.666
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            paddingTop: 14,
            borderTop: "1px solid oklch(0.45 0.05 155)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: "oklch(0.75 0.05 155)",
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              Stake
            </div>
            <div
              style={{
                fontFamily: numFont,
                fontSize: 26,
                fontWeight: 800,
              }}
            >
              £1,149
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: "oklch(0.75 0.05 155)",
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              To win
            </div>
            <div
              style={{
                fontFamily: numFont,
                fontSize: 26,
                fontWeight: 800,
                color: "oklch(0.85 0.14 90)",
              }}
            >
              £765
            </div>
          </div>
        </div>
      </div>

      <P>
        <strong>The market prices him at 60%.</strong> Our model puts
        him at <strong>75%</strong>. That&apos;s a 15-point gap — the
        biggest edge we&apos;ve seen this week — so we sized up.
      </P>

      {/* ── The three numbers ────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          margin: "24px 0 8px",
        }}
      >
        {[
          {
            label: "Odds (bookmaker)",
            value: "60%",
            color: tang,
            sub: "1.666 decimal",
          },
          {
            label: "Model probability",
            value: "75%",
            color: emerald,
            sub: "expected median 68.1",
          },
          {
            label: "Our edge",
            value: "+15pp",
            color: emerald,
            sub: "Every £100 wins £25 long-run",
          },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              padding: 16,
              border: "1px solid oklch(0.9 0.008 95)",
              borderRadius: 10,
              background: "white",
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: "oklch(0.5 0.02 150)",
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: 30,
                fontWeight: 900,
                fontFamily: numFont,
                color: s.color,
                lineHeight: 1,
                marginBottom: 4,
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "oklch(0.5 0.02 150)",
              }}
            >
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      <H3>What our model saw</H3>
      <P>
        Sportsbooks price Lebioda&apos;s round total by looking at his
        world ranking and how he&apos;s been playing this week. Both
        surface stats. Neither can tell you what tomorrow&apos;s round
        will look like at TPC Twin Cities specifically.
      </P>
      <P>
        Our model can, because it&apos;s built from three things
        bookmakers don&apos;t use:
      </P>

      {/* ── Three model ingredients ─────────────────────────── */}
      <div style={{ display: "grid", gap: 14, margin: "16px 0 8px" }}>
        <Ingredient
          num="1"
          title="Hourly wind at his exact tee time"
          body="Lebioda tees off at 1:30 PM. The wind on this course rotates from a light southerly in the morning to a stiff SSW by mid-afternoon. Every hole he plays is projected using the wind he'll actually face at the hour he'll play it — not a smoothed daily average."
        />
        <Ingredient
          num="2"
          title="Pin-specific scoring, not pin cluster averages"
          body="Every pin on this course has a specific coordinate on the green. Historically we know exactly how those coordinates play — pin at (0.4, 0.3) plays −0.15 vs par, pin at (0.5, 0.3) plays +0.05. Our model uses those exact numbers instead of averaging across a whole zone of the green. That's a genuine edge over anyone who's just eyeballing hole-average difficulty."
        />
        <Ingredient
          num="3"
          title="Sunday will play like Saturday"
          body="The field shot 3.8 under par yesterday because the greens were receptive and the pins fair. Our model measured that softness, isolated it from the pin-position effect, and correctly carried the persistent slice into today's forecast. Bookmakers don't do that — they price Sunday like a fresh round."
        />
      </div>

      <H3>The numbers on him</H3>
      <P>
        Field forecast for R4: <strong>68.15</strong>. Lebioda&apos;s
        skill puts him about half a stroke above the field average
        (his season strokes-gained is below par). But he&apos;s
        outperformed his baseline this week — model bumps him back
        toward the field. Add a right-skew for a below-average
        player&apos;s round distribution (he&apos;s more likely to
        blow up than to smash a career round) and his{" "}
        <strong>expected median score is 68.13</strong>. His UNDER
        line is 69.5. That&apos;s <strong>1.4 strokes of daylight
        between our median and the line</strong>. Elite territory.
      </P>

      <H3>Why we sized big</H3>
      <P>
        With an edge this size, the math on stake is direct. Kelly
        criterion sizing on a 15-point edge at these odds calls for
        about 25% of a betting bankroll. We committed £1,149. If the
        model&apos;s right, he shoots 68 or better, our bet returns
        £765. And in the long run, this is exactly the shape of
        every position that grows a bankroll: model has proprietary
        signal, market has surface stats, position matches the gap.
      </P>

      <P>
        <strong>Watching the leaderboard from 1:30 PM.</strong>
      </P>
    </div>
  );
}

function Ingredient({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 16,
        padding: 16,
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 10,
        background: "white",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: emerald,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          fontWeight: 900,
          fontFamily: numFont,
          flexShrink: 0,
        }}
      >
        {num}
      </div>
      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            marginBottom: 6,
            fontFamily: proseFont,
            color: "oklch(0.24 0.04 155)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 14.5,
            lineHeight: 1.55,
            color: "oklch(0.35 0.03 155)",
            fontFamily: proseFont,
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}
