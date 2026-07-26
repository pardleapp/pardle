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
              round</strong> (default for R3+): if R3 played 3.8 under
              par because greens were receptive and pins were fair,
              the model expects today to play similarly soft.
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
              this week&apos;s data entirely and use the 8-year
              historical baseline for this round.
            </li>
          </ul>
          <P>
            Behind the scenes this becomes a <strong>level shift</strong> —
            a per-hole stroke adjustment carried over from the
            reference round(s). If yesterday played 1.4 strokes under
            historical average, the model shifts each of today&apos;s
            18 holes by 1.4/18 = ~0.08 strokes easier.
          </P>
          <Example>
            When R3 plays softer than the historical R3 mean, that
            softness carries forward. With{" "}
            <em>&quot;Conditions like the most recent finished
            round&quot;</em> selected for R4 at the 2026 3M Open, the
            model measures R3&apos;s per-hole residuals and applies
            them as a <Mono>−1.37</Mono> stroke level shift across the
            round — expecting today to play ~1.4 strokes softer than
            the historical R4 baseline.
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
            (default): eight years of pin-by-pin scoring at this
            course have been clustered by green zone (front-right,
            back-left, etc.). Each hole&apos;s pin position today is
            matched to its nearest historical cluster, and the
            model uses that cluster&apos;s residual scoring
            difficulty.
          </P>
          <P>
            <strong>Pin-specific residual (Option A) refinement</strong>:
            when we have thick enough historical sample at a specific
            pin coordinate (≥40 rounds), the model uses the exact-
            coordinate residual instead of the cluster average — this
            isolates course-condition softness from pin-position
            variance within a cluster.
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
            The 8th at TPC Twin Cities plays approximately{" "}
            <Mono>+0.02</Mono> vs par per mph of headwind based on 8
            years of historical scoring. On a 15 mph SSW day pointing
            straight into hole 8 (bearing 200°), the model expects the
            hole to play ~0.30 strokes harder than its baseline.
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
              <Mono>+3.0 SG</Mono>: elite (Scheffler, top-of-the-world level)
            </li>
            <li>
              <Mono>+1.5 SG</Mono>: top-50-in-the-world level
            </li>
            <li>
              <Mono>+0.5 SG</Mono>: solid tour regular
            </li>
            <li>
              <Mono>−0.5 SG</Mono>: below-average tour player, cut
              risk most weeks
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
            mid-afternoon, the day-average forecast would understate
            the difficulty for a late group by 0.5–1.0 strokes.
          </P>
          <Example>
            Two players with identical SG. Player A tees off at 7:00
            AM in 4 mph wind; Player B tees off at 1:30 PM in 12 mph
            wind. Under the day-average model both project the same
            round score. With tee-time-aware wind, Player B&apos;s
            projection is ~0.6 strokes harder — a meaningful edge for
            betting UNDER Player A.
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
            <em>their own expected score</em> for that round. Expected
            is <Mono>field_mean − sgTotal</Mono>: an elite +3 SG
            player in a field averaging even par is expected to shoot{" "}
            <Mono>−3</Mono>, so an average tournament round for him is
            a <em>negative</em> form signal — he under-performed his
            baseline. A 0 SG player shooting the same round is
            performing exactly to expectation and gets no form bump
            either direction.
          </P>
          <Example>
            Scheffler tees off in a field that averages <Mono>−1.5</Mono>{" "}
            for the round. His season SG is <Mono>+2.9</Mono>, so he&apos;s
            expected to shoot <Mono>−1.5 − 2.9 = −4.4</Mono>. If he
            shoots the field average of <Mono>−1.5</Mono>, that&apos;s
            a <Mono>+2.9</Mono> underperformance vs expected — the
            model treats it as a negative form signal that would nudge
            his projection <em>up</em> tomorrow (worse than his season
            baseline suggests).
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
                      textAlign: "right",
                      color: T.muted,
                      fontSize: 12,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                    }}
                  >
                    Persistence
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
                  ["Off-the-tee (OTT)", "0.65", "Very repeatable — driving swing"],
                  ["Approach (APP)", "0.60", "Highly repeatable — iron accuracy"],
                  ["Around-the-green (ARG)", "0.40", "Moderate — chipping, some noise"],
                  ["Putting (PUTT)", "0.30", "Mostly noise round to round"],
                ].map(([cat, pers, note]) => (
                  <tr key={cat} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td style={{ padding: "10px 12px", color: T.ink }}>
                      {cat}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontFamily: T.fontMono,
                        fontWeight: 700,
                        color: T.ink,
                      }}
                    >
                      {pers}
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
            round tile is that round&apos;s effective persistence
            divided by the neutral baseline (0.4875, the mean of the
            four weights). A category-balanced round produces the same
            form bump the old excess-only model produced; approach- or
            driving-heavy rounds tilt above 1×; putt-heavy rounds tilt
            below 1×.
          </P>
          <Example>
            <div style={{ marginBottom: 8 }}>
              Two players who both beat their expected score by 3
              shots this round. Same over-performance — but very
              different signals about tomorrow:
            </div>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 13,
                background: "white",
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${T.line}`,
                marginBottom: 6,
              }}
            >
              <div>
                <strong>Player A</strong> (approach-driven):
              </div>
              <div>OTT +0.4 · APP +2.2 · ARG +0.2 · PUTT +0.2</div>
              <div style={{ color: T.emerald, marginTop: 4 }}>
                Persistence factor ≈ 1.15× → −3 excess scales to −3.45
                strokes of forward signal
              </div>
            </div>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 13,
                background: "white",
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${T.line}`,
              }}
            >
              <div>
                <strong>Player B</strong> (putt-driven):
              </div>
              <div>OTT +0.2 · APP +0.4 · ARG +0.2 · PUTT +2.2</div>
              <div style={{ color: T.tang, marginTop: 4 }}>
                Persistence factor ≈ 0.75× → same −3 excess scales to
                only −2.25 strokes of forward signal
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
            <Mono>0</Mono> = ignore form entirely, project purely from
            season SG. <Mono>0.5</Mono> = aggressive; heavily lean on
            this week&apos;s scoring.
          </P>
          <P>
            <strong>Default 0.20</strong> — the sweet spot from the
            Connolly-Rendleman shrinkage literature. Enough to catch a
            genuine hot streak, not so much that a few outlier rounds
            dominate the projection.
          </P>
          <P>
            The math is straightforward Bayesian shrinkage:
          </P>
          <div
            style={{
              margin: "8px 0 12px",
              padding: "10px 14px",
              background: T.soft,
              borderRadius: 6,
              fontFamily: T.fontMono,
              fontSize: 14,
              color: T.ink,
              lineHeight: 1.5,
            }}
          >
            form_bump = weight × mean(actual_vs_par − expected_vs_par)
            <br />
            expected_vs_par = field_mean − sgTotal
          </div>
          <P>
            A player who beat expectations by 2 strokes per round on
            average, with the default 0.20 weight, gets a{" "}
            <Mono>−0.4</Mono> stroke bump on today&apos;s projection.
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
            <strong>1.0</strong> = no compression; the player&apos;s
            edge translates 1:1. <strong>0.83</strong> = 17% shrink,
            typical at bunching-friendly venues like TPC Twin Cities.
            <strong> Below 0.6</strong> would flatten the field
            unrealistically — the tool caps the slider at 0.6.
          </P>
          <Example>
            An elite +3.0 SG player at TPC Twin Cities. With no
            compression (1.0) the model expects them to beat the field
            mean by 3.0 strokes. With 0.83 compression (the default
            here), it expects only 2.5 strokes of edge — the extra
            0.5 strokes are &quot;washed out&quot; by the course.
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
              Elite (SG ≥ 1.5): <Mono>~0.20</Mono> — tight
              distribution, blow-ups rare
            </li>
            <li>
              Mid-tier (SG 0–1.5): <Mono>~0.25</Mono>
            </li>
            <li>
              Below average (SG &lt; 0): <Mono>~0.30</Mono> — wider
              right tail, more blow-ups
            </li>
          </ul>
          <P>
            <strong>Why this matters for betting:</strong> the median
            is your typical outcome. The mean is inflated by rare
            catastrophes that don&apos;t happen most rounds. When
            betting UNDER a line, the median is often the right number
            to compare against.
          </P>
          <Example>
            A player&apos;s projected mean is 68.4 with skew 0.30. The
            median is <Mono>68.4 − 0.30 = 68.1</Mono>. Against an
            UNDER 69.5 line, the mean is 1.1 shots under; the median
            is 1.4 shots under. The extra buffer comes from
            recognising that most rounds this player plays actually
            fall below their long-run mean.
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
          hook="Today's forecast vs the 8-year historical"
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
            8-year record.
          </P>
        </ParamCard>

        <ParamCard
          name="Historical mean"
          hook="Untouched 8-year baseline"
        >
          <P>
            The 8-year average total-strokes score for this specific
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
            When you see <Mono>attenuated → −0.68</Mono>, that means
            the raw level shift (say −1.37) was scaled down by 50%
            because the Conditions preset applies attenuation for
            uncertainty about overnight drying/firming.
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
