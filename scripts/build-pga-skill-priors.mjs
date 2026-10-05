/**
 * Skill priors + backtested carry-forward for PGA course history
 * (lib/course-history). Same method as build-dpwt-skill-priors.mjs:
 * baselines shrink toward the player's own DataGolf SG: Total over the
 * 365 days before the event (both tours), mapped to OTT and APP by
 * regression on well-sampled players; time-local.
 *
 *   node scripts/build-pga-skill-priors.mjs
 *
 * Needs data/dg-rounds-full-cache (scripts/fetch-dg-rounds-full.mjs) and
 * data/course-fit-backtest.json (scripts/backtest-course-fit.mjs).
 * Writes data/course-history/skill-priors-pga.json:
 *   { map, carryForward: { byVisits: {1,2,3}, n }, priors: { [dgId]: { [eventDate]: [ott, app] } } }
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const day = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;
const dgDir = resolve(ROOT, "data", "dg-rounds-full-cache");

const tot = new Map();
const pga = [];
for (const f of await readdir(dgDir)) {
  const tour = f.split("-")[0];
  for (const r of JSON.parse(await readFile(resolve(dgDir, f), "utf-8"))) {
    if (typeof r.sgTotal === "number") (tot.get(r.dgId) ?? tot.set(r.dgId, []).get(r.dgId)).push({ t: day(r.date), sg: r.sgTotal });
    if (tour === "pga" && typeof r.sgOtt === "number" && typeof r.sgApp === "number") pga.push(r);
  }
}
for (const a of tot.values()) a.sort((x, y) => x.t - y.t);
function trailing(dgId, t) {
  const a = tot.get(dgId);
  if (!a) return null;
  let s = 0, n = 0;
  for (const x of a) { if (x.t >= t) break; if (x.t >= t - 365) { s += x.sg; n++; } }
  return n >= 5 ? s / n : null;
}

const byPlayer = new Map();
for (const r of pga) (byPlayer.get(r.dgId) ?? byPlayer.set(r.dgId, []).get(r.dgId)).push({ t: day(r.date), date: r.date, ott: r.sgOtt, app: r.sgApp });
for (const a of byPlayer.values()) a.sort((x, y) => x.t - y.t);

const X = [], YO = [], YA = [];
for (const [dgId, rs] of byPlayer) {
  const dates = [...new Set(rs.map((r) => r.date))];
  for (const d of dates.filter((_, i) => i % 3 === 0)) {
    const t = day(d);
    const prior = rs.filter((r) => r.t < t).slice(-50);
    const tt = trailing(dgId, t);
    if (prior.length >= 40 && tt != null) {
      X.push(tt);
      YO.push(prior.reduce((a, r) => a + r.ott, 0) / prior.length);
      YA.push(prior.reduce((a, r) => a + r.app, 0) / prior.length);
    }
  }
}
function ols(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const b = sxy / sxx;
  return { a: my - b * mx, b, r: sxy / Math.sqrt(sxx * syy), n };
}
const fo = ols(X, YO), fa = ols(X, YA);
console.log(`[fit] OTT = ${fo.a.toFixed(3)} + ${fo.b.toFixed(3)}*sgTotal (r ${fo.r.toFixed(2)}, n ${fo.n}); APP = ${fa.a.toFixed(3)} + ${fa.b.toFixed(3)}*sgTotal (r ${fa.r.toFixed(2)})`);

const priors = {};
let count = 0;
for (const [dgId, rs] of byPlayer) {
  const out = {};
  for (const d of new Set(rs.map((r) => r.date))) {
    const tt = trailing(dgId, day(d));
    if (tt == null) continue;
    out[d] = [+(fo.a + fo.b * tt).toFixed(3), +(fa.a + fa.b * tt).toFixed(3)];
    count++;
  }
  if (Object.keys(out).length) priors[dgId] = out;
}
const bt = JSON.parse(await readFile(resolve(ROOT, "data", "course-fit-backtest.json"), "utf-8"));
const res = bt.results.find((r) => r.label.startsWith("PGA")).skillSym;
await mkdir(resolve(ROOT, "data", "course-history"), { recursive: true });
await writeFile(resolve(ROOT, "data", "course-history", "skill-priors-pga.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  map: { ott: { a: +fo.a.toFixed(4), b: +fo.b.toFixed(4) }, app: { a: +fa.a.toFixed(4), b: +fa.b.toFixed(4) } },
  // Share of a player's past course edge (tool-style baseline) that
  // showed up on his next visit, by number of earlier visits.
  carryForward: { byVisits: { 1: res.prior1.slope, 2: res.prior2.slope, 3: res.prior3plus.slope }, n: res.all.n, overall: res.all.slope },
  priors,
}));
console.log(`[write] ${Object.keys(priors).length} players, ${count} player-event priors; carry 1/2/3+ = ${res.prior1.slope}/${res.prior2.slope}/${res.prior3plus.slope} (n ${res.all.n})`);
