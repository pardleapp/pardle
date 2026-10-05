/**
 * Build DP World Tour historical files for one venue, in the same shape
 * as the PGA files in data/historical/ so the analysis tools can share
 * their logic:
 *
 *   data/dpwt/historical/{slug}-{year}.json
 *   data/dpwt/historical/{slug}-meta.json
 *   data/dpwt/historical/_live-tournaments.json
 *
 *   node scripts/fetch-dpwt-historical.mjs --venue open-de-espana
 *
 * Sources:
 *   - DP World Tour sportdata API (keyless): leaderboard, hole-by-hole
 *     scores, tee times, hole pars and card yardage, for every edition.
 *   - IMG Arena event centre (the Tour's shot tracker, 2022+): actual
 *     yardage and pin position per hole per round, and per-player
 *     per-round strokes gained by category.
 *   - DataGolf historical euro rounds: dg_id, SG: Total, and the
 *     pre-tournament skill baseline (euro + pga rounds pooled).
 *   - Open-Meteo archive weather; OpenStreetMap greens and tees for
 *     hole bearings and the green outlines the pin tools draw.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreTournamentSkillMap } from "./lib/pretournament-skill.mjs";
import { latLonToUtm, utmToLatLon } from "./lib/utm.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "data", "dpwt", "historical");
const DPWT = "https://www.europeantour.com";
const IMG = "https://btec-http.services.srarena.io/";

// Venues we've onboarded. Editions are the DP World Tour EventIds
// played at the same course (the event moved around Spain before 2019).
const VENUES = {
  "open-de-espana": {
    eventName: "Open de España",
    courseName: "Club de Campo Villa de Madrid",
    tz: "Europe/Madrid",
    utmZone: 30,
    editions: [
      { year: 2019, eventId: 2019084, img: null },
      { year: 2021, eventId: 2021136, img: null },
      { year: 2022, eventId: 2022138, img: 523 },
      { year: 2023, eventId: 2023143, img: 702 },
      { year: 2024, eventId: 2024136, img: 884 },
      { year: 2025, eventId: 2025134, img: 1168 },
    ],
    live: {
      year: 2026,
      eventId: 2026139,
      img: 1438,
      roundDates: { 1: "2026-10-08", 2: "2026-10-09", 3: "2026-10-10", 4: "2026-10-11" },
    },
    osmBbox: [40.44, -3.77, 40.475, -3.72],
  },
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const SLUG = args.venue ?? "open-de-espana";
const V = VENUES[SLUG];
if (!V) throw new Error(`unknown venue ${SLUG}`);

// ── env ────────────────────────────────────────────────────────────
for (const line of (await readFile(resolve(ROOT, ".env.local"), "utf-8").catch(() => "")).split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const DG_KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, init, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    if (r.ok) return r.json();
    if (r.status === 204) return null;
    if (i === tries - 1) throw new Error(`${r.status} ${url}`);
    await sleep(r.status === 429 ? 65_000 : 3000 * (i + 1));
  }
}
const dpwt = async (path) => {
  await sleep(700);
  return getJson(DPWT + path);
};
const dg = (path) => getJson(`https://feeds.datagolf.com${path}${path.includes("?") ? "&" : "?"}file_format=json&key=${DG_KEY}`);

const IMG_EVENTS = JSON.parse(await readFile(resolve(ROOT, "data", "dpwt", "img-events.json"), "utf-8"));
const IMG_STATS = JSON.parse(await readFile(resolve(ROOT, "data", "dpwt", "img-stats-query.json"), "utf-8"));
const imgHeaders = (eventId, op, hash) => ({
  operator: "europeantour", sport: "GOLF", "event-id": String(eventId), "gql-op-name": op,
  "ec-version": "6.0.129", "x-request-from": "6.0.129", "normalise-response": "true",
  ...(hash ? { "query-hash": hash } : {}),
  origin: "https://europeantour.apps.srarena.io", referer: "https://europeantour.apps.srarena.io/",
});
async function imgCourseInfo(img) {
  const h = IMG_EVENTS[String(img)]?.courseInfoHash;
  if (!h) return null;
  return getJson(`${IMG}?hash=${h}`, { headers: imgHeaders(img, "GetGolfCourseInfo", h) });
}
async function imgStats(img) {
  const body = {
    operationName: IMG_STATS.operationName,
    query: IMG_STATS.query,
    // Keys must stay in this (alphabetical) order: the server 400s the
    // same variables in any other order.
    variables: { input: {
      categories: ["Driving", "Approach", "Putting", "Scoring"],
      first: 250,
      subCats: ["offTheTeeStrokesGained", "approachStrokesGained", "puttingStrokesGained", "teeToGreenStrokesGained"],
      tournamentId: img,
    } },
  };
  return getJson(IMG, {
    method: "POST",
    headers: { "content-type": "application/json", ...imgHeaders(img, "StatsGetGolfTournamentStats", IMG_STATS.queryHash) },
    body: JSON.stringify(body),
  });
}

// ── names ──────────────────────────────────────────────────────────
const FOLD = { ø: "o", Ø: "o", æ: "ae", Æ: "ae", ß: "ss", ł: "l", Ł: "l", đ: "d", Đ: "d", ı: "i" };
export function normName(s) {
  const t = String(s ?? "").includes(",") ? s.split(",").map((x) => x.trim()).reverse().join(" ") : String(s ?? "");
  return t.replace(/[øØæÆßłŁđĐı]/g, (c) => FOLD[c]).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
/** Match by full name, then surname + first initial (handles "Nacho"
 *  vs "Ignacio" style first-name variants only when unambiguous). */
function nameMatcher(entries) {
  const full = new Map();
  const loose = new Map();
  for (const e of entries) {
    full.set(normName(e.name), e);
    const k = `${normName(e.last)}|${normName(e.first).slice(0, 1)}`;
    loose.set(k, loose.has(k) ? null : e);
  }
  return (name, first, last) => full.get(normName(name)) ?? (last ? loose.get(`${normName(last)}|${normName(first).slice(0, 1)}`) ?? null : null);
}

const titleCase = (s) => String(s ?? "").toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

// ── weather (Open-Meteo archive; shape matches lib/weather/open-meteo.ts) ──
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const degToCompass = (d) => (typeof d === "number" ? COMPASS[Math.round((d % 360) / 22.5) % 16] : null);
function classifyCode(c) {
  if (typeof c !== "number") return { condition: "—", emoji: "" };
  if (c === 0) return { condition: "Clear", emoji: "☀️" };
  if (c === 1) return { condition: "Mostly clear", emoji: "🌤" };
  if (c === 2) return { condition: "Partly cloudy", emoji: "⛅" };
  if (c === 3) return { condition: "Overcast", emoji: "☁️" };
  if (c >= 45 && c <= 48) return { condition: "Fog", emoji: "🌫" };
  if (c >= 51 && c <= 57) return { condition: "Drizzle", emoji: "🌦" };
  if (c >= 61 && c <= 67) return { condition: "Rain", emoji: "🌧" };
  if (c >= 80 && c <= 82) return { condition: "Showers", emoji: "🌧" };
  if (c >= 95) return { condition: "Thunderstorm", emoji: "⛈" };
  return { condition: "—", emoji: "" };
}
function headline(w) {
  const parts = [];
  if (w.emoji) parts.push(w.emoji);
  if (typeof w.tempMaxF === "number") parts.push(`${Math.round(w.tempMaxF)}°F`);
  const wb = [];
  if (typeof w.windAvgMph === "number") { wb.push(`${Math.round(w.windAvgMph)}mph`); if (w.windDirCompass) wb.push(w.windDirCompass); }
  if (typeof w.windGustMph === "number" && (w.windAvgMph ?? 0) > 0) wb.push(`(gusts ${Math.round(w.windGustMph)})`);
  if (wb.length) parts.push(`Wind ${wb.join(" ")}`);
  if (typeof w.precipInches === "number") parts.push(w.precipInches < 0.05 ? "Dry" : `${w.precipInches.toFixed(2)}" rain`);
  return parts.join(" · ");
}
async function archiveWeather(venue, dates) {
  const daily = "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,weather_code";
  const hourly = "temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m";
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${venue.lat}&longitude=${venue.lon}&start_date=${dates[0]}&end_date=${dates.at(-1)}&daily=${daily}&hourly=${hourly}&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${encodeURIComponent(venue.tz)}`;
  const j = await getJson(url);
  const byDate = new Map();
  const h = j?.hourly;
  for (let i = 0; i < (h?.time ?? []).length; i++) {
    const day = h.time[i].slice(0, 10);
    const dir = h.wind_direction_10m?.[i] ?? null;
    const arr = byDate.get(day) ?? [];
    arr.push({ time: h.time[i], hour: Number(h.time[i].slice(11, 13)), windMph: h.wind_speed_10m?.[i] ?? null, windGustMph: h.wind_gusts_10m?.[i] ?? null,
      windDirDeg: dir, windDirCompass: degToCompass(dir), tempF: h.temperature_2m?.[i] ?? null, precipInches: h.precipitation?.[i] ?? null });
    byDate.set(day, arr);
  }
  const out = new Map();
  const d = j?.daily;
  for (let i = 0; i < (d?.time ?? []).length; i++) {
    const dir = d.wind_direction_10m_dominant?.[i] ?? null;
    const code = d.weather_code?.[i] ?? null;
    const base = { date: d.time[i], tempMaxF: d.temperature_2m_max?.[i] ?? null, tempMinF: d.temperature_2m_min?.[i] ?? null,
      windAvgMph: d.wind_speed_10m_max?.[i] ?? null, windGustMph: d.wind_gusts_10m_max?.[i] ?? null, windDirDeg: dir,
      windDirCompass: degToCompass(dir), precipInches: d.precipitation_sum?.[i] ?? null, weatherCode: code, ...classifyCode(code) };
    out.set(d.time[i], { ...base, headline: headline(base), hourly: byDate.get(d.time[i]) ?? [] });
  }
  return out;
}

// ── OSM greens + tees → per-hole green outline, frame, bearing ─────
async function loadOsm() {
  const cache = resolve(ROOT, "data", "dpwt", `osm-${SLUG}.json`);
  if (existsSync(cache)) return JSON.parse(await readFile(cache, "utf-8"));
  const [s, w, n, e] = V.osmBbox;
  const q = `[out:json][timeout:120];( way["golf"~"green|tee"](${s},${w},${n},${e}); );out tags geom;`;
  for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    try {
      const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "pardle-onboard/1.0" }, signal: AbortSignal.timeout(150_000) });
      if (!r.ok) continue;
      const j = await r.json();
      const slim = j.elements.map((el) => ({ golf: el.tags?.golf, ref: el.tags?.ref ?? null, geometry: el.geometry.map((g) => [g.lat, g.lon]) }));
      await writeFile(cache, JSON.stringify(slim));
      return slim;
    } catch { /* next endpoint */ }
  }
  throw new Error("overpass unavailable");
}
const centroid = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const bearingDeg = (from, to) => ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360;

/**
 * For each hole: the OSM green containing (most of) that hole's IMG
 * pins, and the tee whose straight-line distance to that green best
 * matches the card yardage. Frame: 16:9 (the aspect the pin tools draw
 * green images at), green centroid at (0.5, 0.5), rotated so the
 * tee->green line points up, scaled so the green fills ~80% of the
 * tighter dimension.
 */
function buildHoleGeometry(osm, pinsUtmByHole, cardYards, parByHole, fairways) {
  const toUtm = ([la, lo]) => { const u = latLonToUtm(la, lo, V.utmZone); return [u.x, u.y]; };
  const fairwayPolys = (fairways ?? []).map((f) => f.map(toUtm));
  const greens = osm.filter((e) => e.golf === "green").map((e) => e.geometry.map(([la, lo]) => { const u = latLonToUtm(la, lo, V.utmZone); return [u.x, u.y]; }));
  const tees = osm.filter((e) => e.golf === "tee").map((e) => centroid(e.geometry.map(([la, lo]) => { const u = latLonToUtm(la, lo, V.utmZone); return [u.x, u.y]; })));
  const out = {};
  const usedTees = new Set();
  for (let h = 1; h <= 18; h++) {
    const pins = pinsUtmByHole[h] ?? [];
    if (!pins.length) continue;
    const pc = centroid(pins);
    let best = null;
    for (const g of greens) {
      const inside = pins.filter((p) => pointInPoly(p, g)).length;
      const c = centroid(g);
      const dist = Math.hypot(c[0] - pc[0], c[1] - pc[1]);
      const score = inside * 1000 - dist;
      if (!best || score > best.score) best = { g, c, inside, dist, score };
    }
    if (!best || (best.inside === 0 && best.dist > 40)) { console.warn(`[osm] hole ${h}: no green near the pins`); continue; }
    const target = (cardYards[h] ?? 0) * 0.9144;
    let tee = null;
    tees.forEach((t, i) => {
      const d = Math.hypot(t[0] - best.c[0], t[1] - best.c[1]);
      // Doglegs make the straight line shorter than the card, never longer.
      const err = d > target * 1.04 ? 1e9 : Math.abs(target - d) + (usedTees.has(i) ? 25 : 0);
      if (!tee || err < tee.err) tee = { i, t, d, err };
    });
    if (tee) usedTees.add(tee.i);
    // OSM maps tee boxes for only some holes here, so a distance match
    // can grab another hole's tee (checked on a rendered course map:
    // those lines cut across fairways). Fairways are well mapped and
    // every green sits at the end of one, so for par 4/5 the bearing is
    // from the fairway's far end to the green. Par 3s keep the tee
    // match when its distance agrees with the card.
    let fairway = null;
    for (const fp of fairwayPolys) {
      const d = Math.min(...fp.map((v) => Math.hypot(v[0] - best.c[0], v[1] - best.c[1])));
      if (d < 60 && (!fairway || d < fairway.d)) fairway = { fp, d };
    }
    const fairwayBearing = fairway
      ? (() => {
          const far = fairway.fp.reduce((a, v) => (Math.hypot(v[0] - best.c[0], v[1] - best.c[1]) > Math.hypot(a[0] - best.c[0], a[1] - best.c[1]) ? v : a));
          return bearingDeg(far, best.c);
        })()
      : null;
    const teeAgrees = tee && Math.abs(tee.d - target) <= target * 0.12;
    const bearing = parByHole[h] === 3 && teeAgrees ? bearingDeg(tee.t, best.c) : fairwayBearing ?? (teeAgrees ? bearingDeg(tee.t, best.c) : null);
    const bearingSource = parByHole[h] === 3 && teeAgrees ? "tee" : fairwayBearing != null ? "fairway" : teeAgrees ? "tee" : "none";
    const th = rad(bearing ?? 0);
    const local = (p) => {
      const dx = p[0] - best.c[0], dy = p[1] - best.c[1];
      return { fwd: dx * Math.sin(th) + dy * Math.cos(th), right: dx * Math.cos(th) - dy * Math.sin(th) };
    };
    const maxRight = Math.max(...best.g.map((p) => Math.abs(local(p).right)), 8);
    const maxFwd = Math.max(...best.g.map((p) => Math.abs(local(p).fwd)), 8);
    const W = Math.max(2 * maxRight, ((2 * maxFwd) * 16) / 9) / 0.8;
    const H = (W * 9) / 16;
    const toFrame = (p) => { const l = local(p); return [+(0.5 + l.right / W).toFixed(4), +(0.5 - l.fwd / H).toFixed(4)]; };
    out[h] = {
      bearing: bearing == null ? null : +bearing.toFixed(1),
      bearingSource,
      teeToGreenYards: tee ? Math.round(tee.d / 0.9144) : null,
      pinsInsideGreen: best.inside,
      pinsTotal: pins.length,
      frame: { cx: best.c[0], cy: best.c[1], bearing: bearing ?? 0, widthMetres: +W.toFixed(2), heightMetres: +H.toFixed(2), utmZone: V.utmZone },
      greenOutline: best.g.map(toFrame),
      toFrame,
    };
  }
  return out;
}
const rad = (d) => (d * Math.PI) / 180;

// ── main ───────────────────────────────────────────────────────────
await mkdir(OUT_DIR, { recursive: true });
const editions = [];
for (const ed of V.editions) {
  console.log(`\n=== ${ed.year} (DPWT ${ed.eventId}${ed.img ? `, IMG ${ed.img}` : ""}) ===`);
  const lb = await dpwt(`/api/sportdata/Leaderboard/Strokeplay/${ed.eventId}`);
  const hbh = {}, tt = {}, holeAvg = {};
  for (let r = 1; r <= 4; r++) {
    hbh[r] = await dpwt(`/api/sportdata/HoleByHole/Event/${ed.eventId}/Round/${r}`).catch(() => null);
    tt[r] = await dpwt(`/api/sportdata/Teetimes/Event/${ed.eventId}/Round/${r}`).catch(() => null);
    holeAvg[r] = await dpwt(`/api/sportdata/HoleAverages/Event/${ed.eventId}/Round/${r}`).catch(() => null);
  }
  // IMG sometimes omits the outer `data` wrapper; normalise to it.
  const wrap = (j) => (j && !j.data ? { data: j } : j);
  const ci = ed.img ? wrap(await imgCourseInfo(ed.img)) : null;
  const stats = ed.img ? wrap(await imgStats(ed.img)) : null;
  const dgRounds = await dg(`/historical-raw-data/rounds?tour=euro&event_id=${ed.eventId}&year=${ed.year}`).catch((e) => { console.warn("[dg]", e.message); return null; });
  editions.push({ ...ed, lb, hbh, tt, holeAvg, ci, stats, dgRounds });
  console.log(`[dpwt] ${lb?.Players?.length ?? 0} players; [img] course ${ci ? "yes" : "no"}, stats ${stats ? "yes" : "no"}; [dg] ${dgRounds?.scores?.length ?? 0} players`);
}

// Pars + card yardage from the most recent edition's hole averages.
const latest = editions.at(-1);
const parByHole = {}, cardYards = {};
for (const h of latest.holeAvg[1].Courses[0].Holes) { parByHole[h.HoleNo] = h.HolePar; cardYards[h.HoleNo] = h.Yards; }
const coursePar = Object.values(parByHole).reduce((a, b) => a + b, 0);

// Pins (UTM) per hole across every tracked edition/round → geometry.
const pinsUtmByHole = {};
for (const ed of editions) {
  for (const rd of ed.ci?.data?.getGolfTournament?.golfCourses?.[0]?.rounds ?? []) {
    for (const h of rd.holes) {
      const p = h.pinPlacement;
      if (!p || !(p.z > 1e6)) continue;
      (pinsUtmByHole[h.holeNo] ??= []).push([p.x, p.z]);
    }
  }
}
const allPins = Object.values(pinsUtmByHole).flat();
const vc = utmToLatLon(...centroid(allPins), V.utmZone);
const venue = { name: V.courseName, lat: +vc.lat.toFixed(4), lon: +vc.lon.toFixed(4), tz: V.tz };
const osm = await loadOsm();
const fairwayFile = resolve(ROOT, "data", "dpwt", `osm-fairways-${SLUG}.json`);
const fairways = existsSync(fairwayFile) ? JSON.parse(await readFile(fairwayFile, "utf-8")) : [];
const geo = buildHoleGeometry(osm, pinsUtmByHole, cardYards, parByHole, fairways);
for (let h = 1; h <= 18; h++) {
  const g = geo[h];
  console.log(`[geo] hole ${String(h).padStart(2)} par ${parByHole[h]} card ${cardYards[h]}y -> bearing ${g?.bearing ?? "?"} (${g?.bearingSource ?? "-"}), pins in green ${g?.pinsInsideGreen ?? 0}/${g?.pinsTotal ?? 0}`);
}

const files = [];
for (const ed of editions) {
  const names = (ed.lb?.Players ?? []).map((p) => ({ id: p.PlayerId, first: p.FirstName, last: p.LastName, name: `${p.FirstName ?? ""} ${p.LastName ?? ""}`.trim(), p }));
  // DG: name -> row
  const dgMatch = nameMatcher((ed.dgRounds?.scores ?? []).map((s) => {
    const [last, first] = s.player_name.split(",").map((x) => x.trim());
    return { name: `${first} ${last}`, first, last, s };
  }));
  // IMG stats: per player, per round, per subCat
  const imgByPlayer = new Map();
  for (const blk of ed.stats?.data?.getGolfTournamentStats ?? []) {
    for (const sc of blk.subCats ?? []) {
      for (const rk of sc.rankings ?? []) {
        const pl = rk.players?.[0];
        if (!pl) continue;
        const key = `${pl.firstName} ${pl.lastName}`;
        const e = imgByPlayer.get(key) ?? { name: key, first: pl.firstName, last: pl.lastName, imgId: pl.id, rounds: {} };
        for (const rr of rk.rounds ?? []) (e.rounds[rr.round] ??= {})[sc.subCat] = rr.total;
        imgByPlayer.set(key, e);
      }
    }
  }
  const imgMatch = nameMatcher([...imgByPlayer.values()]);
  // Tee times: playerId -> round -> { teetime, startHole }
  const tee = {};
  for (let r = 1; r <= 4; r++) {
    for (const c of ed.tt[r]?.Courses ?? []) for (const m of c.Matches ?? []) for (const pl of m.Players ?? []) {
      (tee[pl.PlayerId] ??= {})[r] = { teetime: m.TeeTime, startHole: m.Tee ?? 1 };
    }
  }
  // Hole scores: playerId -> round -> hole -> strokes
  const holes = {};
  for (let r = 1; r <= 4; r++) {
    for (const pl of ed.hbh[r]?.Players ?? []) for (const h of pl.Holes ?? []) {
      if (typeof h.Strokes === "number" && h.Strokes > 0) (((holes[pl.PlayerId] ??= {})[r] ??= {})[h.HoleNo] = h.Strokes);
    }
  }
  // IMG yardage + pins per round
  const yardsByRound = {}, pinsByRoundByHole = {};
  for (const rd of ed.ci?.data?.getGolfTournament?.golfCourses?.[0]?.rounds ?? []) {
    // IMG numbers playoffs as round 401+; keep regulation rounds only.
    if (rd.roundNo < 1 || rd.roundNo > 4) continue;
    for (const h of rd.holes) {
      if (h.actualYardage) (yardsByRound[rd.roundNo] ??= {})[h.holeNo] = h.actualYardage;
      const p = h.pinPlacement;
      if (p && p.z > 1e6 && geo[h.holeNo]) {
        const [x, y] = geo[h.holeNo].toFrame([p.x, p.z]);
        (pinsByRoundByHole[rd.roundNo] ??= {})[h.holeNo] = { x, y, utmX: +p.x.toFixed(2), utmY: +p.z.toFixed(2) };
      }
    }
  }
  const roundDates = {};
  // DP World leaderboards don't carry the round dates; take them from the
  // DG event date (Sunday) when available, else the schedule history.
  const sunday = ed.dgRounds?.event_completed ?? null;
  if (sunday) for (let r = 1; r <= 4; r++) {
    const d = new Date(`${sunday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (4 - r));
    roundDates[r] = d.toISOString().slice(0, 10);
  }
  const weather = Object.keys(roundDates).length ? await archiveWeather(venue, Object.values(roundDates)) : new Map();
  const weatherByRound = Object.fromEntries(Object.entries(roundDates).map(([r, d]) => [r, weather.get(d) ?? null]));

  const r1 = roundDates[1];
  const skill = r1 ? await buildPreTournamentSkillMap(r1, { tours: ["euro", "pga"], log: console.log }) : {};

  const fmtTee = (t) => {
    const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    return `${((h + 11) % 12) + 1}:${m[2]}${h < 12 ? "am" : "pm"}`;
  };
  const players = [];
  let dgMatched = 0, imgMatched = 0;
  for (const n of names) {
    const d = dgMatch(n.name, n.first, n.last);
    const im = imgMatch(n.name, n.first, n.last);
    if (d) dgMatched++;
    if (im) imgMatched++;
    const rounds = {};
    for (const rr of n.p.Rounds ?? []) {
      const r = rr.RoundNo;
      const hs = holes[n.id]?.[r] ?? {};
      if (!rr.Strokes || Object.keys(hs).length < 18) continue;
      const dr = d?.s?.[`round_${r}`];
      const ir = im?.rounds?.[r];
      const ott = ir?.offTheTeeStrokesGained ?? null, app = ir?.approachStrokesGained ?? null;
      const t2g = ir?.teeToGreenStrokesGained ?? null, putt = ir?.puttingStrokesGained ?? null;
      rounds[r] = {
        teetime: fmtTee(tee[n.id]?.[r]?.teetime),
        startHole: tee[n.id]?.[r]?.startHole ?? 1,
        score: rr.Strokes,
        sgTotal: typeof dr?.sg_total === "number" ? dr.sg_total : null,
        sgOtt: ott, sgApp: app,
        sgArg: t2g != null && ott != null && app != null ? +(t2g - ott - app).toFixed(3) : null,
        sgPutt: putt,
        coursePar,
        courseName: V.courseName,
        holes: Object.fromEntries(Object.entries(hs).map(([h, s]) => [h, { strokes: s, par: parByHole[h], yards: yardsByRound[r]?.[h] ?? cardYards[h] }])),
      };
    }
    if (!Object.keys(rounds).length) continue;
    const dgId = d ? String(d.s.dg_id) : null;
    const sks = Object.values(rounds).map((x) => x.sgTotal).filter((x) => typeof x === "number");
    players.push({
      dgId, dpwtId: n.id, imgId: im?.imgId ?? null,
      name: titleCase(n.name),
      finText: n.p.MissedCut ? "CUT" : n.p.PositionDesc,
      skillBaseline: dgId && skill[dgId] ? +skill[dgId].mean.toFixed(3) : sks.length ? +(sks.reduce((a, b) => a + b, 0) / sks.length).toFixed(3) : null,
      rounds,
    });
  }
  const payload = {
    tour: "dpwt",
    year: ed.year,
    tournamentId: `D${ed.eventId}`,
    dpwtEventId: ed.eventId,
    imgEventId: ed.img,
    dgEventId: ed.eventId,
    dgEventName: ed.dgRounds?.event_name ?? V.eventName,
    venue,
    roundDates,
    weatherByRound,
    yardsByRound,
    pinsByRoundByHole,
    generatedAt: new Date().toISOString(),
    players,
  };
  const file = resolve(OUT_DIR, `${SLUG}-${ed.year}.json`);
  await writeFile(file, JSON.stringify(payload, null, 1) + "\n");
  files.push(file);
  console.log(`[write] ${ed.year}: ${players.length} players (dg ${dgMatched}/${names.length}, img ${ed.img ? `${imgMatched}/${names.length}` : "n/a"}), pins ${Object.values(pinsByRoundByHole).reduce((a, r) => a + Object.keys(r).length, 0)}, weather ${Object.values(weatherByRound).filter(Boolean).length}/4`);
}

const meta = {
  tour: "dpwt",
  slug: SLUG,
  eventName: V.eventName,
  venue,
  coursePar,
  courseHolePars: parByHole,
  cardYards,
  holeBearings: Object.fromEntries(Object.entries(geo).filter(([, g]) => g.bearing != null).map(([h, g]) => [h, g.bearing])),
  greens: Object.fromEntries(Object.entries(geo).map(([h, g]) => [h, { frame: g.frame, outline: g.greenOutline }])),
  holeBearingSources: Object.fromEntries(Object.entries(geo).map(([h, g]) => [h, g.bearingSource])),
  holeBearingsHint: "Bearing per hole toward the green. Green = the OpenStreetMap green polygon containing that hole's IMG Arena pin positions. Par 4/5: from the far end of the OSM fairway that runs into that green. Par 3: from the OSM tee whose distance matches the card yardage (within 12%), else the fairway. Checked against a rendered course map.",
};
await writeFile(resolve(OUT_DIR, `${SLUG}-meta.json`), JSON.stringify(meta, null, 1) + "\n");
const liveFile = resolve(OUT_DIR, "_live-tournaments.json");
const live = existsSync(liveFile) ? JSON.parse(await readFile(liveFile, "utf-8")) : {};
live[SLUG] = { tournamentId: `D${V.live.eventId}`, dpwtEventId: V.live.eventId, imgEventId: V.live.img, year: V.live.year, roundDates: V.live.roundDates };
await writeFile(liveFile, JSON.stringify(live, null, 1) + "\n");
console.log("done.");
