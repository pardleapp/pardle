/**
 * Backtest the course-history "course fit" signal as a FORECAST.
 *
 *   node scripts/backtest-course-fit.mjs [--tour dpwt|pga|both]
 *
 * For every repeat visit (player, course) we predict the visit's
 * SG: OTT + APP edge over the player's own level using ONLY earlier
 * information:
 *   - baseline = the player's 50 most recent rounds before the visit
 *     (other courses only), field-strength adjusted, shrunk toward a
 *     prior with K = 20. Prior is either 0 (current tool) or a
 *     skill prior from the player's DataGolf SG: Total over the
 *     previous 365 days (both tours), mapped to the OTT+APP scale.
 *   - predictor = his round-weighted edge over baseline on earlier
 *     visits to the course (what the tool shows as raw outperformance).
 * Then: how much of that predictor shows up on the next visit (slope),
 * overall and by number of earlier visits. Also scores the baselines
 * themselves on low-volume players.
 *
 * Data: DP World Tour = IMG per-round OTT/APP (data/dpwt/sg-history.json);
 * PGA = DataGolf rounds with categories (data/dg-rounds-full-cache).
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const WHICH = args.tour ?? "both";
const K = 20;
const BASE_N = 50;
const day = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;

// ── DataGolf rounds (all tours) for the skill prior + PGA backtest ──
const dgDir = resolve(ROOT, "data", "dg-rounds-full-cache");
const dgFiles = (await readdir(dgDir)).filter((f) => f.endsWith(".json"));
const dgRounds = [];
for (const f of dgFiles) {
  const tour = f.split("-")[0];
  for (const r of JSON.parse(await readFile(resolve(dgDir, f), "utf-8"))) dgRounds.push({ ...r, tour, eventKey: f.replace(".json", "") });
}
const totalByDg = new Map(); // dgId -> [{t, sg}] sorted
for (const r of dgRounds) {
  if (typeof r.sgTotal !== "number") continue;
  (totalByDg.get(r.dgId) ?? totalByDg.set(r.dgId, []).get(r.dgId)).push({ t: day(r.date), sg: r.sgTotal });
}
for (const a of totalByDg.values()) a.sort((x, y) => x.t - y.t);
/** Mean DG SG: Total over the 365 days before t (null if < 5 rounds). */
function trailingTotal(dgId, t) {
  const a = totalByDg.get(dgId);
  if (!a) return null;
  let s = 0, n = 0;
  for (const x of a) { if (x.t >= t) break; if (x.t >= t - 365) { s += x.sg; n++; } }
  return n >= 5 ? s / n : null;
}

function ols(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const b = sxy / sxx, a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - a - b * xs[i]) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  return { n, a, b, se, r: sxy / Math.sqrt(sxx * syy) };
}

/**
 * rounds: [{ player, dgId, event, date, course, ott, app }]
 * Returns backtest stats.
 */
function run(label, rounds) {
  // Field strength per event: mean of participants' leave-one-out
  // same-year averages, centred on the tour-wide mean.
  const byPlayer = new Map();
  for (const r of rounds) (byPlayer.get(r.player) ?? byPlayer.set(r.player, []).get(r.player)).push(r);
  const yearTot = new Map();
  for (const r of rounds) {
    const k = `${r.player}|${r.date.slice(0, 4)}`;
    const t = yearTot.get(k) ?? { s: 0, n: 0 };
    t.s += r.ott + r.app; t.n++;
    yearTot.set(k, t);
  }
  const evPlayer = new Map();
  for (const r of rounds) {
    const k = `${r.event}|${r.player}`;
    const t = evPlayer.get(k) ?? { s: 0, n: 0, year: r.date.slice(0, 4), event: r.event, player: r.player };
    t.s += r.ott + r.app; t.n++;
    evPlayer.set(k, t);
  }
  const fsAcc = new Map();
  for (const e of evPlayer.values()) {
    const y = yearTot.get(`${e.player}|${e.year}`);
    const n = y.n - e.n;
    if (n <= 0) continue;
    const a = fsAcc.get(e.event) ?? { s: 0, n: 0 };
    a.s += (y.s - e.s) / n; a.n++;
    fsAcc.set(e.event, a);
  }
  const fsRaw = new Map([...fsAcc].map(([k, a]) => [k, a.s / a.n]));
  const fsMean = [...fsRaw.values()].reduce((a, b) => a + b, 0) / fsRaw.size;
  const fs = (ev) => (fsRaw.get(ev) ?? fsMean) - fsMean;

  for (const arr of byPlayer.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  // Map DG SG: Total trailing -> OTT+APP scale, fitted on well-sampled
  // players' own trailing OTT+APP (both measured before the date).
  function ownTrailing(player, t, courseExcl) {
    const arr = byPlayer.get(player);
    let s = 0, n = 0;
    for (let i = arr.length - 1; i >= 0 && n < BASE_N; i--) {
      const r = arr[i];
      if (day(r.date) >= t || r.course === courseExcl) continue;
      s += r.ott + r.app + fs(r.event);
      n++;
    }
    return { mean: n ? s / n : 0, n };
  }
  const calX = [], calY = [];
  for (const [player, arr] of byPlayer) {
    const dgId = arr[0].dgId;
    if (dgId == null) continue;
    for (const ev of [...new Set(arr.map((r) => r.date))].filter((_, i) => i % 3 === 0)) {
      const t = day(ev);
      const own = ownTrailing(player, t, null);
      const tot = trailingTotal(dgId, t);
      if (own.n >= 40 && tot != null) { calX.push(tot); calY.push(own.mean); }
    }
  }
  const map = ols(calX, calY);
  const priorFor = (dgId, t) => {
    const tot = dgId != null ? trailingTotal(dgId, t) : null;
    return tot == null ? map.a : map.a + map.b * tot;
  };

  // Visits: player x course x event.
  const visits = new Map();
  for (const r of rounds) {
    if (!r.course) continue;
    const k = `${r.player}|${r.course}|${r.event}`;
    const v = visits.get(k) ?? { player: r.player, dgId: r.dgId, course: r.course, event: r.event, date: r.date, sum: 0, n: 0 };
    v.sum += r.ott + r.app + fs(r.event);
    v.n++;
    visits.set(k, v);
  }
  const byPC = new Map();
  for (const v of visits.values()) (byPC.get(`${v.player}|${v.course}`) ?? byPC.set(`${v.player}|${v.course}`, []).get(`${v.player}|${v.course}`)).push(v);

  /** Mean of the 50 rounds nearest t (either side), other courses only,
   *  restricted to rounds before `before`. */
  function nearestBaseline(player, t, courseExcl, before) {
    const arr = byPlayer.get(player).filter((r) => r.course !== courseExcl && day(r.date) < before && day(r.date) !== t);
    arr.sort((a, b) => Math.abs(day(a.date) - t) - Math.abs(day(b.date) - t));
    let s = 0, n = 0;
    for (const r of arr) { if (n >= BASE_N) break; s += r.ott + r.app + fs(r.event); n++; }
    return { mean: n ? s / n : 0, n };
  }
  const out = { zero: [], skill: [], skillSym: [] };
  const baseErr = { zero: [], skill: [] };
  for (const vs of byPC.values()) {
    vs.sort((a, b) => a.date.localeCompare(b.date));
    // residual per visit under each baseline
    for (const v of vs) {
      const t = day(v.date);
      const own = ownTrailing(v.player, t, v.course);
      v.ownN = own.n;
      const w = own.n / (own.n + K);
      const prior = priorFor(v.dgId, t);
      v.base = { zero: own.mean * w, skill: own.mean * w + prior * (1 - w) };
      v.res = { zero: v.sum / v.n - v.base.zero, skill: v.sum / v.n - v.base.skill };
      if (own.n < 40) { baseErr.zero.push(v.res.zero); baseErr.skill.push(v.res.skill); }
    }
    for (let k = 1; k < vs.length; k++) {
      for (const kind of ["zero", "skill"]) {
        let s = 0, n = 0;
        for (let j = 0; j < k; j++) { s += vs[j].res[kind] * vs[j].n; n += vs[j].n; }
        out[kind].push({ pred: s / n, actual: vs[k].res[kind], prior: k, rounds: vs[k].n });
      }
      // "skillSym": earlier visits scored the way the tool scores them —
      // baseline = the 50 rounds nearest each earlier visit in EITHER
      // direction (skill-prior shrink) — but only from rounds before the
      // visit being predicted, so nothing leaks.
      const cutoff = day(vs[k].date);
      let s = 0, n = 0;
      for (let j = 0; j < k; j++) {
        const sym = nearestBaseline(vs[j].player, day(vs[j].date), vs[j].course, cutoff);
        const w = sym.n / (sym.n + K);
        const base = sym.mean * w + priorFor(vs[j].dgId, day(vs[j].date)) * (1 - w);
        s += (vs[j].sum / vs[j].n - base) * vs[j].n;
        n += vs[j].n;
      }
      out.skillSym.push({ pred: s / n, actual: vs[k].res.skill, prior: k, rounds: vs[k].n });
    }
  }
  const stat = (rows) => {
    if (rows.length < 10) return { n: rows.length };
    const f = ols(rows.map((r) => r.pred), rows.map((r) => r.actual));
    return { n: f.n, slope: +f.b.toFixed(3), se: +f.se.toFixed(3), r: +f.r.toFixed(3) };
  };
  const res = { label, rounds: rounds.length, players: byPlayer.size, priorMap: { a: +map.a.toFixed(3), b: +map.b.toFixed(3), n: map.n, r: +map.r.toFixed(3) } };
  for (const kind of ["zero", "skill", "skillSym"]) {
    const rows = out[kind];
    res[kind] = {
      all: stat(rows),
      prior1: stat(rows.filter((r) => r.prior === 1)),
      prior2: stat(rows.filter((r) => r.prior === 2)),
      prior3plus: stat(rows.filter((r) => r.prior >= 3)),
      lowVolumeBaselineBias: baseErr[kind]?.length ? +(baseErr[kind].reduce((a, b) => a + b, 0) / baseErr[kind].length).toFixed(3) : null,
      lowVolumeBaselineRmse: baseErr[kind]?.length ? +Math.sqrt(baseErr[kind].reduce((a, b) => a + b * b, 0) / baseErr[kind].length).toFixed(3) : null,
      lowVolumeN: baseErr[kind]?.length ?? null,
    };
  }
  return res;
}

const results = [];
if (WHICH !== "pga") {
  const h = JSON.parse(await readFile(resolve(ROOT, "data", "dpwt", "sg-history.json"), "utf-8"));
  const rounds = h.rounds.map(([player, e, round, ott, app]) => ({
    player, dgId: h.players[player]?.dgId ?? null, event: `img${h.events[e].img}`, date: h.events[e].date,
    course: (h.events[e].course ?? "").toLowerCase(), ott, app, round,
  }));
  results.push(run("DP World Tour (IMG SG, 2024-26)", rounds));
}
if (WHICH !== "dpwt") {
  const rounds = dgRounds
    .filter((r) => r.tour === "pga" && typeof r.sgOtt === "number" && typeof r.sgApp === "number")
    .map((r) => ({ player: `dg${r.dgId}`, dgId: r.dgId, event: r.eventKey, date: r.date, course: (r.course ?? "").toLowerCase(), ott: r.sgOtt, app: r.sgApp }));
  results.push(run("PGA Tour (DG SG, 2018-26)", rounds));
}
console.log(JSON.stringify(results, null, 1));
await writeFile(resolve(ROOT, "data", "course-fit-backtest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 1) + "\n");
