/**
 * "How the Round Score Forecast works" — the plain-English
 * companion page to the forecast tool.
 *
 * Structured as five numbered sections that mirror the tool's own
 * layout (Setup → Players → Advanced → Results) plus a preamble
 * explaining what the model does. Every parameter with a tooltip
 * in the tool has a fuller explainer here — the tooltip is the
 * two-line hint, this page is the "why".
 *
 * Written for a reader who's never seen a strokes-gained figure.
 * Where the model has a real quirk (persistence-weighted form,
 * skill compression, mean-vs-median gap) we explain the intuition
 * first, then show the arithmetic, then give a concrete example
 * from this week's actual field.
 */

import Link from "next/link";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `How the Round Score Forecast works — ${BRAND.name}`,
  description:
    "Plain-English methodology for Pardle's round score forecast: field baseline, skill edge, form adjustment, and every parameter the tool exposes.",
  openGraph: null,
  twitter: null,
};

// Design tokens — mirror design-handoff/social-v2.css and the
// ForecastTool redesign so the explainer feels like the same product.
const T = {
  bg: "oklch(0.972 0.009 95)",
  card: "oklch(0.995 0.004 95)",
  soft: "oklch(0.945 0.012 95)",
  line: "oklch(0.90 0.013 95)",
  ink: "oklch(0.26 0.04 155)",
  muted: "oklch(0.50 0.02 150)",
  dim: "oklch(0.62 0.018 150)",
  emerald: "oklch(0.50 0.13 155)",
  emeraldD: "oklch(0.38 0.13 156)",
  emeraldTint: "oklch(0.96 0.04 155)",
  tang: "oklch(0.66 0.18 45)",
  heroInk: "oklch(0.16 0.04 155)",
  fontUi: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, monospace",
};

/** Numbered stepped section header — matches the tool. */
function SectionHead({
  step,
  title,
  subtitle,
  id,
}: {
  step: number;
  title: string;
  subtitle?: string;
  id: string;
}) {
  return (
    <div
      id={id}
      style={{
        scrollMarginTop: 20,
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 16,
        marginTop: 40,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: T.emerald,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: T.fontMono,
          fontWeight: 800,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        {step}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: T.fontUi,
            fontSize: 24,
            fontWeight: 800,
            color: T.ink,
            letterSpacing: -0.005,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <div
            style={{
              fontSize: 13,
              color: T.muted,
              fontFamily: T.fontUi,
              fontWeight: 600,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/** Prose paragraph — high-contrast ink, comfortable line-height. */
function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 16,
        lineHeight: 1.65,
        color: T.ink,
        margin: "0 0 14px",
        fontFamily: T.fontUi,
      }}
    >
      {children}
    </p>
  );
}

/** Parameter card — each numbered parameter in the tool gets one of
 *  these on the explainer. Header (parameter name + one-line hook),
 *  body (fuller explanation), optional example block. */
function ParamCard({
  name,
  hook,
  children,
}: {
  name: string;
  hook: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "16px 18px",
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        background: T.card,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 6,
          flexWrap: "wrap",
        }}
      >
        <h4
          style={{
            margin: 0,
            fontFamily: T.fontUi,
            fontSize: 17,
            fontWeight: 800,
            color: T.ink,
          }}
        >
          {name}
        </h4>
        <span
          style={{
            fontSize: 12,
            color: T.emerald,
            fontFamily: T.fontUi,
            fontWeight: 700,
            textAlign: "right",
          }}
        >
          {hook}
        </span>
      </div>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.6,
          color: T.ink,
          fontFamily: T.fontUi,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Example({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        background: T.emeraldTint,
        borderLeft: `3px solid ${T.emerald}`,
        borderRadius: 6,
        fontSize: 14,
        lineHeight: 1.55,
        color: T.ink,
        fontFamily: T.fontUi,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontWeight: 800,
          color: T.emeraldD,
          marginBottom: 4,
        }}
      >
        Example
      </div>
      {children}
    </div>
  );
}

/** Qualitative 5-dot strength meter — used to convey relative
 *  weighting without exposing exact coefficients. Filled dots are
 *  emerald, empty dots are the line token. */
function StrengthBar({ strength }: { strength: number }) {
  const cells = [1, 2, 3, 4, 5];
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 3,
        alignItems: "center",
      }}
      aria-label={`Strength ${strength} of 5`}
    >
      {cells.map((c) => (
        <span
          key={c}
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: c <= strength ? T.emerald : T.line,
          }}
        />
      ))}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: T.fontMono,
        fontWeight: 700,
        color: T.ink,
      }}
    >
      {children}
    </span>
  );
}

export default function HowItWorksPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          padding: "20px 4px 80px",
          maxWidth: 880,
          margin: "0 auto",
        }}
      >
        <nav style={{ marginBottom: 12 }}>
          <Link
            href="/analysis/score-forecast"
            style={{
              fontSize: 12,
              color: T.emerald,
              textDecoration: "none",
              fontWeight: 700,
              fontFamily: T.fontUi,
              letterSpacing: 0.3,
            }}
          >
            ← Round score forecast
          </Link>
        </nav>

        <h2
          style={{
            fontSize: 34,
            margin: "0 0 8px",
            fontFamily: T.fontUi,
            letterSpacing: -0.01,
            color: T.heroInk,
            lineHeight: 1.15,
          }}
        >
          How the Round Score Forecast works
        </h2>
        <p
          style={{
            fontSize: 17,
            color: T.muted,
            marginBottom: 26,
            lineHeight: 1.55,
            maxWidth: 720,
            fontFamily: T.fontUi,
          }}
        >
          A plain-English tour of the model. Every parameter the tool
          exposes, what it means in golf terms, and how the model uses
          it to turn today&apos;s wind, pins, and player skill into a
          projected round score.
        </p>

        {/* ── Table of contents ─────────────────────────────────── */}
        <div
          style={{
            padding: "14px 16px",
            border: `1px solid ${T.line}`,
            borderRadius: 10,
            background: T.soft,
            marginBottom: 8,
            fontFamily: T.fontUi,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: T.muted,
              fontWeight: 800,
              marginBottom: 8,
            }}
          >
            What&apos;s on this page
          </div>
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "grid",
              gap: 4,
              fontSize: 14,
              color: T.ink,
              fontWeight: 600,
            }}
          >
            <li>
              <a href="#big-picture" style={tocLink}>
                1. The big picture — three layers of the forecast
              </a>
            </li>
            <li>
              <a href="#setup" style={tocLink}>
                2. The setup — describing today&apos;s course
              </a>
            </li>
            <li>
              <a href="#players" style={tocLink}>
                3. Adding a player — skill, tee time, form
              </a>
            </li>
            <li>
              <a href="#advanced" style={tocLink}>
                4. Advanced knobs — form weight, compression, skew
              </a>
            </li>
            <li>
              <a href="#results" style={tocLink}>
                5. Reading the results
              </a>
            </li>
          </ol>
        </div>

        {/* ── 1. Big picture ────────────────────────────────────── */}
        <SectionHead
          step={1}
          title="The big picture"
          subtitle="What the forecast answers, and how the model splits the problem"
          id="big-picture"
        />
        <P>
          The Round Score Forecast answers one question:{" "}
          <strong>
            if this player teed off right now under today&apos;s
            conditions, what score would we expect them to shoot?
          </strong>
        </P>
        <P>
          The model splits that into three layers, in this order:
        </P>
        <ol
          style={{
            margin: "0 0 18px 20px",
            padding: 0,
            fontSize: 16,
            color: T.ink,
            lineHeight: 1.7,
            fontFamily: T.fontUi,
          }}
        >
          <li>
            <strong>The field baseline.</strong> What the average PGA
            Tour player in this field would score today, given the
            wind, pin positions, and yardage the tour has posted for
            this round.
          </li>
          <li>
            <strong>The player&apos;s skill edge.</strong> How much
            better (or worse) than average this player is, adjusted
            for the type of course. An elite player at a course that
            flattens the field gets a smaller edge than the raw skill
            number implies.
          </li>
          <li>
            <strong>The player&apos;s recent form.</strong> How much
            their scores this week suggest they&apos;re currently
            playing above or below their baseline — weighted by which
            skills carry from round to round.
          </li>
        </ol>
        <P>
          Each layer is a knob you can inspect and override. The rest
          of this page walks the knobs in the order they appear in the
          tool.
        </P>

        {/* ── 2. Setup ─────────────────────────────────────────── */}
        <SectionHead
          step={2}
          title="The setup — describing today's course"
          subtitle="Tournament, round, conditions, yardage, pins, wind"
          id="setup"
        />
        <P>
          These six inputs describe the world the round will be
          played in. Together they feed the <strong>field baseline</strong>
          {" "}from the first layer above.
        </P>

        <ParamCard name="Tournament" hook="Auto-locked to the active event">
          <P>
            The tool follows the currently active PGA Tour event.
            You&apos;ll see the tournament name populated automatically
            once the field roster loads. Once the event finishes, the
            tool switches to next week&apos;s.
          </P>
        </ParamCard>

        <ParamCard name="Round to forecast" hook="1 · 2 · 3 · 4">
          <P>
            Pick which round you want a forecast for. R4 today, R1 for
            a Wednesday preview, R3 for a Saturday morning look at the
            day ahead.
          </P>
        </ParamCard>

        <ParamCard
          name="Conditions"
          hook="How much yesterday tells us about today"
        >
          <P>
            Same course, different day — how much has this week&apos;s
            play already revealed about the setup?
          </P>
          <ul
            style={{
              margin: "8px 0 10px 18px",
              padding: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: T.ink,
            }}
          >
            <li>
              <strong>Conditions like the most recent finished
              round</strong> (default for R3+): if yesterday played
              softer than typical because greens were receptive and
              pins were fair, the model expects today to play
              similarly.
            </li>
            <li>
              <strong>Based on R3 / R2 / R1</strong>: anchor on a
              specific round rather than the most recent one.
            </li>
            <li>
              <strong>Average of the week</strong>: blend every played
              round. Softer signal, less R3-heavy.
            </li>
            <li>
              <strong>Typical setup for this course</strong>: ignore
              this week&apos;s data entirely and use the historical
              baseline for this round.
            </li>
          </ul>
          <P>
            Behind the scenes this becomes a <strong>level shift</strong> —
            a per-hole stroke adjustment carried over from the
            reference round(s). The measured softness of the reference
            round is spread evenly across today&apos;s 18 holes.
          </P>
          <Example>
            When yesterday plays softer than the historical mean for
            that round, the softness carries forward. With{" "}
            <em>&quot;Conditions like the most recent finished
            round&quot;</em> selected, the model measures the prior
            round&apos;s per-hole residuals and applies them as a
            level shift across today&apos;s round — expecting today to
            play softer than the untouched historical baseline by the
            same amount the prior round did.
          </Example>
        </ParamCard>

        <ParamCard name="Yardage" hook="Auto from the pin sheet, or a manual delta">
          <P>
            <strong>Pardle&apos;s prediction</strong> (default): pulls
            the exact yardages the tour has posted for the round. Each
            hole plays at the length the setup team has actually set
            up, not some rounded value.
          </P>
          <P>
            <strong>Manual delta from a prior round</strong>: when the
            tour hasn&apos;t posted yardages yet, you can say
            &quot;the course will play 100 yards longer than R3&quot;
            and the model spreads that delta evenly across the 18
            holes. Useful for early-week previews.
          </P>
          <P>
            The yardage impact per hole is derived from{" "}
            <strong>per-hole regression coefficients</strong> — every
            hole at this course has its own historical yardage
            sensitivity. Long par-5s scale differently than
            drivable par-4s.
          </P>
        </ParamCard>

        <ParamCard name="Pins" hook="Cluster-match, or a manual scoring adjustment">
          <P>
            <strong>Pardle&apos;s automated clusters</strong>{" "}
            (default): several years of pin-by-pin scoring at this
            course have been clustered by green zone (front-right,
            back-left, etc.). Each hole&apos;s pin position today is
            matched to its nearest historical cluster, and the model
            uses that cluster&apos;s residual scoring difficulty.
          </P>
          <P>
            <strong>Manual scoring adjustment</strong>: skip the
            auto-match; enter a single total-round stroke adjustment
            (+0.5 = the setup plays 0.5 strokes harder than the
            historical average). Useful when the setup team has done
            something novel that the historical clusters can&apos;t
            capture — new pins outside any known zone, or an unusually
            fast green speed the sample doesn&apos;t reflect.
          </P>
        </ParamCard>

        <ParamCard name="Wind" hook="HRRR hourly, GFS blend, or manual">
          <P>
            The forecast defaults to <strong>HRRR</strong> — a
            high-resolution NOAA weather model that updates hourly and
            provides wind speed + direction at the course location for
            every hour of the day. This lets the model give late tee
            times the wind they&apos;ll actually face at 3pm rather
            than a smoothed daily average.
          </P>
          <P>
            <strong>GFS blend</strong>: a global forecast model,
            smoother in the mid-afternoon peaks but longer forecast
            range. Useful for Sunday when we&apos;re looking at
            Thursday.
          </P>
          <P>
            <strong>Manual override</strong>: force a specific wind
            speed (mph) and direction (degrees FROM). Useful for
            what-if analysis or when you disagree with the forecast.
          </P>
          <P>
            Wind translates to scoring via per-hole{" "}
            <strong>headwind coefficients</strong>. Each hole&apos;s
            historical sensitivity to headwind is baked into the
            regression — a downhill par-3 into the wind plays much
            harder than an easy short par-4 with the wind at your
            back.
          </P>
          <Example>
            A long par-3 that plays roughly south sits with its
            bearing pointing straight into an SSW wind (bearing ~200°),
            so the full wind speed acts as headwind. A short par-4
            playing north-west with the same SSW wind sees only a
            fraction of that as headwind — the model computes the
            component of the wind vector along each hole&apos;s
            bearing and multiplies by that hole&apos;s own fitted
            coefficient.
          </Example>
        </ParamCard>

        {/* ── 3. Players ────────────────────────────────────────── */}
        <SectionHead
          step={3}
          title="Adding a player"
          subtitle="Skill baseline, tee time, and this week's form"
          id="players"
        />
        <P>
          Once the setup describes the field baseline, adding a player
          lets the model project their <em>personal</em> expected
          score. This is where SG, form, and tee-time-aware wind come
          in.
        </P>

        <ParamCard name="Season SG" hook="Talent — how many strokes above/below the tour average">
          <P>
            <strong>Strokes Gained (SG)</strong> is the standard
            measure of golf skill. It counts how many strokes better
            or worse than the tour average a player is, per round,
            after adjusting for the fields they&apos;ve played.
          </P>
          <ul
            style={{
              margin: "8px 0 10px 18px",
              padding: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: T.ink,
            }}
          >
            <li>
              Roughly <Mono>+3 SG</Mono>: elite, top-of-the-world level
            </li>
            <li>
              Roughly <Mono>+1.5 SG</Mono>: top-50-in-the-world level
            </li>
            <li>
              Roughly <Mono>+0.5 SG</Mono>: solid tour regular
            </li>
            <li>
              Roughly <Mono>−0.5 SG</Mono>: below-average tour player,
              cut risk most weeks
            </li>
          </ul>
          <P>
            The tool auto-fills this from Pardle&apos;s pre-tournament
            model when the player is in this week&apos;s field. You
            can override with your own number.
          </P>
        </ParamCard>

        <ParamCard name="Tee time" hook="Local time — makes wind personal">
          <P>
            When set, the model reads the wind at{" "}
            <strong>the specific hour this player will face each
            hole</strong>. It assumes ~15 minutes of walking per hole
            from tee-off, so a 1:30 PM starter is playing hole 9
            around 3:30 PM, hole 18 around 5:00 PM.
          </P>
          <P>
            This matters most when a late tee time faces a building
            afternoon wind. On a calm morning that gusts up by
            mid-afternoon, the day-average forecast blends the two
            regimes and understates the difficulty for the late
            group.
          </P>
          <Example>
            Two players with identical SG, one teeing off at 7:00 AM
            when the wind is light and one at 1:30 PM when the wind
            has built. Under the day-average model they project the
            same score. With tee-time-aware wind, the late tee&apos;s
            projection is meaningfully harder — a systematic edge for
            betting the morning group UNDER and the afternoon group
            OVER.
          </Example>
        </ParamCard>

        <ParamCard
          name="Rounds this week (auto-filled)"
          hook="Form is over/under-performance vs baseline, not raw score"
        >
          <P>
            Every player who&apos;s completed at least one round shows
            up with per-round tiles: their vs-par score plus the four
            strokes-gained categories (OTT, APP, ARG, PUTT) and a{" "}
            <strong>persistence factor</strong>.
          </P>
          <P>
            <strong>
              The form signal isn&apos;t the raw vs-par score.
            </strong>{" "}
            It&apos;s how much a player over- or under-performed{" "}
            <em>their own expected score</em> for that round — the
            round&apos;s actual field average adjusted for the
            player&apos;s season SG. An elite player is expected
            further under par than the field mean; an average tour
            player is expected right at it. An average tournament
            round for an elite player is a <em>negative</em> form
            signal because he under-performed his baseline. A tour-
            average player shooting the same round is performing
            exactly to expectation and gets no form bump either
            direction.
          </P>
          <Example>
            Say the field averages a few strokes under par for the
            round. An elite player is expected to shoot several
            strokes further under than that. If he shoots only the
            field average, the model treats that as a negative form
            signal — several shots of underperformance vs expected —
            and nudges his projection <em>up</em> tomorrow (worse than
            his season baseline suggests).
          </Example>
          <P>
            <strong>The persistence factor is the model&apos;s
            smartest trick.</strong> Not all strokes-gained categories
            persist equally from round to round. Once we know the
            over/under-performance, we scale it by <em>which skills
            drove it</em> — approach and driving carry forward
            reliably, putting mostly regresses to the mean.
          </P>
          <div
            style={{
              margin: "10px 0",
              overflowX: "auto",
              border: `1px solid ${T.line}`,
              borderRadius: 8,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: T.fontUi,
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ background: T.soft }}>
                  <th
                    style={{
                      padding: "10px 12px",
                      textAlign: "left",
                      color: T.muted,
                      fontSize: 12,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                    }}
                  >
                    SG Category
                  </th>
                  <th
                    style={{
                      padding: "10px 12px",
                      textAlign: "left",
                      color: T.muted,
                      fontSize: 12,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                    }}
                  >
                    Predictive strength
                  </th>
                  <th
                    style={{
                      padding: "10px 12px",
                      textAlign: "left",
                      color: T.muted,
                      fontSize: 12,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                    }}
                  >
                    Interpretation
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Off-the-tee (OTT)", 5, "Very repeatable — driving swing"],
                  ["Approach (APP)", 4, "Highly repeatable — iron accuracy"],
                  ["Around-the-green (ARG)", 3, "Moderate — chipping, some noise"],
                  ["Putting (PUTT)", 2, "Mostly noise round to round"],
                ].map(([cat, strength, note]) => (
                  <tr key={String(cat)} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td style={{ padding: "10px 12px", color: T.ink }}>
                      {cat}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <StrengthBar strength={strength as number} />
                    </td>
                    <td style={{ padding: "10px 12px", color: T.muted }}>
                      {note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            The <strong>persistence factor</strong> shown on each
            round tile compares that round&apos;s skill mix to a
            category-balanced round. A balanced round sits at 1×;
            approach- or driving-heavy rounds tilt above 1× and count
            for more; putt-heavy rounds tilt below 1× and count for
            less.
          </P>
          <Example>
            <div style={{ marginBottom: 8 }}>
              Two players who both beat their expected score by the
              same 3 shots this round. Same over-performance — but
              very different signals about tomorrow:
            </div>
            <div
              style={{
                fontSize: 13,
                background: "white",
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${T.line}`,
                marginBottom: 6,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                Player A — approach-driven round
              </div>
              <div style={{ color: T.muted, marginBottom: 6 }}>
                Most of the SG total came from iron play, a repeatable
                skill.
              </div>
              <div style={{ color: T.emerald, fontWeight: 700 }}>
                Persistence factor above 1× — the model carries a
                stronger form bump into tomorrow&apos;s projection.
              </div>
            </div>
            <div
              style={{
                fontSize: 13,
                background: "white",
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${T.line}`,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                Player B — putt-driven round
              </div>
              <div style={{ color: T.muted, marginBottom: 6 }}>
                Most of the SG total came from hot putting, which
                regresses hard round-to-round.
              </div>
              <div style={{ color: T.tang, fontWeight: 700 }}>
                Persistence factor below 1× — same 3 shots of
                over-performance, but the model discounts it and
                barely nudges tomorrow&apos;s projection.
              </div>
            </div>
          </Example>
        </ParamCard>

        {/* ── 4. Advanced ───────────────────────────────────────── */}
        <SectionHead
          step={4}
          title="Advanced knobs"
          subtitle="Form weight, skill compression, skew adjustment"
          id="advanced"
        />
        <P>
          These three sliders live behind &quot;Show advanced&quot; on
          each player card. Every player uses sensible defaults; touch
          them only when you have a specific reason.
        </P>

        <ParamCard
          name="Form weight"
          hook="How much this week's rounds shift the projection"
        >
          <P>
            <strong>Slide left</strong> to ignore form entirely and
            project purely from season SG.{" "}
            <strong>Slide right</strong> to lean heavily on this
            week&apos;s scoring.
          </P>
          <P>
            The default sits at Pardle&apos;s calibrated value —
            informed by the Connolly-Rendleman shrinkage literature
            and our own back-testing. Enough to catch a genuine hot
            streak, not so much that a few outlier rounds dominate.
          </P>
          <P>
            The mechanics: the model measures how much a player has
            over- or under-performed their expectation across their
            played rounds this week, then applies a fraction of that
            average delta to the projection. Small fraction, real
            signal.
          </P>
        </ParamCard>

        <ParamCard
          name="Skill compression"
          hook="How much the course flattens the field"
        >
          <P>
            Some courses reward a specific set of skills less than
            SG:Total captures — a &quot;bunching&quot; course where
            everyone scores in a tight band regardless of talent.
          </P>
          <P>
            <strong>Slide right</strong> for no compression — the
            player&apos;s season edge translates 1:1 into the
            projection. <strong>Slide left</strong> for aggressive
            compression at bunching-friendly venues, where an elite
            player&apos;s edge shrinks meaningfully.
          </P>
          <P>
            The default is set per-course-type based on eight-plus
            years of scoring dispersion at each venue. At TPC Twin
            Cities the field bunches, so the default compresses the
            raw SG number by a notable but not-extreme amount.
          </P>
          <Example>
            An elite +3 SG player at a bunching course expects to
            outperform the field by <em>less</em> than 3 strokes —
            some of that raw edge gets washed out by a setup where the
            gap between top and mid tightens.
          </Example>
        </ParamCard>

        <ParamCard
          name="Skew adjustment"
          hook="The mean-vs-median gap for this player"
        >
          <P>
            Golf rounds don&apos;t follow a symmetric distribution.
            The occasional blow-up (a triple bogey, a lost ball) sits
            in a fat right tail and inflates the <em>mean</em> while
            leaving the <em>median</em> stable. The skew adjustment is
            how much wider we assume the mean is than the median.
          </P>
          <ul
            style={{
              margin: "8px 0 10px 18px",
              padding: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: T.ink,
            }}
          >
            <li>
              <strong>Elite players</strong>: tightest gap — blow-ups
              are rare, so mean and median sit close together.
            </li>
            <li>
              <strong>Mid-tier players</strong>: moderate gap.
            </li>
            <li>
              <strong>Below-average players</strong>: widest gap —
              wider right tail, more blow-ups.
            </li>
          </ul>
          <P>
            The default gap is picked automatically from the
            player&apos;s season SG tier. You can override with the
            slider if you have a reason to.
          </P>
          <P>
            <strong>Why this matters for betting:</strong> the median
            is your typical outcome. The mean is inflated by rare
            catastrophes that don&apos;t happen most rounds. When
            betting UNDER a line, the median is often the right number
            to compare against.
          </P>
          <Example>
            A player&apos;s projected mean sits a fraction of a stroke
            higher than their projected median because of that fat
            right tail. Against an UNDER 69.5 line, the median offers
            a meaningfully bigger buffer than the mean — that extra
            cushion is why the tool leads with median for UNDER
            decisions.
          </Example>
        </ParamCard>

        {/* ── 5. Reading the results ────────────────────────────── */}
        <SectionHead
          step={5}
          title="Reading the results"
          subtitle="Hero forecast, model delta, player projections, per-hole detail"
          id="results"
        />
        <P>
          The Results panel is the model&apos;s answer, broken into a
          hero card, a secondary strip of context, per-player
          projections, and an 18-hole detail strip.
        </P>

        <ParamCard
          name="Field forecast (hero)"
          hook="The average score today"
        >
          <P>
            The projected total-strokes score for the average player
            in the field, teeing off with today&apos;s setup. This is
            the top-line answer — the vs-par number below tells you
            whether it&apos;s an easy day (green, under par) or a
            grinder (red, over par).
          </P>
        </ParamCard>

        <ParamCard
          name="Model delta"
          hook="Today's forecast vs the historical baseline"
        >
          <P>
            How much easier or harder the model expects this round to
            play compared to the historical average for this specific
            round number at this course.
          </P>
          <P>
            <Mono>−0.5</Mono> means today should play half a stroke
            easier than a typical R4 here. <Mono>+1.2</Mono> means
            it&apos;s shaping up as one of the harder R4s in the
            historical record.
          </P>
        </ParamCard>

        <ParamCard
          name="Historical mean"
          hook="Untouched historical baseline"
        >
          <P>
            The historical average total-strokes score for this specific
            round number at this course, with no adjustment for
            today&apos;s conditions. Useful as an anchor: the field
            forecast should feel roughly like historical mean + level
            shift + wind delta.
          </P>
        </ParamCard>

        <ParamCard
          name="Wind"
          hook="Field-averaged across every tee time"
        >
          <P>
            The wind figure shown is aggregated across every field
            member&apos;s actual tee time — so an 8am-to-3pm tee-time
            spread with rising wind produces a higher effective wind
            than the average of the morning and afternoon peaks alone.
          </P>
        </ParamCard>

        <ParamCard
          name="Level shift"
          hook="Softness carried from prior rounds"
        >
          <P>
            The per-hole stroke adjustment carried in from the
            reference round(s) selected in Conditions. Negative =
            course expected to play easier than historical because
            this week has been playing soft.
          </P>
          <P>
            When you see an <em>attenuated</em> value next to the
            level shift, the Conditions preset has scaled the raw
            measurement down. That&apos;s a hedge against overnight
            drying or firming: when we&apos;re not fully confident
            yesterday&apos;s softness will persist unchanged, the
            model carries a fraction of it forward instead of the
            whole thing.
          </P>
        </ParamCard>

        <ParamCard
          name="Player projections"
          hook="Expected mean and median for each player"
        >
          <P>
            For each player added:
          </P>
          <ul
            style={{
              margin: "6px 0 8px 18px",
              padding: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: T.ink,
            }}
          >
            <li>
              <strong>SG / Edge / Form</strong>: the three drivers.
              SG is season baseline; Edge is that baseline compressed
              for course type; Form is the Bayesian shrinkage bump
              from this week&apos;s persistence-weighted rounds.
            </li>
            <li>
              <strong>Mean</strong>: the average score you should
              expect if this player played the same round 1,000 times.
              Use for outright bets where blow-ups still count as
              losses.
            </li>
            <li>
              <strong>Median</strong>: the middle outcome. Use for
              round-score UNDER bets, where the fat right tail doesn&apos;t
              hurt you as much as it inflates the mean.
            </li>
          </ul>
          <P>
            Both are colour-coded: emerald for under par, tang for
            over par. The Median box is accented emerald because
            it&apos;s the payoff number for most betting decisions.
          </P>
        </ParamCard>

        <ParamCard
          name="Per-hole projection"
          hook="Every hole colour-coded, expandable"
        >
          <P>
            Collapsed by default as an 18-block colour ribbon —
            emerald for under-par, tang for over-par, saturation
            scaled to how far from par. Click <strong>Expand</strong>{" "}
            to see each hole&apos;s projected score, par, yardage,
            and headwind.
          </P>
          <P>
            This is where you spot the model&apos;s per-hole story: a
            drivable par-4 today (H16 at 301 yds instead of 411)
            shows up as a deep emerald tile with a big negative vs-par
            projection. A par-3 into a 15 mph headwind shows up as
            tang.
          </P>
        </ParamCard>

        {/* ── Back to tool CTA ──────────────────────────────────── */}
        <div
          style={{
            marginTop: 40,
            padding: "20px 22px",
            background: T.emerald,
            color: "white",
            borderRadius: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            fontFamily: T.fontUi,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: "oklch(0.85 0.06 155)",
                fontWeight: 800,
                marginBottom: 4,
              }}
            >
              Ready to run one?
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              Head to the tool and try it on this week&apos;s field.
            </div>
          </div>
          <Link
            href="/analysis/score-forecast"
            style={{
              padding: "10px 18px",
              background: "white",
              color: T.emerald,
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            Round score forecast →
          </Link>
        </div>
      </section>
    </main>
  );
}

const tocLink: React.CSSProperties = {
  color: "oklch(0.42 0.13 155)",
  textDecoration: "none",
  fontFamily: T.fontUi,
  padding: "2px 0",
  display: "inline-block",
};
