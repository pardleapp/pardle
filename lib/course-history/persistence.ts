/**
 * Course-fit persistence.
 *
 * The course-history tool measures how far a player's ballstriking at
 * a venue diverges from their baseline. That number mixes two things:
 * a real, repeatable course effect, and the noise of however few
 * visits happen to be in the sample. Reporting the raw difference
 * treats a one-week blip and a six-year pattern as equally believable.
 *
 * They are not — and at most venues the honest answer is that very
 * little repeats at all. Measured at East Lake (89 players, 834
 * rounds, 2019-2025), the correlation between a player's earlier
 * visits and their later ones is:
 *
 *     min 2 visits (n=51)   OTT −0.17    APP +0.06
 *     min 3 visits (n=28)   OTT −0.00    APP +0.11
 *     min 4 visits (n=16)   OTT +0.46    APP −0.36
 *
 * Nothing survives the choice of threshold. That is the finding this
 * module exists to surface: a raw outperformance table invites the
 * reader to treat a number as a signal when the venue's own history
 * says it isn't one.
 *
 * THE UNIT IS THE VISIT, NOT THE ROUND. Four rounds of one hot week
 * are one observation of course fit, not four — they share a week's
 * form, a set of pins and a weather draw. An earlier version of this
 * module decomposed at round level and consequently reported a
 * confident signal at East Lake that visit-level analysis shows is
 * absent. Anything added here must keep the visit as the unit.
 *
 * Method: variance components rather than a single blanket
 * correlation, so that sample size enters per player.
 *
 *     observed spread of player means  =  trueVar + noiseVar / visits
 *
 * Solving for trueVar gives a per-player reliability
 *
 *     reliability(v) = trueVar / (trueVar + noiseVar / v)
 *
 * which is the fraction of a player's observed outperformance we
 * should believe. A player with six visits keeps more of their number
 * than one with two, which is the behaviour we want and which a flat
 * correlation cannot express. When trueVar comes out at zero — the
 * observed spread is no wider than noise alone predicts — everything
 * is shrunk to zero and the UI says so plainly.
 *
 * The test-retest correlation is computed alongside and surfaced,
 * because it is the honest headline for "does anything repeat here at
 * all" and it validates the variance-component estimate independently.
 */

/** One player's residuals at a single course.
 *
 *  `ott`/`app` are kept for callers that want per-round detail, but
 *  the decomposition uses `visitsOtt`/`visitsApp` only — see the
 *  module note on why the round is the wrong unit. */
export interface PlayerResiduals {
  dgId: number;
  /** at-course minus baseline, one entry per round played here. */
  ott: number[];
  app: number[];
  /** Mean residual per visit (event-year), chronological. This is the
   *  unit of analysis. */
  visitsOtt: number[];
  visitsApp: number[];
}

export interface ComponentPersistence {
  /** Whether this component was actually estimated. Distinguishes the
   *  two zero-signal cases, which need opposite handling: a venue we
   *  MEASURED and found nothing at should shrink every number to
   *  nothing, while a venue we COULDN'T measure should leave numbers
   *  untouched and be labelled unadjusted. */
  measurable: boolean;
  /** Pooled within-player variance of a single VISIT's mean residual —
   *  how much a player's course fit bounces between trips. */
  noiseVar: number;
  /** Between-player variance left after removing sampling noise —
   *  the part attributable to a genuine, repeatable course effect.
   *  Clamped at 0; a negative raw estimate means the observed spread
   *  is no wider than noise alone predicts. */
  trueVar: number;
  /** Correlation between a player's earlier visits and their later
   *  visits. Null when too few players have made repeat visits for
   *  the correlation to mean anything. */
  testRetest: number | null;
  /** How many players fed the test-retest correlation. */
  testRetestPlayers: number;
  /** Reliability at the median visit-count in this sample — the
   *  single number to quote when describing the venue as a whole. */
  typicalReliability: number;
}

export interface PersistenceStats {
  ott: ComponentPersistence;
  app: ComponentPersistence;
  /** Players contributing to the variance decomposition. */
  playersUsed: number;
  /** Median visits per player, the basis for typicalReliability. */
  medianVisits: number;
  /** Players who have visited more than once — the only ones that
   *  carry any information about whether course fit repeats. */
  repeatVisitors: number;
  /** False when the sample is too thin to estimate anything — callers
   *  should fall back to showing raw numbers and saying so. */
  usable: boolean;
}

/** Minimum players before a variance decomposition is worth doing.
 *  Below this the between-player variance estimate is itself mostly
 *  noise and the adjustment would be arbitrary. */
const MIN_PLAYERS = 12;
/** Minimum players with repeat visits before quoting a test-retest r. */
const MIN_REPEAT_PLAYERS = 8;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa <= 0 || sbb <= 0) return null;
  return sab / Math.sqrt(saa * sbb);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Split a player's visit means into earlier and later halves. A
 *  player with an odd visit count contributes the middle visit to
 *  neither side, which keeps the two halves independent. */
function splitVisits(v: number[]): [number, number] | null {
  if (v.length < 2) return null;
  const h = Math.floor(v.length / 2);
  const early = v.slice(0, h);
  const late = v.slice(v.length - h);
  return [mean(early), mean(late)];
}

function componentFor(perVisit: number[][]): ComponentPersistence {
  // Pooled within-player noise: how far a player's individual visits
  // scatter around their own average. Only players with repeat visits
  // can contribute — a single trip tells you nothing about whether it
  // would happen again.
  let noiseNum = 0;
  let noiseDen = 0;
  for (const visits of perVisit) {
    if (visits.length < 2) continue;
    noiseNum += variance(visits) * (visits.length - 1);
    noiseDen += visits.length - 1;
  }
  const noiseVar = noiseDen > 0 ? noiseNum / noiseDen : 0;

  // Observed spread of player means, against the spread that sampling
  // noise alone would produce. The difference is what's real. When
  // it's negative the venue has no measurable course effect and the
  // clamp to zero shrinks every player's number away entirely — the
  // correct answer, and the one the UI reports.
  const playerMeans = perVisit.map((v) => mean(v));
  const observedVar = variance(playerMeans);
  let expectedNoise = 0;
  for (const visits of perVisit) {
    if (visits.length > 0) expectedNoise += noiseVar / visits.length;
  }
  expectedNoise = perVisit.length > 0 ? expectedNoise / perVisit.length : 0;

  // Clamping a difference of two variances at zero biases it UPWARD
  // when the truth is zero: noise that lands positive is kept, noise
  // that lands negative is floored away. On a pure-noise venue that
  // alone manufactures an apparent ~8% signal. Since the whole point
  // of this module is to avoid telling the user a number means
  // something when it doesn't, subtract one standard error of the
  // observed-variance estimate before clamping. The result reads as
  // "at least this much is real" rather than a point estimate, and a
  // venue with no course effect correctly reports none.
  const se =
    playerMeans.length > 1
      ? observedVar * Math.sqrt(2 / (playerMeans.length - 1))
      : observedVar;
  const trueVar = Math.max(observedVar - expectedNoise - se, 0);

  // Test-retest across repeat visitors, as an independent check on
  // the variance decomposition. The two should agree in sign.
  const early: number[] = [];
  const late: number[] = [];
  for (const visits of perVisit) {
    const split = splitVisits(visits);
    if (!split) continue;
    early.push(split[0]);
    late.push(split[1]);
  }
  const testRetest =
    early.length >= MIN_REPEAT_PLAYERS ? correlation(early, late) : null;

  const medVisits = median(perVisit.map((v) => v.length));
  const typicalReliability =
    trueVar > 0 && medVisits > 0 && noiseVar > 0
      ? trueVar / (trueVar + noiseVar / medVisits)
      : 0;

  return {
    measurable: true,
    noiseVar,
    trueVar,
    testRetest,
    testRetestPlayers: early.length,
    typicalReliability,
  };
}

/**
 * Fraction of an observed outperformance we should believe, for a
 * player with this many VISITS to the course. Returns 1 when the
 * course has no usable persistence estimate — callers in that state
 * should be showing raw numbers and labelling them as unadjusted
 * rather than silently applying a made-up shrink.
 */
export function reliabilityFor(
  c: ComponentPersistence | null | undefined,
  visits: number,
): number {
  if (!c || !c.measurable || visits <= 0) return 1;
  if (c.trueVar <= 0) return 0;
  if (c.noiseVar <= 0) return 1;
  return c.trueVar / (c.trueVar + c.noiseVar / visits);
}

export function computePersistence(
  players: PlayerResiduals[],
): PersistenceStats {
  const withVisits = players.filter((p) => p.visitsOtt.length > 0);
  const repeatVisitors = withVisits.filter(
    (p) => p.visitsOtt.length >= 2,
  ).length;
  const empty: ComponentPersistence = {
    measurable: false,
    noiseVar: 0,
    trueVar: 0,
    testRetest: null,
    testRetestPlayers: 0,
    typicalReliability: 0,
  };
  // Without enough repeat visitors there is no within-player variance
  // to estimate, so the decomposition has nothing to work with — the
  // player count alone isn't sufficient.
  if (
    withVisits.length < MIN_PLAYERS ||
    repeatVisitors < MIN_REPEAT_PLAYERS
  ) {
    return {
      ott: empty,
      app: empty,
      playersUsed: withVisits.length,
      medianVisits: 0,
      repeatVisitors,
      usable: false,
    };
  }
  return {
    ott: componentFor(withVisits.map((p) => p.visitsOtt)),
    app: componentFor(withVisits.map((p) => p.visitsApp)),
    playersUsed: withVisits.length,
    medianVisits: median(withVisits.map((p) => p.visitsOtt.length)),
    repeatVisitors,
    usable: true,
  };
}
