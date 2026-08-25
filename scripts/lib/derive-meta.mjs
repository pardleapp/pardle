/**
 * Derive a tournament's meta (course par, per-hole pars, event name)
 * from the already-ingested per-year historical JSONs.
 *
 * Split out of fetch-tournament-historical.mjs so the same logic can
 * be re-run over files already on disk without refetching anything —
 * see rebuild-historical-meta.mjs.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE: the original derivation inferred
 * par from each hole's AVERAGE SCORE, bucketed 3 / 4 / 5 at 3.6 and
 * 4.6. Tour pros average below 4.6 on any reachable par 5, so every
 * such hole was classified a par 4. At East Lake that turned holes 6
 * and 18 into par 4s and the course into a par 68; at Detroit it
 * misclassified twelve holes whose errors happened to cancel in the
 * total, hiding the bug behind a correct-looking 72.
 *
 * The scorecards carry an explicit `par` per hole. Use it. Scoring
 * average is only a fallback for holes where par is genuinely absent.
 */

/** Most frequent value in a Map-of-counts, ties broken low. */
function mode(counter) {
  let best = null;
  let bestN = -1;
  for (const [v, n] of counter) {
    if (n > bestN || (n === bestN && v < best)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * @param {Array<object>} yearPayloads - parsed {slug}-{year}.json files
 * @param {{venueName?: string}} opts
 */
export function deriveMeta(yearPayloads, opts = {}) {
  /** hole -> Map(par -> count) */
  const parCounts = new Map();
  /** hole -> {sum, n} of strokes, the fallback path only */
  const scoreAccum = new Map();
  /** coursePar as stated on the scorecard, per round */
  const coursePars = new Map();
  const eventNames = new Map();

  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const payload of yearPayloads) {
    if (!payload) continue;
    if (payload.dgEventName) bump(eventNames, payload.dgEventName);
    for (const p of payload.players ?? []) {
      const rounds = p.rounds ?? {};
      for (const rd of Object.values(rounds)) {
        if (typeof rd?.coursePar === "number") bump(coursePars, rd.coursePar);
        for (const [hStr, hole] of Object.entries(rd?.holes ?? {})) {
          const h = Number(hStr);
          if (!Number.isFinite(h)) continue;
          if (typeof hole?.par === "number") {
            if (!parCounts.has(h)) parCounts.set(h, new Map());
            bump(parCounts.get(h), hole.par);
          }
          if (typeof hole?.strokes === "number") {
            const acc = scoreAccum.get(h) ?? { sum: 0, n: 0 };
            acc.sum += hole.strokes;
            acc.n += 1;
            scoreAccum.set(h, acc);
          }
        }
      }
    }
  }

  const holePars = {};
  const holes = new Set([...parCounts.keys(), ...scoreAccum.keys()]);
  for (const h of [...holes].sort((a, b) => a - b)) {
    const counts = parCounts.get(h);
    if (counts && counts.size > 0) {
      holePars[h] = mode(counts);
      continue;
    }
    // Fallback only when the scorecard carried no par at all. Kept
    // deliberately crude — it is a last resort, not a method.
    const acc = scoreAccum.get(h);
    if (!acc || acc.n === 0) continue;
    const avg = acc.sum / acc.n;
    holePars[h] = avg < 3.6 ? 3 : avg < 4.6 ? 4 : 5;
  }

  // Prefer the par the scorecards actually state. Only fall back to
  // summing the per-hole pars if no round carried one — a course that
  // changed par between years (East Lake played 71 in 2024, 70
  // otherwise) resolves to whichever par was played most often.
  const statedPar = coursePars.size > 0 ? mode(coursePars) : null;
  const summedPar =
    Object.keys(holePars).length > 0
      ? Object.values(holePars).reduce((a, b) => a + b, 0)
      : null;

  return {
    eventName:
      (eventNames.size > 0 ? mode(eventNames) : null) ??
      opts.venueName?.replace(/ *[-—] .*$/, "") ??
      null,
    coursePar: statedPar ?? summedPar,
    courseHolePars: holePars,
    /** Set when the stated par and the summed per-hole pars disagree —
     *  usually means the course changed par across the ingested years.
     *  Surfaced rather than silently reconciled. */
    parMismatch:
      statedPar != null && summedPar != null && statedPar !== summedPar
        ? { statedPar, summedPar }
        : null,
  };
}
