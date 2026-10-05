/**
 * Skill priors for DP World Tour course history baselines.
 *
 *   node scripts/build-dpwt-skill-priors.mjs
 *
 * A player's "usual level" (baseline) is shrunk toward a prior when he
 * has few rounds. Shrinking toward zero (an average player) understates
 * elite low-volume players (Jon Rahm: 20 tracked DP World rounds), so
 * the prior is his own DataGolf SG: Total over the 365 days before the
 * event (both tours), mapped onto the IMG OTT and APP scales by
 * regression on well-sampled players. Time-local: nothing after the
 * event is used.
 *
 * Also records the backtested carry-forward share
 * (scripts/backtest-course-fit.mjs) that the tool applies to course edges.
 *
 * Needs data/dg-rounds-full-cache (scripts/fetch-dg-rounds-full.mjs).
 * Writes data/dpwt/skill-priors.json.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const day = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;

const dgDir = resolve(ROOT, "data", "dg-rounds-full-cache");
const tot = new Map();
for (const f of await readdir(dgDir)) {
  for (const r of JSON.parse(await readFile(resolve(dgDir, f), "utf-8"))) {
    if (typeof r.sgTotal !== "number") continue;
    (tot.get(r.dgId) ?? tot.set(r.dgId, []).get(r.dgId)).push({ t: day(r.date), sg: r.sgTotal });
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

const h = JSON.parse(await readFile(resolve(ROOT, "data", "dpwt", "sg-history.json"), "utf-8"));
// Per player, rounds in date order: [eventIdx, ott, app]
const byPlayer = new Map();
for (const [key, ev, , ott, app] of h.rounds) (byPlayer.get(key) ?? byPlayer.set(key, []).get(key)).push({ ev, t: day(h.events[ev].date), ott, app });
for (const a of byPlayer.values()) a.sort((x, y) => x.t - y.t);

// Fit OTT and APP (own trailing 50-round means, well-sampled players)
// on DG trailing SG: Total.
const X = [], YO = [], YA = [];
for (const [key, rs] of byPlayer) {
  const dgId = h.players[key]?.dgId;
  if (dgId == null) continue;
  const evs = [...new Set(rs.map((r) => r.ev))];
  for (const ev of evs.filter((_, i) => i % 3 === 0)) {
    const t = day(h.events[ev].date);
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

// Prior per player per event they played (that's every date the tool
// needs a baseline for). Players with no DG history get the intercepts.
const priors = {};
for (const [key, rs] of byPlayer) {
  const dgId = h.players[key]?.dgId;
  const out = {};
  for (const ev of new Set(rs.map((r) => r.ev))) {
    const tt = dgId != null ? trailing(dgId, day(h.events[ev].date)) : null;
    out[ev] = tt == null ? null : [+(fo.a + fo.b * tt).toFixed(3), +(fa.a + fa.b * tt).toFixed(3)];
  }
  priors[key] = out;
}
const bt = JSON.parse(await readFile(resolve(ROOT, "data", "course-fit-backtest.json"), "utf-8"));
const dp = bt.results.find((r) => r.label.startsWith("DP World"));
const carry = dp?.skillSym?.all;
await writeFile(resolve(ROOT, "data", "dpwt", "skill-priors.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  map: { ott: { a: +fo.a.toFixed(4), b: +fo.b.toFixed(4) }, app: { a: +fa.a.toFixed(4), b: +fa.b.toFixed(4) } },
  // Share of a player's past course edge that showed up on his next
  // visit, across every repeat visit to a DP World Tour course.
  carryForward: { value: carry.slope, se: carry.se, n: carry.n },
  priors,
}));
console.log(`[write] priors for ${Object.keys(priors).length} players; carry-forward ${carry.slope} (se ${carry.se}, n ${carry.n})`);
