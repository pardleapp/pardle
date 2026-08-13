/**
 * scripts/refill-historical-pins.mjs
 *
 * Backfill `pinsByRoundByHole` on a historical JSON when the
 * original fetch got zero pins (usually because the first three
 * finishers we tried had partial shotDetailsV3 payloads and the
 * fetch script gave up). Widens the sample to every player in
 * the file until at least one real pin coord lands per (round,
 * hole).
 *
 *   node scripts/refill-historical-pins.mjs --slug wyndham --year 2020
 *
 * Idempotent — same input = same output. Overwrites the file
 * in place.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

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
    /* env absent */
  }
}
await loadEnvLocal();
const ARGS = parseArgs(process.argv.slice(2));
const SLUG = ARGS.slug;
const YEAR = Number(ARGS.year);
if (!SLUG || !Number.isFinite(YEAR)) {
  console.error("usage: --slug <slug> --year <YYYY>");
  process.exit(1);
}
const PGA_KEY = process.env.PGATOUR_API_KEY || "da2-gsrx5bibzbb4njvhl7t37wqyl4";

async function pga(query) {
  const res = await fetch("https://orchestrator.pgatour.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": PGA_KEY,
      "x-pgat-platform": "web",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`PGA ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (j.errors)
    console.warn("[pga] gql errors:", JSON.stringify(j.errors).slice(0, 200));
  return j.data ?? null;
}

const path = resolve(REPO_ROOT, "data", "historical", `${SLUG}-${YEAR}.json`);
const j = JSON.parse(await readFile(path, "utf-8"));
const tournamentId = j.pgaTournamentId;
if (!tournamentId) {
  console.error(`[refill] ${SLUG}-${YEAR}: no pgaTournamentId in file`);
  process.exit(1);
}

// Iterate all players in the file, not just the first 3 — some
// events (Wyndham 2020, COVID restart) only had complete
// shotDetailsV3 payloads for later-tee finishers.
const playerIds = (j.players ?? [])
  .map((p) => p.pgaId)
  .filter((x) => typeof x === "string" && x.length > 0);
console.log(
  `[refill] ${SLUG} ${YEAR} → ${tournamentId} · ${playerIds.length} candidate players`,
);

const pins = { 1: {}, 2: {}, 3: {}, 4: {} };
for (const round of [1, 2, 3, 4]) {
  let attempts = 0;
  for (const pid of playerIds) {
    attempts++;
    let data;
    try {
      data = await pga(`{
        shotDetailsV3(tournamentId: "${tournamentId}", playerId: "${pid}", round: ${round}) {
          holes { holeNumber pinGreen { leftToRightCoords { x y } } }
        }
      }`);
    } catch (err) {
      console.warn(`  R${round} pid=${pid} err ${err.message.slice(0, 80)}`);
      continue;
    }
    const holes = data?.shotDetailsV3?.holes ?? [];
    let landed = 0;
    for (const h of holes) {
      const hn = Number(h?.holeNumber);
      const c = h?.pinGreen?.leftToRightCoords;
      const x = Number(c?.x);
      const y = Number(c?.y);
      if (
        Number.isFinite(hn) &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x !== -1 &&
        y !== -1
      ) {
        if (pins[round][hn] == null) {
          pins[round][hn] = { x, y };
          landed++;
        }
      }
    }
    if (landed > 0) {
      console.log(
        `  R${round} pid=${pid} → ${landed} new pins (${Object.keys(pins[round]).length}/18 total)`,
      );
    }
    if (Object.keys(pins[round]).length === 18) break;
    // Stop after 30 attempts even if incomplete — after that many
    // dry runs the event likely just doesn't have full ShotLink.
    if (attempts >= 30) {
      console.warn(
        `  R${round}: exhausted 30 candidates, giving up at ${Object.keys(pins[round]).length}/18`,
      );
      break;
    }
  }
}

const total = Object.values(pins).reduce((a, r) => a + Object.keys(r).length, 0);
console.log(`\n[refill] total pins: ${total}/72`);
if (total === 0) {
  console.error(`[refill] no pins found — leaving file unchanged`);
  process.exit(1);
}

j.pinsByRoundByHole = pins;
await writeFile(path, JSON.stringify(j, null, 2));
console.log(`[refill] wrote ${path}`);
