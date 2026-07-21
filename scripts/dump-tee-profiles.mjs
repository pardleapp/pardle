/**
 * scripts/dump-tee-profiles.mjs
 *
 * One-shot dumper. Writes every ≥100-shot player's raw ball-flight
 * shape stats to a scratch JSON so the Python course-fit analysis
 * (scripts/investigate-course-fit.py) can read them without
 * re-implementing the Redis + eligibility logic.
 *
 * Output: <scratchpad>/tee-profiles.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf-8");
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
  } catch {}
}
await loadEnvFile(resolve(REPO_ROOT, ".env.local"));
await loadEnvFile(resolve(REPO_ROOT, ".env.vercel.production"));

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!REDIS_URL || !REDIS_TOKEN) {
  console.error("[dump-tee-profiles] Redis creds missing");
  process.exit(1);
}
const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const MIN_SHOTS = 100;

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function eligibleDrives(records) {
  const layer1 = records.filter(
    (r) =>
      r.par >= 4 &&
      (r.launchSpin === 0 || r.launchSpin <= 3500) &&
      r.ballSpeed >= 148,
  );
  if (layer1.length < 20) return layer1;
  const medianBs = median(layer1.map((r) => r.ballSpeed));
  const floor = Math.max(148, medianBs - 15);
  return layer1.filter((r) => r.ballSpeed >= floor);
}
function shapeStatsOf(records) {
  const r = eligibleDrives(records);
  if (r.length === 0) return null;
  return {
    ballSpeed: mean(r.map((x) => x.ballSpeed)),
    carry: mean(r.map((x) => x.carry)),
    apexHeight: mean(r.map((x) => x.apexHeight)),
    verticalLaunchAngle: mean(r.map((x) => x.verticalLaunchAngle)),
    horizontalLaunchAngle: mean(r.map((x) => x.horizontalLaunchAngle)),
    curve: mean(r.map((x) => x.curve)),
    absCurve: mean(r.map((x) => Math.abs(x.curve))),
    carrySide: mean(r.map((x) => x.carrySide)),
    launchSpin: mean(r.map((x) => x.launchSpin)),
    sideSpin: mean(
      r.map((x) => x.launchSpin * Math.sin((x.spinAxis * Math.PI) / 180)),
    ),
    n: r.length,
  };
}

console.log("[dump-tee-profiles] loading player index…");
const rawIndex = await redis.zrange("tee:index", 0, 1000, {
  rev: true,
  withScores: true,
});
const playerIds = [];
for (let i = 0; i < rawIndex.length; i += 2) {
  const pid = String(rawIndex[i]);
  const shotCount = Number(rawIndex[i + 1]);
  if (shotCount >= MIN_SHOTS) playerIds.push({ pid, shotCount });
}
console.log(`  ${playerIds.length} players with ≥${MIN_SHOTS} shots`);

const CHUNK = 25;
const out = [];
for (let i = 0; i < playerIds.length; i += CHUNK) {
  const chunk = playerIds.slice(i, i + CHUNK);
  const results = await Promise.all(
    chunk.map(async ({ pid, shotCount }) => {
      const [records, name] = await Promise.all([
        redis.get(`tee:player:${pid}`),
        redis.get(`tee:name:${pid}`),
      ]);
      if (!records || records.length === 0) return null;
      const stats = shapeStatsOf(records);
      if (!stats) return null;
      return {
        pid,
        name: name || pid,
        normName: normName(name || ""),
        shotCount,
        stats,
      };
    }),
  );
  for (const r of results) if (r) out.push(r);
  process.stdout.write(`\r  ${out.length}/${playerIds.length}`);
}
process.stdout.write("\n");

const outPath =
  "C:/Users/tombu/AppData/Local/Temp/claude/C--Users-tombu/5a909a8d-fe44-4c1d-875e-2e0a94af8d09/scratchpad/tee-profiles.json";
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log(`[dump-tee-profiles] wrote ${out.length} profiles to ${outPath}`);
