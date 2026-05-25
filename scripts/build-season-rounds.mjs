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
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(
  __dirname,
  "..",
  "lib",
  "data",
  "season-rounds.json",
);

const TOUR = "pga";
const SEASON = 2026;
const KEEP_EVENTS_PER_PLAYER = 8;

const DG_KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
if (!DG_KEY) {
  console.error(
    "[build-season-rounds] DATAGOLF_API_KEY not set — copy from .env.local before running.",
  );
  process.exit(1);
}

const DG_BASE = "https://feeds.datagolf.com";

async function dg(path) {
  const url = `${DG_BASE}${path}${path.includes("?") ? "&" : "?"}file_format=json&key=${DG_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`DataGolf ${path} → ${res.status} ${await res.text()}`);
  }
  return res.json();
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
  console.log("[build-season-rounds] fetching event list…");
  const events = await dg(`/historical-raw-data/event-list?tour=${TOUR}`);
  const inSeason = events
    .filter((e) => e.calendar_year === SEASON && e.sg_categories === "yes")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  console.log(
    `[build-season-rounds] ${inSeason.length} events with SG data for ${SEASON}`,
  );

  // playerKey → { name, rounds: [...] }
  const byPlayer = new Map();

  for (const ev of inSeason) {
    console.log(
      `[build-season-rounds] fetching ${ev.event_name} (${ev.date})…`,
    );
    let payload;
    try {
      payload = await dg(
        `/historical-raw-data/rounds?tour=${TOUR}&event_id=${ev.event_id}&year=${SEASON}`,
      );
    } catch (err) {
      console.warn(`[build-season-rounds] skip ${ev.event_name}: ${err.message}`);
      continue;
    }
    if (!payload || !Array.isArray(payload.scores)) continue;
    for (const row of payload.scores) {
      const displayName = flipName(row.player_name);
      const key = normaliseName(displayName);
      if (!key) continue;
      let entry = byPlayer.get(key);
      if (!entry) {
        entry = { name: displayName, rounds: [] };
        byPlayer.set(key, entry);
      }
      for (let r = 1; r <= 4; r++) {
        const rd = row[`round_${r}`];
        if (!rd) continue;
        if (
          typeof rd.score !== "number" ||
          typeof rd.course_par !== "number"
        ) {
          continue;
        }
        entry.rounds.push({
          season: SEASON,
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
        });
      }
    }
  }

  // Sort each player's rounds newest-first, trim to last ~8 events
  // worth of rounds. Use eventId distinct-count as the cap.
  for (const entry of byPlayer.values()) {
    entry.rounds.sort((a, b) => (a.date < b.date ? 1 : -1));
    const seenEvents = new Set();
    entry.rounds = entry.rounds.filter((r) => {
      seenEvents.add(r.eventId);
      return seenEvents.size <= KEEP_EVENTS_PER_PLAYER;
    });
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
