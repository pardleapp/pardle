/**
 * Strokes gained by category from raw ShotLink shots.
 *
 * Built for events the PGA Tour tracks shot-by-shot but leaves out of
 * its published SG stats (the Baycurrent Classic in Japan), so DataGolf
 * has SG: Total only. Method, matching the Tour's definitions:
 *
 *   - Expected strokes to hole out E(lie, distance) is fitted from
 *     every shot at a set of calibration events (tour-average baseline).
 *   - Each shot gains E(start) - E(next start) - strokes used. Penalty
 *     strokes are charged to the shot that incurred them; holed = 0.
 *   - OTT = tee shots on par 4/5. PUTT = shots from the green.
 *     ARG = other shots from <= 30 yds. APP = everything else,
 *     including par-3 tee shots.
 *   - Per round, each category is made field-relative by subtracting
 *     the field mean, as the Tour does, so a player's categories sum
 *     to (field mean strokes - their strokes).
 */

const ARG_MAX_FT = 30 * 3;

export const LIE_GROUP = {
  OTB: "tee",
  OFW: "fairway",
  ORO: "rough",
  // Intermediate rough (first cut) plays like fairway. Grouping it with
  // rough cost ~0.04 of OTT correlation vs DataGolf at the courses that
  // have one (2025 Sanderson Farms 0.891 -> 0.927, 2024 ZOZO 0.891 ->
  // 0.934). Folding trees/native/other into rough was worse.
  OIR: "fairway",
  OGS: "sand",
  OST: "sand",
  OGR: "green",
};
const lieGroup = (code) => LIE_GROUP[code] ?? "recovery";

/** "34 ft 6 in." | "283 yds" | "11 in" -> feet. null when blank. */
export function parseFeet(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*yds?$/);
  if (m) return Number(m[1]) * 3;
  m = t.match(/^(-?\d+)\s*ft(?:\s*(\d+)\s*in\.?)?$/);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
  m = t.match(/^(-?\d+)\s*in\.?$/);
  if (m) return Number(m[1]) / 12;
  return null;
}

/**
 * Turn one hole's records into the STROKE start states we know
 * (lie + distance). Returns { states: [{ n, lie, group, distFt,
 * strokesToHoleOut, nextN }], gaps } or null when the hole has no
 * usable data.
 *
 * ShotLink occasionally drops records (1.4% of holes at the 2025
 * Baycurrent, almost all the opening shots). The tee start is always
 * known from the hole's yardage and the score fixes the end, so a
 * synthetic tee state is added when stroke 1 is missing and any stroke
 * whose start can't be placed is skipped. `nextN` then spans the gap
 * and roundRawSg splits that segment's SG across the missing strokes.
 */
export function holeStatesDetailed(hole) {
  const recs = hole.strokes ?? [];
  const score = Number(hole.score);
  if (!Number.isFinite(score) || score <= 0) return null;
  const teeFt = Number(hole.yardage) > 0 ? Number(hole.yardage) * 3 : null;
  const out = [];
  const penaltyNs = new Set();
  // Strokes whose start distance is lost but whose lie and shot length
  // are recorded — enough to tell which category they belong to.
  const hints = new Map();
  let lastRemFt = null;
  let prevN = 0;
  let gaps = 0;
  for (const r of recs) {
    if (r.strokeType === "PENALTY") penaltyNs.add(r.strokeNumber);
    if (r.strokeType === "STROKE") {
      let distFt = r.fromLocationCode === "OTB" ? teeFt : lastRemFt;
      // Only trust the previous record's distance when no stroke is
      // missing in between.
      if (r.fromLocationCode !== "OTB" && r.strokeNumber - prevN > 1) distFt = null;
      if (distFt == null && r.strokeNumber - prevN <= 1) {
        // Rare: the previous record has no distance left. Approximate
        // the start as shot length + what's left (straight line).
        const d = parseFeet(r.distance);
        const rem = parseFeet(r.distanceRemaining) ?? 0;
        if (d != null && d > 0) distFt = d + rem;
      }
      if (distFt != null && distFt > 0) {
        out.push({ n: r.strokeNumber, lie: r.fromLocationCode, group: lieGroup(r.fromLocationCode), distFt });
      } else {
        gaps++;
        hints.set(r.strokeNumber, { group: lieGroup(r.fromLocationCode), shotFt: parseFeet(r.distance) });
      }
      prevN = Math.max(prevN, r.strokeNumber);
    } else if (r.strokeType === "PENALTY") {
      prevN = Math.max(prevN, r.strokeNumber);
    }
    const rem = parseFeet(r.distanceRemaining);
    if (r.strokeType !== "PENALTY") lastRemFt = rem != null && rem > 0 ? rem : null;
  }
  if ((!out.length || out[0].n !== 1) && teeFt != null) {
    out.unshift({ n: 1, lie: "OTB", group: "tee", distFt: teeFt, synthetic: true });
    gaps++;
  }
  if (!out.length) return null;
  for (let i = 0; i < out.length; i++) {
    out[i].strokesToHoleOut = score - out[i].n + 1;
    out[i].nextN = i + 1 < out.length ? out[i + 1].n : score + 1;
    // Untracked strokes inside this segment (penalties are known and
    // stay charged to this shot), with whatever lie info survived.
    const missing = [];
    for (let n = out[i].n + 1; n < out[i].nextN; n++) {
      if (!penaltyNs.has(n)) missing.push(hints.get(n) ?? null);
    }
    out[i].missingAfter = missing;
  }
  return { states: out, gaps };
}

/** Known STROKE start states for a fully-tracked hole; null otherwise. */
export function holeStates(hole) {
  const d = holeStatesDetailed(hole);
  return d && d.gaps === 0 ? d.states : null;
}

// ── Baseline ───────────────────────────────────────────────────────

/** Distance bin edges in feet per lie group (log-ish spacing). */
function binEdges(group) {
  if (group === "green") {
    return [0, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 11, 13, 15, 17, 20, 23, 26, 30, 35, 40, 45, 50, 60, 70, 80, 100, 130, 200];
  }
  const yds = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 115, 130, 145, 160, 175, 190, 205, 220, 240, 260, 280, 300, 330, 360, 400, 450, 500, 560, 650];
  return yds.map((y) => y * 3);
}

/** Pool-adjacent-violators: weighted isotonic (non-decreasing) fit. */
function isotonic(ys, ws) {
  const blocks = [];
  for (let i = 0; i < ys.length; i++) {
    blocks.push({ v: ys[i], w: ws[i], n: 1 });
    while (blocks.length > 1 && blocks.at(-2).v > blocks.at(-1).v) {
      const b = blocks.pop();
      const a = blocks.pop();
      blocks.push({ v: (a.v * a.w + b.v * b.w) / (a.w + b.w), w: a.w + b.w, n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => Array(b.n).fill(b.v));
}

/**
 * Fit E(group, distFt) from states. Returns a serialisable baseline:
 * { [group]: { x: [binMeanFt...], y: [expected...], n: [count...] } }.
 */
export function fitBaseline(states, { minPerBin = 25 } = {}) {
  const byGroup = new Map();
  for (const s of states) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, []);
    byGroup.get(s.group).push(s);
  }
  const out = {};
  for (const [group, arr] of byGroup) {
    const edges = binEdges(group);
    const bins = edges.slice(0, -1).map(() => ({ sx: 0, sy: 0, n: 0 }));
    for (const s of arr) {
      let b = edges.findIndex((e, i) => i > 0 && s.distFt <= e) - 1;
      if (b < 0) b = s.distFt <= 0 ? 0 : bins.length - 1;
      bins[b].sx += s.distFt;
      bins[b].sy += s.strokesToHoleOut;
      bins[b].n += 1;
    }
    // Merge thin bins into their neighbour so every point is stable.
    const merged = [];
    for (const b of bins) {
      if (!b.n) continue;
      const last = merged.at(-1);
      if (last && last.n < minPerBin) {
        last.sx += b.sx; last.sy += b.sy; last.n += b.n;
      } else merged.push({ ...b });
    }
    if (merged.length > 1 && merged.at(-1).n < minPerBin) {
      const b = merged.pop();
      const last = merged.at(-1);
      last.sx += b.sx; last.sy += b.sy; last.n += b.n;
    }
    const x = merged.map((b) => b.sx / b.n);
    const yRaw = merged.map((b) => b.sy / b.n);
    const y = isotonic(yRaw, merged.map((b) => b.n));
    out[group] = { x, y, n: merged.map((b) => b.n) };
  }
  return out;
}

/** Expected strokes to hole out; linear interpolation in log distance. */
export function expected(baseline, group, distFt) {
  const g = baseline[group] ?? baseline.recovery ?? baseline.rough;
  const { x, y } = g;
  const d = Math.max(distFt, 0.25);
  if (d <= x[0]) {
    // Below the first bin: interpolate toward 1 stroke at 0 ft on the
    // green, otherwise clamp.
    return group === "green" ? 1 + (y[0] - 1) * (d / x[0]) : y[0];
  }
  if (d >= x.at(-1)) return y.at(-1);
  let i = 1;
  while (x[i] < d) i++;
  const t = (Math.log(d) - Math.log(x[i - 1])) / (Math.log(x[i]) - Math.log(x[i - 1]));
  return y[i - 1] + t * (y[i] - y[i - 1]);
}

// ── Per-round SG ───────────────────────────────────────────────────

export const CATS = ["ott", "app", "arg", "putt"];

function categoryOf(state, par) {
  if (state.group === "green") return "putt";
  if (state.group === "tee" && par >= 4) return "ott";
  if (state.group !== "tee" && state.distFt <= ARG_MAX_FT) return "arg";
  return "app";
}

/**
 * Raw (baseline-relative) SG per category for one player-round.
 * Returns null unless all 18 holes are present. Holes with missing
 * shot records still contribute their exact SG; only the split across
 * categories inside a gap is estimated (`imputedHoles` counts them).
 */
export function roundRawSg(holes, baseline) {
  if (!holes || holes.length !== 18) return null;
  const sg = { ott: 0, app: 0, arg: 0, putt: 0 };
  let strokes = 0;
  let imputedHoles = 0;
  for (const h of holes) {
    const d = holeStatesDetailed(h);
    if (!d) return null;
    const st = d.states;
    if (d.gaps > 0) imputedHoles++;
    strokes += Number(h.score);
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      const eStart = expected(baseline, s.group, s.distFt);
      const eNext = i + 1 < st.length ? expected(baseline, st[i + 1].group, st[i + 1].distFt) : 0;
      const seg = eStart - eNext - (s.nextN - s.n);
      const cat = categoryOf(s, Number(h.par));
      const missing = s.missingAfter ?? [];
      if (!missing.length) {
        sg[cat] += seg;
      } else {
        // Untracked strokes follow this one. Split the segment evenly:
        // each stroke's category comes from its surviving lie/length
        // when recorded, else approach (putting once on the green).
        const share = seg / (missing.length + 1);
        sg[cat] += share;
        for (const hint of missing) {
          let c;
          if (!hint) c = s.group === "green" ? "putt" : "app";
          else if (hint.group === "green") c = "putt";
          else if (hint.group === "tee") c = Number(h.par) >= 4 ? "ott" : "app";
          else c = hint.shotFt != null && hint.shotFt > 0 && hint.shotFt <= ARG_MAX_FT ? "arg" : "app";
          sg[c] += share;
        }
      }
    }
  }
  return { ...sg, strokes, imputedHoles };
}

/**
 * Field-relative SG for every player-round of a tournament.
 * Returns Map(playerId -> { name, rounds: { [r]: { ott, app, arg, putt, total, strokes } } }).
 */
export function tournamentSg(shots, baseline) {
  const raw = [];
  for (const p of shots.players) {
    for (const [r, holes] of Object.entries(p.rounds)) {
      const sg = roundRawSg(holes, baseline);
      if (sg) raw.push({ id: p.id, name: p.name, round: Number(r), ...sg });
    }
  }
  const mean = {};
  for (const r of [1, 2, 3, 4]) {
    const rows = raw.filter((x) => x.round === r);
    if (!rows.length) continue;
    mean[r] = Object.fromEntries([...CATS, "strokes"].map((c) => [c, rows.reduce((a, x) => a + x[c], 0) / rows.length]));
  }
  const out = new Map();
  for (const x of raw) {
    const m = mean[x.round];
    const rec = out.get(x.id) ?? { name: x.name, rounds: {} };
    const cats = Object.fromEntries(CATS.map((c) => [c, x[c] - m[c]]));
    rec.rounds[x.round] = { ...cats, total: m.strokes - x.strokes, strokes: x.strokes, imputedHoles: x.imputedHoles };
    out.set(x.id, rec);
  }
  return out;
}

/** Every STROKE start state of a tournament, for fitting the baseline. */
export function tournamentStates(shots) {
  const out = [];
  for (const p of shots.players) for (const holes of Object.values(p.rounds)) for (const h of holes) {
    const st = holeStates(h);
    if (st) out.push(...st);
  }
  return out;
}
