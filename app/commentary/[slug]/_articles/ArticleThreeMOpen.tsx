/**
 * Article: "The 3M Open: what course-fit says about TPC Twin Cities"
 * Published 2026-07-21, week of the 3M Open.
 *
 * Sourced from the internal course-fit model
 * (scripts/predict-course-fit.py). Numbers are per-round
 * SG:OTT-residual predictions against each player's own 2024-26
 * driving baseline.
 *
 * Copy rule: no third-party data-source names appear on user surfaces.
 * "Years of tour driving data", "the historical record" — not the
 * vendor names in code.
 */

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

interface Pick {
  name: string;
  perRd: number;
  fourRd: number;
  hist?: string; // e.g. "17 rd · +0.24"
}

const OVER: Pick[] = [
  { name: "Matt Kuchar", perRd: 0.39, fourRd: 1.58 },
  { name: "Tyler Duncan", perRd: 0.29, fourRd: 1.18, hist: "17 rd · +0.24" },
  { name: "Andrew Putnam", perRd: 0.29, fourRd: 1.15, hist: "14 rd · +0.19" },
  { name: "Justin Lower", perRd: 0.28, fourRd: 1.11, hist: "12 rd · +0.16" },
  { name: "Troy Merritt", perRd: 0.27, fourRd: 1.10, hist: "22 rd · +0.47" },
  { name: "Emiliano Grillo", perRd: 0.25, fourRd: 0.99, hist: "22 rd · +0.32" },
  { name: "Max McGreevy", perRd: 0.23, fourRd: 0.93, hist: "8 rd · +0.51" },
];

const UNDER: Pick[] = [
  { name: "Alejandro Tosti", perRd: -0.18, fourRd: -0.73 },
  { name: "Nick Dunlap", perRd: -0.14, fourRd: -0.57, hist: "4 rd · −0.73" },
  { name: "Michael Brennan", perRd: -0.10, fourRd: -0.41 },
  { name: "Jesper Svensson", perRd: -0.06, fourRd: -0.23, hist: "4 rd · −0.53" },
  { name: "Garrick Higgo", perRd: -0.04, fourRd: -0.17, hist: "12 rd · −0.56" },
];

function PickRow({ p }: { p: Pick }) {
  const positive = p.perRd >= 0;
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
        {p.name}
      </span>
      <span
        style={{
          fontFamily: numFont,
          fontSize: 13,
          color,
          fontWeight: 700,
          minWidth: 62,
          textAlign: "right",
        }}
      >
        {positive ? "+" : ""}
        {p.fourRd.toFixed(2)}
      </span>
      <span
        style={{
          fontFamily: numFont,
          fontSize: 11,
          color: "oklch(0.55 0.02 150)",
          minWidth: 108,
          textAlign: "right",
        }}
      >
        {p.hist ?? "no course history"}
      </span>
    </li>
  );
}

function PickList({ picks, label }: { picks: Pick[]; label: string }) {
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
          <span style={{ minWidth: 62, textAlign: "right" }}>4-rd Δ</span>
          <span style={{ minWidth: 108, textAlign: "right" }}>
            history at TPC TC
          </span>
        </span>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {picks.map((p) => (
          <PickRow key={p.name} p={p} />
        ))}
      </ul>
    </div>
  );
}

export default function ArticleThreeMOpen() {
  return (
    <div>
      <P>
        TPC Twin Cities is one of the harder events to handicap on the
        schedule. It's a wide, generous track by tour standards, plays
        soft in July, and rewards clean iron play more than raw
        firepower — but it doesn't scream any obvious profile the way
        Craig Ranch or Harbour Town do. Our course-fit model reads it
        as <b>mildly positional</b>, and points at a specific slice of
        the 144-player field.
      </P>

      <H3>What the model does</H3>
      <P>
        We built each tour player's off-the-tee "fingerprint" from
        every driver-off-the-tee shot the shot-tracking data has on
        them over the last two seasons: ball speed, apex height, and
        the direction and size of their curve. Then, for every course
        with a long enough historical record, we asked a simple
        question: <i>after subtracting a player's own current
        driving level, does his ball-flight profile predict whether
        he over- or under-performs at this specific venue?</i>
      </P>
      <P>
        Some courses answer that question loudly. Craig Ranch pays
        bombers ~+1.2 strokes over four rounds for every extra
        standard deviation of ball speed. Harbour Town does the exact
        opposite. Sedgefield, Sawgrass, TPC River Highlands all lean
        positional. Torrey South, Quail Hollow, Detroit GC all lean
        distance.
      </P>

      <H3>Where TPC Twin Cities lands</H3>
      <P>
        Twin Cities sits in the middle of the pack. The signal is
        real but small: the model has a mild lean toward
        short-and-straight profiles, coefficients around a third the
        size of a "true" bomber-course like Craig Ranch. Translated
        into strokes: about <b>±0.3–0.4 per round</b> for the
        outliers, or a stroke or so across the week.
      </P>
      <P>
        That's not enough to be the main reason you're betting a
        player. It <i>is</i> enough to be a useful tiebreaker between
        two guys you already like at similar prices — and worth
        knowing when a big bomber is priced short.
      </P>

      <Callout>
        <b>How to read the numbers below:</b> "4-rd Δ" is the strokes
        the model expects each player to gain or lose off the tee at
        TPC Twin Cities relative to <i>his own</i> 2024-26 driving
        baseline. A +1.00 means the model thinks his profile is worth
        an extra shot this week vs how he normally drives it. The
        "history" column is his actual mean course-fit residual over
        prior TPC Twin Cities rounds, for context.
      </Callout>

      <H3>The over-performers</H3>
      <P>
        Short, straight, position-first drivers. Several of these
        players also have positive course history — the model isn't
        making these calls from thin air.
      </P>
      <PickList picks={OVER} label="Model likes" />
      <P>
        The credible reads here are <b>Duncan, Putnam, Lower,
        Merritt, Grillo</b> — all five have played TPC Twin Cities
        four times or more and have positive course-fit residuals in
        the record. Their radar profiles say the same thing the
        history does. <b>McGreevy</b> is a smaller sample but the
        biggest positive residual on that list; worth a look if
        priced accordingly.
      </P>

      <H3>The under-performers</H3>
      <P>
        Bomber profiles, mostly, plus a couple of rookies whose
        recent shape has yet to translate at this venue.
      </P>
      <PickList picks={UNDER} label="Model dislikes" />
      <P>
        <b>Dunlap, Svensson and Higgo</b> are the credible fades —
        the model's negative prediction lines up with a real sample
        of poor course-fit results at TPC Twin Cities. If any of
        them are priced short in matchup or leaderboard markets, the
        model is telling you to look elsewhere.
      </P>

      <H3>The limits</H3>
      <P>
        Course-fit at Twin Cities is not a season-making edge. Out-of-sample,
        the model explains almost none of the variance in course
        residuals here — the effect is genuinely small. Compare that
        to Craig Ranch, where course-fit alone drives 18% of the
        variance in results. Use these picks as one input; combine
        with recent form, the market, and everything else you'd
        normally look at.
      </P>
      <P>
        We'll rebuild this call every week the tour visits a course
        with a meaningful signal. Some weeks the picks will be
        thunderous (Craig Ranch, Quail Hollow, Torrey, Harbour Town);
        others — like this one — will be a nudge, not a shove.
      </P>
    </div>
  );
}
