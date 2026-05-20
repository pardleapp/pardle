/**
 * Read golf-model's tournament_results.csv and produce a compact
 * JSON file keyed by normalised player name. Each value is an array
 * of the most recent 8 PGA Tour starts with finish text + numeric
 * position + whether the player made the cut.
 *
 * Sized to ship in the Pardle bundle — ~50-150 KB.
 *
 *   node scripts/build-recent-form.mjs
 *
 * Reads:  C:\Users\tombu\golf-model\data\tournament_results.csv
 * Writes: lib/data/recent-form.json
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = "C:\\Users\\tombu\\golf-model\\data\\tournament_results.csv";
const OUT_PATH = resolve(__dirname, "..", "lib", "data", "recent-form.json");

const KEEP_PER_PLAYER = 8;
// Keep the trailing window — 2024+ — so the file stays small and
// historic stuff doesn't dilute "recent form".
const MIN_SEASON = 2024;

/** Parse one CSV line respecting double-quoted fields with commas inside. */
function parseLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
      } else if (c === '"') {
        inQuote = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

/** "Last, First" → "First Last", trimmed and normalised. */
function flipName(s) {
  const m = /^([^,]+),\s*(.+)$/.exec(s.trim());
  if (!m) return s.trim();
  return `${m[2].trim()} ${m[1].trim()}`;
}

function normaliseName(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Extract a sortable numeric event number within season. */
function eventNum(tournamentId) {
  const m = /^(\d+)_(\d+)$/.exec(tournamentId);
  return m ? Number(m[2]) : 0;
}

async function main() {
  const rl = createInterface({
    input: createReadStream(CSV_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  /** @type {Record<string, { name: string; rows: any[] }>} */
  const byPlayer = {};
  let header = null;
  let count = 0;
  for await (const line of rl) {
    if (header === null) {
      header = parseLine(line);
      continue;
    }
    if (!line.trim()) continue;
    const fields = parseLine(line);
    if (fields.length < header.length) continue;
    const r = {};
    for (let i = 0; i < header.length; i++) r[header[i]] = fields[i];
    const season = Number(r.season);
    if (!Number.isFinite(season) || season < MIN_SEASON) continue;
    const finish = r.finish_text;
    if (!finish || finish === "WD" || finish === "DQ") continue;
    const tournament = r.tournament_name;
    if (!tournament) continue;
    const name = flipName(r.player_name);
    const key = normaliseName(name);
    if (!key) continue;
    const evt = eventNum(r.tournament_id);
    const finishPos =
      r.finish_position && r.finish_position !== ""
        ? Number(r.finish_position)
        : null;
    const madeCut = r.made_cut === "True";
    if (!byPlayer[key]) byPlayer[key] = { name, rows: [] };
    byPlayer[key].rows.push({
      season,
      eventNum: evt,
      tournament,
      finishText: finish,
      finishPos,
      madeCut,
    });
    count++;
  }
  console.log(`Read ${count} rows for ${Object.keys(byPlayer).length} players`);

  // Sort each player's rows newest-first, dedupe (season+tournament),
  // and trim to KEEP_PER_PLAYER.
  /** @type {Record<string, { name: string; recent: any[] }>} */
  const out = {};
  for (const [key, { name, rows }] of Object.entries(byPlayer)) {
    rows.sort((a, b) => {
      if (a.season !== b.season) return b.season - a.season;
      return b.eventNum - a.eventNum;
    });
    const seen = new Set();
    const deduped = [];
    for (const r of rows) {
      const k = `${r.season}|${r.tournament}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(r);
      if (deduped.length >= KEEP_PER_PLAYER) break;
    }
    const recent = deduped.map((r) => ({
      season: r.season,
      tournament: r.tournament,
      finishText: r.finishText,
      finishPos: r.finishPos,
      madeCut: r.madeCut,
    }));
    out[key] = { name, recent };
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out), "utf8");
  const sizeKb = Buffer.byteLength(JSON.stringify(out)) / 1024;
  console.log(`Wrote ${OUT_PATH} (${Object.keys(out).length} players, ${sizeKb.toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
