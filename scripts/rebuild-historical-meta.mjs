/**
 * scripts/rebuild-historical-meta.mjs
 *
 * Regenerate every data/historical/{slug}-meta.json from the per-year
 * JSONs already on disk. No network calls — the scorecards we need
 * were captured at ingestion time.
 *
 * Exists because the original meta derivation inferred par from
 * scoring average and turned reachable par 5s into par 4s (East Lake
 * became a par 68). Re-running the full ingestion to fix that would
 * mean thousands of API calls for data we already hold.
 *
 * Hand-edited holeBearings are preserved.
 *
 *   node scripts/rebuild-historical-meta.mjs [--dry]
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveMeta } from "./lib/derive-meta.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "data", "historical");
const DRY = process.argv.includes("--dry");

const files = await readdir(OUT_DIR);
const bySlug = new Map();
for (const f of files) {
  const m = f.match(/^(.+)-(\d{4})\.json$/);
  if (!m) continue;
  const [, slug, year] = m;
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push({ year: Number(year), file: f });
}

for (const [slug, entries] of [...bySlug].sort()) {
  entries.sort((a, b) => a.year - b.year);
  const payloads = [];
  for (const e of entries) {
    try {
      payloads.push(JSON.parse(await readFile(resolve(OUT_DIR, e.file), "utf-8")));
    } catch (err) {
      console.log(`  [skip] ${e.file}: ${err.message}`);
    }
  }
  if (payloads.length === 0) continue;

  const metaPath = resolve(OUT_DIR, `${slug}-meta.json`);
  let prev = null;
  if (existsSync(metaPath)) {
    try {
      prev = JSON.parse(await readFile(metaPath, "utf-8"));
    } catch {
      /* rebuild from scratch */
    }
  }
  const derived = deriveMeta(payloads, { venueName: prev?.venue?.name });

  const before = prev?.courseHolePars ?? {};
  const changed = Object.keys(derived.courseHolePars).filter(
    (h) => Number(before[h]) !== derived.courseHolePars[h],
  );

  const meta = {
    slug,
    eventName: derived.eventName ?? prev?.eventName ?? null,
    venue: prev?.venue ?? null,
    coursePar: derived.coursePar,
    courseHolePars: derived.courseHolePars,
    holeBearings: prev?.holeBearings ?? {},
    holeBearingsHint:
      prev?.holeBearingsHint ??
      "Compass bearings (0-360°) per hole, tee → green. Filled from OSM tee-to-green geometry; runtime falls back to no wind correction when absent.",
  };

  console.log(
    `${slug}: par ${prev?.coursePar ?? "?"} -> ${meta.coursePar}` +
      `  name ${JSON.stringify(prev?.eventName ?? null)} -> ${JSON.stringify(meta.eventName)}` +
      `  holes changed: ${changed.length ? changed.join(",") : "none"}` +
      (derived.parMismatch
        ? `  [par varies by year: stated ${derived.parMismatch.statedPar}, holes sum ${derived.parMismatch.summedPar}]`
        : ""),
  );
  if (!DRY) {
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n");
  }
}
console.log(DRY ? "\ndry run — nothing written." : "\ndone.");
