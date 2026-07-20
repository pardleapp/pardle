/**
 * scripts/fetch-3m-historical.mjs
 *
 * Pull the last three 3M Open events into local JSON so the
 * /analysis pages can render the tee-time and course-heatmap
 * views for 2023 / 2024 / 2025 without hitting external APIs at
 * request time.
 *
 * For each year:
 *   1. DataGolf historical-raw-data/event-list  →  event_id
 *   2. DataGolf historical-raw-data/rounds       →  per-round score, sg_total,
 *                                                   teetime, start_hole, course_par
 *   3. DataGolf historical-model-predictions/pre-tournament
 *                                                →  skill baseline (best effort)
 *   4. PGA Tour schedule(year) → 3M Open tournamentId
 *   5. PGA Tour leaderboardV2  → playerId + name list for that year
 *   6. PGA Tour scorecardV3 (chunks of 15)       →  per-hole scores + par
 *
 * Then merge DG rows (indexed by dg_id / player_name) with PGA rows
 * (indexed by orchestrator playerId), matched by normalised name,
 * and write:
 *
 *   data/historical/3m-open-{year}.json
 *
 * Idempotent — same source data means the output file is byte-identical.
 *
 *   node scripts/fetch-3m-historical.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(REPO_ROOT, "data", "historical");

// ── Config ─────────────────────────────────────────────────────────
const YEARS = [2023, 2024, 2025];
const EVENT_NAME_MATCH = /3\s*m\s*open/i; // "3M Open"

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
    "[fetch-3m-historical] DATAGOLF_API_KEY not set — copy from .env.local before running.",
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
    if (!YEARS.includes(e.calendar_year)) continue;
    out[e.calendar_year] = { event_id: e.event_id, event_name: e.event_name };
  }
  console.log(`[dg] matched 3M Open events:`, out);
  return out;
}

async function findPgaTournamentIds() {
  const out = {};
  for (const year of YEARS) {
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
      console.warn(`[pga] no 3M Open in ${year} schedule`);
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
        `p${i}: scorecardV3(tournamentId: "${tournamentId}", playerId: "${pid}") {
          roundScores {
            roundNumber
            firstNine { holes { holeNumber score par } }
            secondNine { holes { holeNumber score par } }
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
 * Skill baseline for historical charts.
 *
 * DG's `historical-model-predictions/pre-tournament` endpoint 404s on
 * our tier, and using the current 2026 `preds/skill-ratings` for a
 * 2023 event misgrades everyone who's improved / declined since (a
 * systematic bias). So instead we derive a within-event skill baseline
 * per player: their average sg_total across the 4 rounds of THIS event.
 *
 * Chart interpretation becomes "how much did this round deviate from
 * that player's own week average?" — a real, defensible skill-adjusted
 * signal that doesn't depend on any external prediction.
 */
function derivePerPlayerSkillBaseline(dgScores) {
  const out = {};
  for (const row of dgScores ?? []) {
    const sgs = [];
    for (let rn = 1; rn <= 4; rn++) {
      const r = row[`round_${rn}`];
      if (r && typeof r.sg_total === "number") sgs.push(r.sg_total);
    }
    if (sgs.length === 0) continue;
    const mean = sgs.reduce((a, b) => a + b, 0) / sgs.length;
    out[String(row.dg_id)] = mean;
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  const dgIds = await findDgEventIds();
  const pgaIds = await findPgaTournamentIds();

  await mkdir(OUT_DIR, { recursive: true });

  for (const year of YEARS) {
    const dgMeta = dgIds[year];
    if (!dgMeta) {
      console.warn(`[skip] ${year}: no DG event_id`);
      continue;
    }
    console.log(`\n=== ${year} — DG event_id ${dgMeta.event_id} ===`);
    const dgRounds = await dg(
      `/historical-raw-data/rounds?tour=pga&event_id=${dgMeta.event_id}&year=${year}`,
    );

    const skillMap = derivePerPlayerSkillBaseline(dgRounds.scores);
    console.log(`[dg] within-event skill baselines derived for ${Object.keys(skillMap).length} players`);

    // PGA hole-level data (optional — heatmap degrades if missing)
    let holesByPgaId = {};
    let pgaPlayerMap = new Map();
    const pgaMeta = pgaIds[year];
    if (pgaMeta) {
      console.log(`[pga] tournamentId ${pgaMeta.id} (${pgaMeta.name})`);
      const field = await fetchPgaFieldPlayerIds(pgaMeta.id);
      for (const p of field) {
        pgaPlayerMap.set(normName(p.displayName), p);
      }
      console.log(`[pga] field: ${field.length} players`);
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
              if (num && Number.isFinite(strokes) && strokes > 0) {
                holes[num] = { strokes, par: Number.isFinite(par) ? par : 4 };
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
      generatedAt: null, // deterministic — no timestamp so re-runs stay idempotent
      players,
    };
    const outPath = resolve(OUT_DIR, `3m-open-${year}.json`);
    await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
    console.log(`[write] ${outPath} — ${players.length} players`);
  }

  console.log("\ndone.");
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
