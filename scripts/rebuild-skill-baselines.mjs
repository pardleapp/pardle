/**
 * scripts/rebuild-skill-baselines.mjs
 *
 * Walk every historical tournament JSON in data/historical/ and
 * rewrite each player's `skillBaseline` to the trailing-12-month
 * mean of their DataGolf sg_total ending on the day before R1 —
 * a pre-tournament estimate that mirrors how DG frames their own
 * skill rating.
 *
 * The previous baseline used the player's within-event 4-round
 * average, which leaked the target week's performance into the
 * "skill" estimate. That masked real over/underperformance and
 * made the tee-time chart's skill-adjusted axis show week-form
 * deviations rather than course/round bias.
 *
 * Idempotent — DG historical rounds don't change, and per-event
 * rounds are cached under data/dg-rounds-cache/. Safe to re-run.
 *
 *   node scripts/rebuild-skill-baselines.mjs
 *   node scripts/rebuild-skill-baselines.mjs --only wyndham,fedex-stjude
 *   node scripts/rebuild-skill-baselines.mjs --dry-run
 */

import { readFile, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreTournamentSkillMap } from "./lib/pretournament-skill.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const HIST_DIR = resolve(REPO_ROOT, "data", "historical");

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
    /* env absent — vars might already be set */
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

await loadEnvLocal();
const ARGS = parseArgs(process.argv.slice(2));
const ONLY = typeof ARGS.only === "string" ? ARGS.only.split(",") : null;
const DRY = ARGS["dry-run"] === true;

const files = readdirSync(HIST_DIR)
  .filter((f) => /^[a-z0-9-]+-\d{4}\.json$/.test(f))
  .sort();

console.log(`[rebuild] scanning ${files.length} historical files in ${HIST_DIR}`);

let updated = 0;
let skipped = 0;
for (const f of files) {
  const match = f.match(/^([a-z0-9-]+)-(\d{4})\.json$/);
  const slug = match[1];
  const year = Number(match[2]);
  if (ONLY && !ONLY.includes(slug)) {
    skipped++;
    continue;
  }
  const path = resolve(HIST_DIR, f);
  const j = JSON.parse(await readFile(path, "utf8"));
  const r1Date = j.roundDates?.["1"];
  if (!r1Date) {
    console.warn(`[rebuild] ${f}: no roundDates.1 — skipping`);
    skipped++;
    continue;
  }
  console.log(`\n=== ${slug} ${year} (R1: ${r1Date}) ===`);
  const skillMap = await buildPreTournamentSkillMap(r1Date, {
    log: (m) => console.log(`  ${m}`),
  });
  // Rewrite each player's skillBaseline in place. Players who
  // don't clear MIN_ROUNDS (5) fall back to null — the tool
  // already renders those with a warning triangle and no
  // skill-adjustment.
  let filled = 0;
  let empty = 0;
  for (const p of j.players ?? []) {
    const rec = skillMap[String(p.dgId)];
    if (rec) {
      p.skillBaseline = Number(rec.mean.toFixed(3));
      filled++;
    } else {
      p.skillBaseline = null;
      empty++;
    }
  }
  console.log(
    `  [write] skillBaseline: ${filled} filled from trailing-12mo mean, ${empty} left null`,
  );
  if (!DRY) {
    await writeFile(path, JSON.stringify(j, null, 2));
    updated++;
  }
}

console.log(
  `\n[rebuild] done — updated ${updated}, skipped ${skipped}${DRY ? " (dry-run, nothing written)" : ""}`,
);
