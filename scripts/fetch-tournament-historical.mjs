/**
 * scripts/fetch-tournament-historical.mjs
 *
 * Onboard any PGA Tour tournament to the round-score forecast in one
 * command. Pulls every past instance of the event from DataGolf +
 * PGA Tour orchestrator and drops the JSONs the runtime consumes:
 *
 *   data/historical/{slug}-{year}.json  (per-year historical rounds)
 *   data/historical/_live-tournaments.json  (live-year tournamentId +
 *                                            round dates map, merged
 *                                            per slug)
 *
 * Usage:
 *
 *   node scripts/fetch-tournament-historical.mjs \
 *     --slug rocket-classic \
 *     --name "rocket|rocket classic" \
 *     --venue-name "Detroit Golf Club" \
 *     --venue-lat 42.4363 \
 *     --venue-lon -83.1245 \
 *     --venue-tz "America/Detroit" \
 *     [--years 2019,2020,2021,2022,2023,2024,2025] \
 *     [--live-round-dates 2026-06-25:1,2026-06-26:2,2026-06-27:3,2026-06-28:4] \
 *     [--live-tournament-id R2026524]
 *
 * `--name` is a substring pattern (case-insensitive, alternations OK)
 * matched against DataGolf's event_name and the PGA Tour orchestrator
 * schedule name. If --years is omitted, we onboard every past year
 * DataGolf has published for this event.
 *
 * If --live-round-dates + --live-tournament-id are provided, we
 * write/merge them into _live-tournaments.json so the runtime knows
 * which live-year id maps to which slug (also enabling wind-archive
 * lookups on the exact tour dates).
 *
 * Also emits `data/historical/{slug}-meta.json` with a courseHolePars
 * derived from the fetched scorecards. Hole bearings are left BLANK
 * — they must be filled in by hand from OSM tee-to-green geometry
 * (pin coords can't determine compass bearings). The tournament-
 * config runtime handles missing bearings by falling back to no wind
 * correction; add them when accuracy matters.
 *
 * Idempotent — same source data means the output files are byte-
 * identical.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(REPO_ROOT, "data", "historical");

// ── CLI parsing ────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));
function requireArg(key) {
  const v = ARGS[key];
  if (typeof v !== "string" || !v) {
    console.error(`[fetch-tournament-historical] missing --${key}`);
    process.exit(1);
  }
  return v;
}

const SLUG = requireArg("slug").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const NAME_PATTERN = requireArg("name");
const VENUE_NAME = requireArg("venue-name");
const VENUE_LAT = Number(requireArg("venue-lat"));
const VENUE_LON = Number(requireArg("venue-lon"));
const VENUE_TZ = requireArg("venue-tz");
if (!Number.isFinite(VENUE_LAT) || !Number.isFinite(VENUE_LON)) {
  console.error("[fetch-tournament-historical] --venue-lat/--venue-lon must be finite numbers");
  process.exit(1);
}

const EVENT_NAME_MATCH = new RegExp(NAME_PATTERN, "i");
const YEARS = ARGS.years
  ? String(ARGS.years).split(/[,\s]+/).map(Number).filter((n) => n > 2000 && n < 3000)
  : null; // null = auto-detect from DG event list

const VENUE = {
  name: VENUE_NAME,
  lat: VENUE_LAT,
  lon: VENUE_LON,
  tz: VENUE_TZ,
};

const LIVE_TOURNAMENT_ID = typeof ARGS["live-tournament-id"] === "string"
  ? ARGS["live-tournament-id"]
  : null;
const LIVE_ROUND_DATES_ARG = typeof ARGS["live-round-dates"] === "string"
  ? ARGS["live-round-dates"]
  : null;
function parseLiveRoundDates(s) {
  if (!s) return null;
  // Format: 2026-06-25:1,2026-06-26:2,...
  const map = {};
  for (const pair of s.split(/[,\s]+/)) {
    const [d, r] = pair.split(":");
    if (!d || !r) continue;
    const rnum = Number(r);
    if (!Number.isFinite(rnum) || rnum < 1 || rnum > 4) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    map[String(rnum)] = d;
  }
  return Object.keys(map).length === 4 ? map : null;
}
const LIVE_ROUND_DATES = parseLiveRoundDates(LIVE_ROUND_DATES_ARG);

console.log(`[fetch-tournament-historical] slug=${SLUG} name=/${NAME_PATTERN}/i venue="${VENUE.name}" (${VENUE.lat}, ${VENUE.lon}, ${VENUE.tz})`);
if (YEARS) console.log(`[fetch-tournament-historical] explicit years: ${YEARS.join(", ")}`);
else console.log(`[fetch-tournament-historical] auto-detecting years from DG event list`);
if (LIVE_TOURNAMENT_ID) console.log(`[fetch-tournament-historical] live tournamentId: ${LIVE_TOURNAMENT_ID}`);
if (LIVE_ROUND_DATES) console.log(`[fetch-tournament-historical] live round dates:`, LIVE_ROUND_DATES);

// ── Env loading (mirror season-rounds pattern) ─────────────────────
async function loadEnvLocal() {
  try {
    const text = await readFile(resolve(REPO_ROOT, ".env.local"), "utf-8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      const v = line
        .slice(eq + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // env file absent — env vars might already be set
  }
}
await loadEnvLocal();

const DG_KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
if (!DG_KEY) {
  console.error(
    "[fetch-tournament-historical] DATAGOLF_API_KEY not set — copy from .env.local before running.",
  );
  process.exit(1);
}
const PGA_KEY = process.env.PGATOUR_API_KEY || "da2-gsrx5bibzbb4njvhl7t37wqyl4";

// ── HTTP helpers ───────────────────────────────────────────────────
const DG_BASE = "https://feeds.datagolf.com";
const PGA_URL = "https://orchestrator.pgatour.com/graphql";

async function dg(path) {
  const url = `${DG_BASE}${path}${path.includes("?") ? "&" : "?"}file_format=json&key=${DG_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DG ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function pga(query) {
  const res = await fetch(PGA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": PGA_KEY,
      "x-pgat-platform": "web",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`PGA ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) {
    console.warn("[pga] graphql errors:", JSON.stringify(json.errors).slice(0, 200));
  }
  return json.data ?? null;
}

// ── Name utilities ─────────────────────────────────────────────────
function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

// DG names are "Last, First"; PGA orchestrator gives "First Last".
function dgNameToFirstLast(name) {
  const [last, first] = name.split(",").map((s) => s.trim());
  if (!first) return name.trim();
  return `${first} ${last}`;
}

// ── Fetch orchestration ────────────────────────────────────────────
async function findDgEventIds() {
  console.log("[dg] fetching event-list…");
  const list = await dg("/historical-raw-data/event-list?tour=pga");
  const out = {};
  for (const e of list) {
    if (!EVENT_NAME_MATCH.test(e.event_name)) continue;
    if (YEARS && !YEARS.includes(e.calendar_year)) continue;
    out[e.calendar_year] = { event_id: e.event_id, event_name: e.event_name };
  }
  console.log(`[dg] matched events for "${NAME_PATTERN}":`, out);
  return out;
}

async function findPgaTournamentIds(years) {
  const out = {};
  for (const year of years) {
    console.log(`[pga] schedule ${year}…`);
    const data = await pga(`{
      schedule(tourCode: "R", year: "${year}") {
        completed { tournaments { id tournamentName startDate } }
      }
    }`);
    const groups = data?.schedule?.completed ?? [];
    const flat = groups.flatMap((g) => g.tournaments ?? []);
    const hit = flat.find((t) => EVENT_NAME_MATCH.test(t.tournamentName));
    if (hit) {
      out[year] = { id: hit.id, name: hit.tournamentName };
    } else {
      console.warn(`[pga] no match for "${NAME_PATTERN}" in ${year} schedule`);
    }
  }
  console.log("[pga] matched tournamentIds:", out);
  return out;
}

async function fetchPgaFieldPlayerIds(tournamentId) {
  const data = await pga(`{
    leaderboardV2(id: "${tournamentId}") {
      players {
        ... on PlayerRowV2 {
          player { id displayName }
        }
      }
    }
  }`);
  const rows = data?.leaderboardV2?.players ?? [];
  const out = [];
  for (const r of rows) {
    const p = r?.player;
    if (!p?.id) continue;
    out.push({ id: p.id, displayName: p.displayName ?? "" });
  }
  return out;
}

async function fetchScorecardsChunk(tournamentId, playerIds) {
  const aliases = playerIds
    .map(
      (pid, i) =>
        // `yardage` is what scorecardV3 exposes per hole per round —
        // NOT available via courseStats for older seasons where the
        // orchestrator only carries a single roundless yardage. This
        // is the only orchestrator endpoint that surfaces per-round
        // tee movement pre-2023.
        `p${i}: scorecardV3(tournamentId: "${tournamentId}", playerId: "${pid}") {
          roundScores {
            roundNumber
            firstNine { holes { holeNumber score par yardage } }
            secondNine { holes { holeNumber score par yardage } }
          }
        }`,
    )
    .join("\n");
  const data = await pga(`{ ${aliases} }`);
  const out = {};
  for (let i = 0; i < playerIds.length; i++) {
    out[playerIds[i]] = data?.[`p${i}`] ?? null;
  }
  return out;
}

async function fetchAllScorecards(tournamentId, playerIds) {
  const CHUNK = 15;
  const out = {};
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const slice = playerIds.slice(i, i + CHUNK);
    console.log(
      `[pga] scorecards ${i + 1}-${i + slice.length} / ${playerIds.length}`,
    );
    const part = await fetchScorecardsChunk(tournamentId, slice);
    Object.assign(out, part);
  }
  return out;
}

/**
 * Per-round pin positions via shotDetailsV3.
 *
 * courseStats(tournamentId) only carries per-round pins for 2023+
 * — earlier seasons ship a single roundless pin per hole, which
 * the parser has to replicate to R1-R4 (all four rounds sit at the
 * same coord). shotDetailsV3 is a different endpoint that DOES
 * carry per-round pins going back to ~2017 (memory:
 * reference_pga_hole_yardage). It's per-player, but the pin is
 * the same for every player in a round, so any finisher's id works.
 *
 * Returns `pinsByRoundByHole[round][hole] = { x, y }` (raw frame —
 * consumers apply their own calibration if the display frame
 * differs). Missing rounds / holes fall through as undefined.
 */
async function fetchPerRoundPins(tournamentId, playerIds) {
  if (!playerIds || playerIds.length === 0) return {};
  // Try up to 3 different players per round in case the first
  // finisher's shot-detail payload is missing / partial.
  const CANDIDATES = playerIds.slice(0, 3);
  const out = { 1: {}, 2: {}, 3: {}, 4: {} };
  for (const round of [1, 2, 3, 4]) {
    let landed = false;
    for (const pid of CANDIDATES) {
      const q = `{
        shotDetailsV3(tournamentId: "${tournamentId}", playerId: "${pid}", round: ${round}) {
          holes {
            holeNumber
            pinGreen { leftToRightCoords { x y } }
          }
        }
      }`;
      const data = await pga(q).catch(() => null);
      const holes = data?.shotDetailsV3?.holes ?? [];
      if (holes.length === 0) continue;
      let anyRealCoord = false;
      for (const h of holes) {
        const hn = Number(h?.holeNumber);
        const c = h?.pinGreen?.leftToRightCoords;
        const x = Number(c?.x);
        const y = Number(c?.y);
        // shotDetailsV3 sometimes returns -1/-1 sentinels for events
        // it doesn't have pin data on file for. Skip those cleanly.
        if (
          Number.isFinite(hn) &&
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x !== -1 &&
          y !== -1
        ) {
          out[round][hn] = { x, y };
          anyRealCoord = true;
        }
      }
      if (anyRealCoord) {
        landed = true;
        break;
      }
    }
    if (!landed) {
      console.warn(`[pga] no per-round pins for ${tournamentId} R${round}`);
    }
  }
  return out;
}

/**
 * Skill baseline for historical charts.
 *
 * Preferred source: a DG pre-tournament predictions CSV saved at
 * data/historical/predictions/3m-open-{year}.csv (columns include
 * player_name and win). We turn win probability into a skill rating
 * using the log-odds vs a uniform-field baseline:
 *
 *     skill = clamp(-2.5, 3, ln(win * fieldSize))
 *
 * The intuition: a player with win prob = 1/N is exactly average
 * (skill 0). Double the average → +0.69 SG. 8× the average → +2 SG.
 * Zero wins is clamped to 0.1/N so log doesn't blow up. This gives
 * ~[-2.5, +2] on a mid-strength field like the 3M Open, and would
 * cleanly extend to +3 on a Scheffler-in-a-major field.
 *
 * Fallback (no CSV): within-event 4-round average sg_total per
 * player. Not as good — reveals week form rather than pre-tournament
 * skill — but strictly better than nothing.
 */
function skillFromWinProb(winProb, fieldSize) {
  if (fieldSize <= 0) return null;
  const floor = 0.1 / fieldSize;
  const w = Math.max(winProb ?? 0, floor);
  const raw = Math.log(w * fieldSize);
  return Math.max(-2.5, Math.min(3, raw));
}

// ── Weather (Open-Meteo archive) ──────────────────────────────────
// Pulled once per year at build time and baked into the JSON so the
// analysis pages never have to hit Open-Meteo at request time. Mirrors
// the shape of lib/weather/open-meteo.ts's DailyWeather (must stay
// in sync).
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
function degToCompass(d) {
  if (typeof d !== "number" || !Number.isFinite(d)) return null;
  return COMPASS[Math.round(((d % 360) / 22.5)) % 16];
}
function classifyCode(c) {
  if (typeof c !== "number") return { condition: "—", emoji: "" };
  if (c === 0) return { condition: "Clear", emoji: "☀️" };
  if (c === 1) return { condition: "Mostly clear", emoji: "🌤" };
  if (c === 2) return { condition: "Partly cloudy", emoji: "⛅" };
  if (c === 3) return { condition: "Overcast", emoji: "☁️" };
  if (c >= 45 && c <= 48) return { condition: "Fog", emoji: "🌫" };
  if (c >= 51 && c <= 57) return { condition: "Drizzle", emoji: "🌦" };
  if (c >= 61 && c <= 67) return { condition: "Rain", emoji: "🌧" };
  if (c >= 71 && c <= 77) return { condition: "Snow", emoji: "🌨" };
  if (c >= 80 && c <= 82) return { condition: "Showers", emoji: "🌧" };
  if (c >= 85 && c <= 86) return { condition: "Snow showers", emoji: "🌨" };
  if (c >= 95 && c <= 99) return { condition: "Thunderstorm", emoji: "⛈" };
  return { condition: "—", emoji: "" };
}
function headline(w) {
  const parts = [];
  if (w.emoji) parts.push(w.emoji);
  if (typeof w.tempMaxF === "number") parts.push(`${Math.round(w.tempMaxF)}°F`);
  const wb = [];
  if (typeof w.windAvgMph === "number") {
    wb.push(`${Math.round(w.windAvgMph)}mph`);
    if (w.windDirCompass) wb.push(w.windDirCompass);
  }
  if (typeof w.windGustMph === "number" && (w.windAvgMph ?? 0) > 0) {
    wb.push(`(gusts ${Math.round(w.windGustMph)})`);
  }
  if (wb.length) parts.push(`Wind ${wb.join(" ")}`);
  if (typeof w.precipInches === "number") {
    if (w.precipInches < 0.05) parts.push("Dry");
    else parts.push(`${w.precipInches.toFixed(2)}" rain`);
  }
  return parts.join(" · ");
}
async function fetchArchiveWeather(dates) {
  if (!dates.length) return new Map();
  const start = dates[0], end = dates[dates.length - 1];
  const daily = "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,weather_code";
  const hourly = "temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m";
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${VENUE.lat}&longitude=${VENUE.lon}&start_date=${start}&end_date=${end}&daily=${daily}&hourly=${hourly}&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${encodeURIComponent(VENUE.tz)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[weather] ${res.status} ${await res.text().catch(() => "")}`);
    return new Map();
  }
  const j = await res.json();
  const d = j?.daily;
  const h = j?.hourly;
  // Bucket hourly points by date
  const hourlyByDate = new Map();
  if (h?.time) {
    for (let i = 0; i < h.time.length; i++) {
      const t = h.time[i];
      const day = t.slice(0, 10);
      const hourNum = Number(t.slice(11, 13));
      const dir = h.wind_direction_10m?.[i] ?? null;
      const arr = hourlyByDate.get(day) ?? [];
      arr.push({
        time: t,
        hour: Number.isFinite(hourNum) ? hourNum : 0,
        windMph: h.wind_speed_10m?.[i] ?? null,
        windGustMph: h.wind_gusts_10m?.[i] ?? null,
        windDirDeg: dir,
        windDirCompass: degToCompass(dir),
        tempF: h.temperature_2m?.[i] ?? null,
        precipInches: h.precipitation?.[i] ?? null,
      });
      hourlyByDate.set(day, arr);
    }
  }
  const out = new Map();
  if (!d?.time) return out;
  for (let i = 0; i < d.time.length; i++) {
    const dir = d.wind_direction_10m_dominant?.[i] ?? null;
    const code = d.weather_code?.[i] ?? null;
    const { condition, emoji } = classifyCode(code);
    const base = {
      date: d.time[i],
      tempMaxF: d.temperature_2m_max?.[i] ?? null,
      tempMinF: d.temperature_2m_min?.[i] ?? null,
      windAvgMph: d.wind_speed_10m_max?.[i] ?? null,
      windGustMph: d.wind_gusts_10m_max?.[i] ?? null,
      windDirDeg: dir,
      windDirCompass: degToCompass(dir),
      precipInches: d.precipitation_sum?.[i] ?? null,
      weatherCode: code,
      condition,
      emoji,
    };
    out.set(d.time[i], {
      ...base,
      headline: headline(base),
      hourly: hourlyByDate.get(d.time[i]) ?? [],
    });
  }
  return out;
}

/** Given "2023-07-30" (event_completed = Sunday R4), return
 *  { 1: "2023-07-27", 2: "2023-07-28", 3: "2023-07-29", 4: "2023-07-30" }
 *  as UTC-date-only strings — matches Open-Meteo's daily buckets in
 *  America/Chicago (round rollover happens after midnight local). */
function roundDatesFromSunday(sundayStr) {
  const m = sundayStr?.match?.(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const sunday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const iso = (d) => d.toISOString().slice(0, 10);
  const days = {};
  for (let r = 1; r <= 4; r++) {
    const d = new Date(sunday);
    d.setUTCDate(sunday.getUTCDate() - (4 - r));
    days[r] = iso(d);
  }
  return days;
}

function normNameForCsv(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

async function loadPredictionsCsv(year) {
  const p = resolve(REPO_ROOT, "data", "historical", "predictions", `${SLUG}-${year}.csv`);
  let text;
  try {
    text = await readFile(p, "utf-8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const parse = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === ",") {
          out.push(cur);
          cur = "";
        } else cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const header = parse(lines[0]);
  const nameIdx = header.indexOf("player_name");
  const winIdx = header.indexOf("win");
  if (nameIdx < 0 || winIdx < 0) return null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parse(lines[i]);
    const name = cells[nameIdx]?.replace(/^"|"$/g, "");
    const winStr = cells[winIdx];
    if (!name || winStr == null) continue;
    const win = Number(winStr);
    if (!Number.isFinite(win)) continue;
    rows.push({ name, win });
  }
  return rows;
}

/** Build a normalisedName → skill map from the predictions CSV. */
function buildCsvSkillMap(csvRows) {
  const out = new Map();
  if (!csvRows) return out;
  const N = csvRows.length;
  for (const r of csvRows) {
    const skill = skillFromWinProb(r.win, N);
    if (skill != null) {
      // DG's CSV uses "Last, First"; normalise both orderings so we
      // can match against the historical-rounds `player_name` field.
      out.set(normNameForCsv(r.name), skill);
      const [last, first] = r.name.split(",").map((s) => s.trim());
      if (first) out.set(normNameForCsv(`${first} ${last}`), skill);
    }
  }
  return out;
}

function derivePerPlayerSkillBaseline(dgScores, csvSkillMap) {
  const out = {};
  for (const row of dgScores ?? []) {
    const dgId = String(row.dg_id);
    // Preferred: CSV-derived skill from pre-tournament win probability.
    const csvSkill = csvSkillMap?.get(normNameForCsv(row.player_name));
    if (typeof csvSkill === "number") {
      out[dgId] = csvSkill;
      continue;
    }
    // Fallback: within-event 4-round average sg_total.
    const sgs = [];
    for (let rn = 1; rn <= 4; rn++) {
      const r = row[`round_${rn}`];
      if (r && typeof r.sg_total === "number") sgs.push(r.sg_total);
    }
    if (sgs.length === 0) continue;
    out[dgId] = sgs.reduce((a, b) => a + b, 0) / sgs.length;
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  const dgIds = await findDgEventIds();
  const yearsToProcess =
    YEARS ?? Object.keys(dgIds).map(Number).sort((a, b) => a - b);
  console.log(
    `[fetch-tournament-historical] will process years: ${yearsToProcess.join(", ")}`,
  );
  if (yearsToProcess.length === 0) {
    console.error(
      "[fetch-tournament-historical] no years matched — check --name pattern",
    );
    process.exit(1);
  }
  const pgaIds = await findPgaTournamentIds(yearsToProcess);

  await mkdir(OUT_DIR, { recursive: true });

  // Aggregators used for the per-slug meta file at the end.
  const perHoleScoreAccum = {};

  for (const year of yearsToProcess) {
    const dgMeta = dgIds[year];
    if (!dgMeta) {
      console.warn(`[skip] ${year}: no DG event_id`);
      continue;
    }
    console.log(`\n=== ${year} — DG event_id ${dgMeta.event_id} ===`);
    const dgRounds = await dg(
      `/historical-raw-data/rounds?tour=pga&event_id=${dgMeta.event_id}&year=${year}`,
    );

    const csvRows = await loadPredictionsCsv(year);
    const csvSkillMap = buildCsvSkillMap(csvRows);
    if (csvRows) {
      console.log(`[csv] predictions CSV loaded for ${year}: ${csvRows.length} rows`);
    } else {
      console.log(`[csv] no predictions CSV for ${year} — falling back to within-event avg`);
    }
    const skillMap = derivePerPlayerSkillBaseline(dgRounds.scores, csvSkillMap);
    const csvBackedCount = Object.entries(skillMap).filter(([id]) => {
      const row = dgRounds.scores?.find((s) => String(s.dg_id) === id);
      return row && csvSkillMap.get(normNameForCsv(row.player_name)) != null;
    }).length;
    console.log(
      `[dg] skill baselines: ${csvBackedCount} from CSV (pre-tournament win-prob), ` +
        `${Object.keys(skillMap).length - csvBackedCount} from within-event 4-round avg`,
    );

    // PGA hole-level data (optional — heatmap degrades if missing)
    let holesByPgaId = {};
    let pgaPlayerMap = new Map();
    let pinsByRoundByHole = null;
    const pgaMeta = pgaIds[year];
    if (pgaMeta) {
      console.log(`[pga] tournamentId ${pgaMeta.id} (${pgaMeta.name})`);
      const field = await fetchPgaFieldPlayerIds(pgaMeta.id);
      for (const p of field) {
        pgaPlayerMap.set(normName(p.displayName), p);
      }
      console.log(`[pga] field: ${field.length} players`);
      // Per-round pin positions via shotDetailsV3 — the only
      // orchestrator source that carries per-round pins for
      // pre-2023 events. Pull once per tournament (any finisher's
      // id works, pin is shared across the field for a round).
      pinsByRoundByHole = await fetchPerRoundPins(
        pgaMeta.id,
        field.map((p) => p.id),
      );
      const pinsFound = Object.values(pinsByRoundByHole).reduce(
        (acc, byHole) => acc + Object.keys(byHole).length,
        0,
      );
      console.log(`[pga] shotDetailsV3 pins: ${pinsFound}/72 (round, hole) cells`);
      const scorecards = await fetchAllScorecards(
        pgaMeta.id,
        field.map((p) => p.id),
      );
      // Reshape to holes[round][hole] = { strokes, par }
      for (const [pid, sc] of Object.entries(scorecards)) {
        if (!sc?.roundScores) continue;
        const rounds = {};
        for (const r of sc.roundScores) {
          const round = Number(r.roundNumber);
          if (!round) continue;
          const holes = {};
          const consume = (nine) => {
            for (const h of nine?.holes ?? []) {
              const num = Number(h.holeNumber);
              const strokes = Number(h.score);
              const par = Number(h.par);
              const yards = Number(h.yardage);
              if (num && Number.isFinite(strokes) && strokes > 0) {
                holes[num] = {
                  strokes,
                  par: Number.isFinite(par) ? par : 4,
                  // Yardage is per-hole per-round — same for every
                  // player in a round, but written on every row so
                  // the merge step downstream can pick any player's
                  // scorecard as authoritative.
                  yards: Number.isFinite(yards) && yards > 0 ? yards : null,
                };
              }
            }
          };
          consume(r.firstNine);
          consume(r.secondNine);
          rounds[round] = holes;
        }
        holesByPgaId[pid] = rounds;
      }
    }

    // Round dates + daily weather (Open-Meteo archive). event_completed
    // in the DG payload is the Sunday finish; the four rounds run
    // Thu→Sun in the venue's local timezone. If parsing fails we
    // silently proceed with no weather so a bad DG date never blocks
    // the whole build.
    const roundDates = roundDatesFromSunday(dgRounds.event_completed);
    let weatherByRound = { 1: null, 2: null, 3: null, 4: null };
    if (roundDates) {
      const dateList = [1, 2, 3, 4].map((r) => roundDates[r]).filter(Boolean);
      const weatherByDate = await fetchArchiveWeather(dateList);
      console.log(
        `[weather] ${weatherByDate.size}/${dateList.length} days resolved for ${year}`,
      );
      for (const r of [1, 2, 3, 4]) {
        const w = weatherByDate.get(roundDates[r]);
        weatherByRound[r] = w ?? null;
      }
    } else {
      console.warn(`[weather] no event_completed date for ${year}, skipping`);
    }

    // Merge DG per-round rows with PGA per-hole rows
    const players = [];
    for (const row of dgRounds.scores ?? []) {
      const fullName = dgNameToFirstLast(row.player_name);
      const pgaEntry = pgaPlayerMap.get(normName(fullName));
      const dgId = String(row.dg_id);
      const rounds = {};
      for (let rn = 1; rn <= 4; rn++) {
        const r = row[`round_${rn}`];
        if (!r) continue;
        rounds[rn] = {
          teetime: r.teetime ?? null,
          startHole: Number.isFinite(r.start_hole) ? r.start_hole : 1,
          score: r.score,
          sgTotal: r.sg_total,
          sgOtt: r.sg_ott,
          sgApp: r.sg_app,
          sgArg: r.sg_arg,
          sgPutt: r.sg_putt,
          coursePar: r.course_par,
          courseName: r.course_name,
          holes: pgaEntry ? (holesByPgaId[pgaEntry.id]?.[rn] ?? null) : null,
        };
      }
      players.push({
        dgId,
        pgaId: pgaEntry?.id ?? null,
        name: fullName,
        finText: row.fin_text,
        skillBaseline: skillMap[dgId] ?? null,
        rounds,
      });
    }

    const payload = {
      year,
      dgEventId: dgMeta.event_id,
      dgEventName: dgMeta.event_name,
      pgaTournamentId: pgaMeta?.id ?? null,
      venue: VENUE,
      roundDates: roundDates ?? null,
      weatherByRound,
      // Per-round per-hole pin coords from shotDetailsV3 — raw
      // frame, ready for the pin-birdies aggregator's affine
      // calibration to transform into the enhanced-frame green
      // image. Pre-2023 seasons have no other source for per-round
      // pins (courseStats gives one roundless entry per hole for
      // 2019-2022, and per-round data but no enhanced coords for
      // 2023). 2023+ can still use this as a raw calibration
      // reference if the courseStats enhanced pair isn't
      // populated — the aggregator picks the best available.
      pinsByRoundByHole: pinsByRoundByHole ?? null,
      generatedAt: null, // deterministic — no timestamp so re-runs stay idempotent
      players,
    };
    const outPath = resolve(OUT_DIR, `${SLUG}-${year}.json`);
    await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
    console.log(`[write] ${outPath} — ${players.length} players`);

    // Feed the meta aggregator: per-hole average score across all
    // ingested rounds. Used to derive courseHolePars post-loop.
    for (const p of players) {
      for (const rd of Object.values(p.rounds ?? {})) {
        for (const [hStr, hole] of Object.entries(rd.holes ?? {})) {
          if (typeof hole?.strokes !== "number") continue;
          const h = Number(hStr);
          if (!Number.isFinite(h)) continue;
          const acc = (perHoleScoreAccum[h] ??= { sum: 0, n: 0 });
          acc.sum += hole.strokes;
          acc.n += 1;
        }
      }
    }
  }

  // ── Emit per-slug meta ────────────────────────────────────────────
  // courseHolePars derived from per-hole mean strokes, bucketed 3/4/5.
  // The tournament-config runtime does the same fallback, so this is
  // a nice-to-have; the runtime picks up meta files whenever they
  // exist and prefers them over the derived version.
  const derivedHolePars = {};
  for (const [hStr, acc] of Object.entries(perHoleScoreAccum)) {
    const h = Number(hStr);
    if (acc.n === 0) continue;
    const avg = acc.sum / acc.n;
    derivedHolePars[h] =
      avg < 3.6 ? 3 : avg < 4.6 ? 4 : 5;
  }
  const derivedCoursePar =
    Object.values(derivedHolePars).reduce((a, b) => a + b, 0) || null;

  const metaPath = resolve(OUT_DIR, `${SLUG}-meta.json`);
  // Preserve any hand-edited holeBearings from an existing meta file.
  let existingBearings = null;
  if (existsSync(metaPath)) {
    try {
      const prev = JSON.parse(await readFile(metaPath, "utf-8"));
      if (prev.holeBearings) existingBearings = prev.holeBearings;
    } catch {
      /* re-emit fresh */
    }
  }
  const meta = {
    slug: SLUG,
    eventName: VENUE.name.replace(/ *[-—] .*$/, ""),
    venue: VENUE,
    coursePar: derivedCoursePar,
    courseHolePars: derivedHolePars,
    holeBearings: existingBearings ?? {},
    holeBearingsHint:
      "Compass bearings (0-360°) per hole, tee → green. Must be filled in by hand from OSM tee-to-green geometry — pin coords can't determine bearings because the pin frame is per-hole rotated. Runtime falls back to no wind correction until this is populated.",
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n");
  console.log(`[write] ${metaPath}`);

  // ── Merge into _live-tournaments.json ─────────────────────────────
  if (LIVE_TOURNAMENT_ID && LIVE_ROUND_DATES) {
    const liveMetaPath = resolve(OUT_DIR, "_live-tournaments.json");
    let liveMeta = {};
    if (existsSync(liveMetaPath)) {
      try {
        liveMeta = JSON.parse(await readFile(liveMetaPath, "utf-8"));
      } catch {
        liveMeta = {};
      }
    }
    liveMeta[SLUG] = {
      tournamentId: LIVE_TOURNAMENT_ID,
      roundDates: LIVE_ROUND_DATES,
    };
    await writeFile(
      liveMetaPath,
      JSON.stringify(liveMeta, null, 2) + "\n",
    );
    console.log(
      `[write] ${liveMetaPath} (merged ${SLUG} → ${LIVE_TOURNAMENT_ID})`,
    );
  }

  console.log("\ndone.");
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
