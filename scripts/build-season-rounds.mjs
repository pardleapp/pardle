/**
 * Build lib/data/season-rounds.json — per-player rich round-level
 * detail for the last ~8 PGA Tour starts. Powers the richer
 * season-form chips that the existing finish-only recent-form data
 * can't support:
 *
 *   - "4th sub-67 round in last 6 starts"
 *   - "First eagle since The Players"
 *   - "Bouncing back from missed cut"
 *
 * Source: DataGolf historical-raw-data endpoint. Pulls per-round
 * detail (score, course_par, eagles, birdies, doubles, SG total)
 * for each completed event in the current PGA season, aggregates
 * by normalised player name to match recent-form.json's key scheme.
 *
 *   node scripts/build-season-rounds.mjs
 *
 * Re-run weekly (Tuesdays after the previous event is settled).
 * Output is idempotent — same input = same JSON byte-for-byte.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// SG categories computed from ShotLink shots for events DataGolf only
// has SG: Total for (scripts/compute-shot-sg.mjs). Same overlay as
// lib/golf-api/computed-sg.ts: fills nulls only.
const COMPUTED_SG = new Map();
try {
  const dir = resolve(__dirname, "../data/sg-computed");
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(await readFile(resolve(dir, f), "utf-8"));
    COMPUTED_SG.set(`${j.eventId}:${j.year}`, j.players);
  }
} catch {
  /* no computed events */
}

// Load .env.local — same pattern the other scripts use.
async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf-8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* env file absent */
  }
}
await loadEnvFile(resolve(__dirname, "..", ".env.local"));
const OUT_PATH = resolve(
  __dirname,
  "..",
  "lib",
  "data",
  "season-rounds.json",
);

const TOUR = "pga";
const SEASONS = [2025, 2026];
// Bumped from 8 → 60 so a full ~2-season history fits per player.
// The investigation script (scripts/investigate-tee-sg.mjs) needs
// the raw shared-event overlap between pairs to be big enough that
// per-pair Pearson correlations aren't noise. Downstream consumers
// (recent-form chip, etc.) only read the newest few entries so
// growing the tail is safe.
const KEEP_EVENTS_PER_PLAYER = 60;

const DG_KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
if (!DG_KEY) {
  console.error(
    "[build-season-rounds] DATAGOLF_API_KEY not set — copy from .env.local before running.",
  );
  process.exit(1);
}

const DG_BASE = "https://feeds.datagolf.com";

// DataGolf suspends the key for 5 minutes after 45 requests in a
// minute. Unpaced, this script trips that ~45 events in and used to
// skip every event after it — the 2026-09-29 cron committed a file
// with the BMW Championship silently missing. Pace under the limit,
// sit out a suspension, and never write a partial file.
const MIN_GAP_MS = 1500;
const SUSPENSION_WAIT_MS = 5 * 60 * 1000 + 15_000;
const MAX_429_RETRIES = 2;
let lastRequestAt = 0;

async function dg(path) {
  const url = `${DG_BASE}${path}${path.includes("?") ? "&" : "?"}file_format=json&key=${DG_KEY}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const res = await fetch(url);
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      console.warn(`[build-season-rounds] 429 on ${path}; waiting out the suspension`);
      await new Promise((r) => setTimeout(r, SUSPENSION_WAIT_MS));
      continue;
    }
    if (!res.ok) {
      const err = new Error(`DataGolf ${path} → ${res.status} ${await res.text()}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

function normaliseName(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Convert DataGolf's "Last, First" → "First Last" for display. */
function flipName(s) {
  if (!s.includes(",")) return s;
  const [last, first] = s.split(",").map((p) => p.trim());
  return `${first} ${last}`;
}

async function main() {
  // playerKey → { name, rounds: [...], events: [...] }
  const byPlayer = new Map();

  for (const season of SEASONS) {
    console.log(`[build-season-rounds] fetching event list for ${season}…`);
    const events = await dg(`/historical-raw-data/event-list?tour=${TOUR}`);
    const inSeason = events
      .filter(
        (e) =>
          e.calendar_year === season &&
          (e.sg_categories === "yes" || COMPUTED_SG.has(`${e.event_id}:${season}`)),
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    console.log(
      `[build-season-rounds] ${season}: ${inSeason.length} events with SG data`,
    );

    for (const ev of inSeason) {
      console.log(
        `[build-season-rounds] ${season} · ${ev.event_name} (${ev.date})…`,
      );
      let payload;
      try {
        payload = await dg(
          `/historical-raw-data/rounds?tour=${TOUR}&event_id=${ev.event_id}&year=${season}`,
        );
      } catch (err) {
        if (err.status === 429) {
          throw new Error(
            `still rate-limited on ${ev.event_name} after retries — not writing a partial file`,
          );
        }
        console.warn(
          `[build-season-rounds] skip ${ev.event_name}: ${err.message}`,
        );
        continue;
      }
      if (!payload || !Array.isArray(payload.scores)) continue;
      const computed = COMPUTED_SG.get(`${ev.event_id}:${season}`);
      for (const row of payload.scores) {
        const cp = computed?.[String(row.dg_id)];
        if (cp) {
          for (let r = 1; r <= 4; r++) {
            const rd = row[`round_${r}`];
            const c = cp[String(r)];
            if (!rd || !c) continue;
            for (const k of ["sg_ott", "sg_app", "sg_arg", "sg_putt", "sg_t2g"]) rd[k] ??= c[k];
          }
        }
        const displayName = flipName(row.player_name);
        const key = normaliseName(displayName);
        if (!key) continue;
        let entry = byPlayer.get(key);
        if (!entry) {
          entry = { name: displayName, rounds: [], events: [] };
          byPlayer.set(key, entry);
        }
        // Per-event finish + SG decomposition aggregate.
        const evRounds = [];
        for (let r = 1; r <= 4; r++) {
          const rd = row[`round_${r}`];
          if (!rd) continue;
          if (
            typeof rd.score !== "number" ||
            typeof rd.course_par !== "number"
          ) {
            continue;
          }
          const roundEntry = {
            season,
            tournament: ev.event_name,
            date: ev.date,
            eventId: ev.event_id,
            round: r,
            coursePar: rd.course_par,
            score: rd.score,
            vsPar: rd.score - rd.course_par,
            eagles: rd.eagles_or_better ?? 0,
            birdies: rd.birdies ?? 0,
            doubles: rd.doubles_or_worse ?? 0,
            sgTotal: rd.sg_total ?? null,
            sgOtt: rd.sg_ott ?? null,
            sgApp: rd.sg_app ?? null,
            sgArg: rd.sg_arg ?? null,
            sgPutt: rd.sg_putt ?? null,
          };
          entry.rounds.push(roundEntry);
          evRounds.push(roundEntry);
        }
        if (evRounds.length > 0) {
          const sumNum = (key) =>
            evRounds.reduce(
              (acc, x) => acc + (typeof x[key] === "number" ? x[key] : 0),
              0,
            );
          const sgRounds = evRounds.filter((x) => x.sgTotal != null);
          const totalScore = evRounds.reduce((acc, x) => acc + x.score, 0);
          const totalPar = evRounds.reduce((acc, x) => acc + x.coursePar, 0);
          entry.events.push({
            season,
            tournament: ev.event_name,
            date: ev.date,
            eventId: ev.event_id,
            finText: String(row.fin_text ?? "").trim() || null,
            roundsPlayed: evRounds.length,
            totalScore,
            totalToPar: totalScore - totalPar,
            sgTotal: sgRounds.length > 0 ? sumNum("sgTotal") : null,
            sgOtt: sgRounds.length > 0 ? sumNum("sgOtt") : null,
            sgApp: sgRounds.length > 0 ? sumNum("sgApp") : null,
            sgArg: sgRounds.length > 0 ? sumNum("sgArg") : null,
            sgPutt: sgRounds.length > 0 ? sumNum("sgPutt") : null,
          });
        }
      }
    }
  }

  // Sort each player's rounds newest-first, trim to last N events'
  // worth of rounds. DataGolf's event_id is only unique WITHIN a
  // season (event 100 in 2025 ≠ event 100 in 2026), so uniqueness
  // is keyed on (season, eventId).
  for (const entry of byPlayer.values()) {
    entry.rounds.sort((a, b) => (a.date < b.date ? 1 : -1));
    const seenEvents = new Set();
    entry.rounds = entry.rounds.filter((r) => {
      seenEvents.add(`${r.season}:${r.eventId}`);
      return seenEvents.size <= KEEP_EVENTS_PER_PLAYER;
    });
    entry.events.sort((a, b) => (a.date < b.date ? 1 : -1));
    entry.events = entry.events.slice(0, KEEP_EVENTS_PER_PLAYER);
  }

  const out = {};
  // Stable JSON key order by playerKey alphabetical
  for (const k of [...byPlayer.keys()].sort()) {
    out[k] = byPlayer.get(k);
  }
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  const bytes = (await readFile(OUT_PATH)).byteLength;
  console.log(
    `[build-season-rounds] wrote ${byPlayer.size} players (${(bytes / 1024).toFixed(0)} KB) to ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error("[build-season-rounds] failed", err);
  process.exit(1);
});
