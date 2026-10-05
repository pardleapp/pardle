/**
 * Compute SG by category from ShotLink shots for events DataGolf only
 * has SG: Total for (see scripts/lib/shot-sg.mjs for the method).
 *
 *   node scripts/compute-shot-sg.mjs fit        # fit + save baseline
 *   node scripts/compute-shot-sg.mjs validate   # score held-out events vs DG
 *   node scripts/compute-shot-sg.mjs build      # write data/sg-computed/*.json
 *
 * Steps are cached (data/shot-cache/), so re-runs are cheap.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getTournamentShots, pga } from "./lib/shot-fetch.mjs";
import { fitBaseline, tournamentStates, tournamentSg, CATS } from "./lib/shot-sg.mjs";

const ROOT = process.cwd();
const env = (() => {
  try {
    return Object.fromEntries(
      readFileSync(path.join(ROOT, ".env.local"), "utf-8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
        }),
    );
  } catch {
    return {};
  }
})();
const DG_KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF || env.DATAGOLF_API_KEY || env.DATAGOLF;

// Baseline: full-field 2025 US events on a mix of course types.
const CALIBRATION = [
  [2025, "3M Open"],
  [2025, "Rocket Classic"],
  [2025, "John Deere Classic"],
  [2025, "Wyndham Championship"],
  [2025, "RBC Canadian Open"],
  [2025, "Valspar Championship"],
];
// Held out: the fall events either side of the Baycurrent, and the
// 2024 ZOZO in Japan (the only Japan event DG has categories for).
const VALIDATION = [
  [2025, "Sanderson Farms Championship"],
  [2025, "Bank of Utah Championship"],
  [2024, "ZOZO CHAMPIONSHIP"],
];
// Events to publish computed categories for: [year, PGA name, DG event id].
const TARGETS = [[2025, "Baycurrent Classic", 527]];

const BASELINE_FILE = path.join(ROOT, "data", "sg-baseline.json");
const OUT_DIR = path.join(ROOT, "data", "sg-computed");

async function dg(p) {
  const url = `https://feeds.datagolf.com${p}${p.includes("?") ? "&" : "?"}file_format=json&key=${DG_KEY}`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status !== 429) throw new Error(`DataGolf ${p} -> ${res.status}`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  throw new Error(`DataGolf ${p} still rate-limited`);
}

const scheduleCache = new Map();
async function pgaId(year, name) {
  if (!scheduleCache.has(year)) {
    const d = await pga(`{ schedule(tourCode: "R", year: "${year}") { completed { tournaments { id tournamentName } } } }`);
    scheduleCache.set(year, d.schedule.completed.flatMap((g) => g.tournaments));
  }
  const hit = scheduleCache.get(year).find((t) => t.tournamentName.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`no PGA schedule match for ${year} ${name}`);
  return hit.id;
}

let eventList = null;
async function dgEvent(year, name) {
  eventList ??= await dg("/historical-raw-data/event-list?tour=pga");
  const hit = eventList.find((e) => e.calendar_year === year && e.event_name.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`no DG event for ${year} ${name}`);
  return hit;
}

// Letters NFD doesn't decompose into base + accent (Højgaard's ø).
const FOLD = { ø: "o", Ø: "o", æ: "ae", Æ: "ae", ß: "ss", ł: "l", Ł: "l", đ: "d", Đ: "d" };

export function normName(s) {
  const t = s.includes(",") ? s.split(",").map((x) => x.trim()).reverse().join(" ") : s;
  return t
    .replace(/[øØæÆßłŁđĐ]/g, (c) => FOLD[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function loadBaseline() {
  return JSON.parse(readFileSync(BASELINE_FILE, "utf-8")).baseline;
}

async function fit() {
  const states = [];
  const ids = [];
  for (const [y, name] of CALIBRATION) {
    const id = await pgaId(y, name);
    const shots = await getTournamentShots(id);
    const st = tournamentStates(shots);
    console.log(`[fit] ${y} ${name} (${id}): ${shots.players.length} players, ${st.length} shots`);
    states.push(...st);
    ids.push(id);
  }
  const baseline = fitBaseline(states);
  mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ fittedAt: new Date().toISOString(), calibrationEvents: ids, shots: states.length, baseline }, null, 1) + "\n",
  );
  console.log(`[fit] ${states.length} shots -> ${BASELINE_FILE}`);
  for (const [g, v] of Object.entries(baseline)) {
    console.log(`  ${g.padEnd(8)} bins=${v.x.length} n=${v.n.reduce((a, b) => a + b, 0)} ` +
      v.x.filter((_, i) => i % Math.ceil(v.x.length / 8) === 0).map((x, i) => `${Math.round(x)}ft:${v.y[i * Math.ceil(v.x.length / 8)].toFixed(2)}`).join(" "));
  }
}

const corr = (a, b) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};

/** Pair our per-round SG with DG's for one event. */
async function pairWithDg(year, name, baseline) {
  const id = await pgaId(year, name);
  const ev = await dgEvent(year, name);
  const ours = tournamentSg(await getTournamentShots(id), baseline);
  const dgRounds = await dg(`/historical-raw-data/rounds?tour=pga&event_id=${ev.event_id}&year=${year}`);
  const byName = new Map(dgRounds.scores.map((s) => [normName(s.player_name), s]));
  const pairs = [];
  let unmatched = 0;
  for (const [, p] of ours) {
    const d = byName.get(normName(p.name));
    if (!d) { unmatched++; continue; }
    for (const [r, o] of Object.entries(p.rounds)) {
      const dr = d[`round_${r}`];
      if (!dr || dr.sg_ott == null) continue;
      pairs.push({ name: p.name, dgId: d.dg_id, round: Number(r), o, d: dr });
    }
  }
  return { id, ev, pairs, unmatched };
}

async function validate() {
  const baseline = loadBaseline();
  const report = [];
  for (const [y, name] of VALIDATION) {
    const { id, pairs, unmatched } = await pairWithDg(y, name, baseline);
    const line = { event: `${y} ${name}`, id, playerRounds: pairs.length, unmatched };
    for (const c of [...CATS, "total"]) {
      const a = pairs.map((p) => p.o[c]);
      const b = pairs.map((p) => p.d[`sg_${c}`]);
      const diff = a.map((x, i) => x - b[i]);
      const md = diff.reduce((s, x) => s + x, 0) / diff.length;
      line[c] = {
        r: +corr(a, b).toFixed(3),
        meanDiff: +md.toFixed(3),
        rmse: +Math.sqrt(diff.reduce((s, x) => s + x * x, 0) / diff.length).toFixed(3),
      };
    }
    // Per-player event averages (what course history aggregates).
    const byP = new Map();
    for (const p of pairs) {
      const e = byP.get(p.name) ?? { o: { ott: 0, app: 0 }, d: { ott: 0, app: 0 }, n: 0 };
      e.o.ott += p.o.ott; e.o.app += p.o.app; e.d.ott += p.d.sg_ott; e.d.app += p.d.sg_app; e.n++;
      byP.set(p.name, e);
    }
    const ev = [...byP.values()].filter((e) => e.n >= 2);
    line.playerEventOttApp = {
      r: +corr(ev.map((e) => (e.o.ott + e.o.app) / e.n), ev.map((e) => (e.d.ott + e.d.app) / e.n)).toFixed(3),
      players: ev.length,
    };
    report.push(line);
    console.log(JSON.stringify(line));
  }
  return report;
}

async function build() {
  const baseline = loadBaseline();
  const meta = JSON.parse(readFileSync(BASELINE_FILE, "utf-8"));
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [year, name, dgEventId] of TARGETS) {
    const id = await pgaId(year, name);
    const ours = tournamentSg(await getTournamentShots(id), baseline);
    const dgRounds = await dg(`/historical-raw-data/rounds?tour=pga&event_id=${dgEventId}&year=${year}`);
    const byName = new Map(dgRounds.scores.map((s) => [normName(s.player_name), s]));
    const players = {};
    let rounds = 0, unmatched = [];
    for (const [, p] of ours) {
      const d = byName.get(normName(p.name));
      if (!d) { unmatched.push(p.name); continue; }
      const out = {};
      for (const [r, o] of Object.entries(p.rounds)) {
        const dgTotal = d[`round_${r}`]?.sg_total;
        if (dgTotal == null) continue;
        // DG's SG: Total carries its field-strength adjustment; ours is
        // field-relative. Spread the per-round gap evenly across the
        // four categories so they sum exactly to DG's total.
        const gap = (dgTotal - o.total) / 4;
        const cats = Object.fromEntries(CATS.map((c) => [`sg_${c}`, +(o[c] + gap).toFixed(3)]));
        cats.sg_t2g = +(cats.sg_ott + cats.sg_app + cats.sg_arg).toFixed(3);
        if (o.imputedHoles) cats.imputedHoles = o.imputedHoles;
        out[r] = cats;
        rounds++;
      }
      players[d.dg_id] = out;
    }
    const file = path.join(OUT_DIR, `${dgEventId}-${year}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        eventId: dgEventId,
        year,
        eventName: name,
        pgaTournamentId: id,
        method: "shotlink-baseline-v1",
        baselineFittedAt: meta.fittedAt,
        calibrationEvents: meta.calibrationEvents,
        generatedAt: new Date().toISOString(),
        players,
      }) + "\n",
    );
    console.log(`[build] ${file}: ${Object.keys(players).length} players, ${rounds} rounds, unmatched: ${unmatched.join(", ") || "none"}`);
  }
}

const cmd = process.argv[2];
if (cmd === "fit") await fit();
else if (cmd === "validate") await validate();
else if (cmd === "build") await build();
else console.log("usage: node scripts/compute-shot-sg.mjs fit|validate|build");
