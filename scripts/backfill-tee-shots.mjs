/**
 * scripts/backfill-tee-shots.mjs
 *
 * Populate Redis with per-player tee-shot radar records for the last
 * two PGA Tour seasons. Powers the /analysis/tee-shots page.
 *
 * For each completed event in the covered seasons:
 *   1. leaderboardV2 → full field playerIds + displayNames
 *   2. shotDetailsV3 (chunks of 3 aliased calls, includeRadar: true)
 *      per player × round in {1,2,3,4}
 *   3. Filter to strokeNumber === 1 && fromLocationCode === "OTB"
 *      and to shots that have populated radarData + a valid
 *      normalizedTrajectoryV2 entry.
 *   4. Merge each player's records into Redis via lib/feed/tee-shots-store.
 *
 * Resume-friendly: the script marks each (tournamentId) in Redis after
 * completion so a re-run only picks up new events + retries failures.
 *
 *   node scripts/backfill-tee-shots.mjs                       # both seasons
 *   node scripts/backfill-tee-shots.mjs --season 2026         # one season
 *   node scripts/backfill-tee-shots.mjs --event R2026033      # one event
 *   node scripts/backfill-tee-shots.mjs --force               # ignore resume marks
 *   node scripts/backfill-tee-shots.mjs --limit 5             # first N events
 *
 * Runtime is a wall-clock function of orchestrator response time —
 * budget several hours for a full two-season backfill.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Env loading ────────────────────────────────────────────────────
// .env.local for local secrets and .env.vercel.production for the
// prod Redis creds (which live only in the Vercel-pulled file).
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
  } catch {
    // env file absent — ignore
  }
}
await loadEnvFile(resolve(REPO_ROOT, ".env.local"));
await loadEnvFile(resolve(REPO_ROOT, ".env.vercel.production"));

const PGA_KEY =
  process.env.PGATOUR_API_KEY || "da2-gsrx5bibzbb4njvhl7t37wqyl4";
// Both Vercel KV and raw Upstash naming schemes ship the same
// Upstash REST endpoint — accept either so this runs against local
// and production creds without ceremony.
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL;
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN;
if (!REDIS_URL || !REDIS_TOKEN) {
  console.error(
    "[backfill-tee-shots] Redis creds missing — expected KV_REST_API_URL/_TOKEN (or UPSTASH_REDIS_REST_URL/_TOKEN) in .env.local or .env.vercel.production",
  );
  process.exit(1);
}
const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

// ── CLI args ───────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
const SEASONS = argValue("--season")
  ? [Number(argValue("--season"))]
  : [2025, 2026];
const EVENT_FILTER = argValue("--event");
const FORCE = argv.includes("--force");
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : Infinity;

// ── Config ─────────────────────────────────────────────────────────
const GQL_URL = "https://orchestrator.pgatour.com/graphql";
const SHOT_CHUNK_SIZE = 3; // matches lib/golf-api/pgatour SHOT_CHUNK_SIZE
const PLAYER_TTL_SECONDS = 30 * 24 * 60 * 60;
const BACKFILL_MARK_KEY = "tee:backfill:done"; // Redis set of tournamentIds
const TEE_INDEX_KEY = "tee:index";
const teePlayerKey = (pid) => `tee:player:${pid}`;
const teeNameKey = (pid) => `tee:name:${pid}`;

// ── GraphQL helper ─────────────────────────────────────────────────
async function gql(query, attempt = 1) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": PGA_KEY,
      "x-pgat-platform": "web",
    },
    body: JSON.stringify({ query }),
  }).catch((err) => {
    console.error("[backfill] fetch failed", err.message);
    return null;
  });
  if (!res || !res.ok) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return gql(query, attempt + 1);
    }
    console.error("[backfill] gql non-2xx after retries");
    return null;
  }
  const json = await res.json();
  if (json.errors) {
    console.warn(
      "[backfill] graphql errors:",
      JSON.stringify(json.errors).slice(0, 400),
    );
  }
  return json.data ?? null;
}

// ── Schedule + leaderboard ─────────────────────────────────────────
async function getSchedule(year) {
  const data = await gql(
    `{ schedule(tourCode: "R", year: "${year}") {
        completed { tournaments { id tournamentName startDate } }
        upcoming  { tournaments { id tournamentName startDate } }
    } }`,
  );
  const groups = [
    ...(data?.schedule?.completed ?? []),
    ...(data?.schedule?.upcoming ?? []),
  ];
  return groups.flatMap((g) =>
    (g.tournaments ?? []).map((t) => ({
      id: t.id,
      name: t.tournamentName,
      startDate: t.startDate,
    })),
  );
}

async function getField(tournamentId) {
  const data = await gql(
    `{ leaderboardV2(id: "${tournamentId}") {
        players { ... on PlayerRowV2 {
          playerState currentRound
          player { id displayName }
        } }
    } }`,
  );
  const rows = data?.leaderboardV2?.players ?? [];
  const out = [];
  for (const r of rows) {
    if (!r?.player?.id) continue;
    out.push({
      playerId: r.player.id,
      playerName: r.player.displayName,
      state: r.playerState ?? "",
    });
  }
  return out;
}

// ── Tee-shot extractor (mirror lib/golf-api/pgatour.getTournamentTeeShots) ─
async function fetchTeeShots(tournamentId, requests) {
  if (requests.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < requests.length; i += SHOT_CHUNK_SIZE) {
    chunks.push(requests.slice(i, i + SHOT_CHUNK_SIZE));
  }
  const RADAR_QUERY_FIELDS = `holes {
    holeNumber par
    strokes {
      strokeNumber
      fromLocationCode
      radarData {
        ballSpeed
        apexHeight apexRange apexSide
        verticalLaunchAngle horizontalLaunchAngle
        launchSpin spinAxis
        actualFlightTime
        normalizedTrajectoryV2 {
          valid carry carrySide curve maxHeight spinAxis
          xFit yFit zFit timeInterval
        }
      }
    }
  }`;
  const nameById = new Map(requests.map((r) => [r.playerId, r.playerName]));
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const aliases = chunk
      .map(
        ({ playerId, round }) =>
          `s${playerId}_${round}: shotDetailsV3(tournamentId: "${tournamentId}", playerId: "${playerId}", round: ${round}, includeRadar: true) { ${RADAR_QUERY_FIELDS} }`,
      )
      .join("\n");
    const data = await gql(`{ ${aliases} }`);
    for (const { playerId, round, playerName } of chunk) {
      const node = data?.[`s${playerId}_${round}`] ?? null;
      for (const hole of node?.holes ?? []) {
        if (!hole) continue;
        for (const stroke of hole.strokes ?? []) {
          if (!stroke) continue;
          if (stroke.fromLocationCode !== "OTB") continue;
          if (stroke.strokeNumber !== 1) continue;
          // Match lib/golf-api/pgatour.getTournamentTeeShots — no
          // par-3 tee shots, no non-driver layups.
          if (hole.par === 3) continue;
          const radar = stroke.radarData;
          if (!radar) continue;
          const traj = radar.normalizedTrajectoryV2?.[0];
          if (!traj || traj.valid === false) continue;
          if (
            typeof radar.ballSpeed !== "number" ||
            typeof radar.apexHeight !== "number" ||
            typeof radar.horizontalLaunchAngle !== "number" ||
            typeof traj.carry !== "number"
          ) {
            continue;
          }
          // Match lib/golf-api/pgatour.getTournamentTeeShots.
          if (radar.launchSpin > 3500) continue;
          if (radar.ballSpeed < 148) continue;
          out.push({
            playerId,
            playerName: nameById.get(playerId) ?? playerName,
            tournamentId,
            round,
            hole: hole.holeNumber,
            par: hole.par,
            ballSpeed: radar.ballSpeed,
            apexHeight: radar.apexHeight,
            apexRange: radar.apexRange ?? 0,
            apexSide: radar.apexSide ?? 0,
            verticalLaunchAngle: radar.verticalLaunchAngle ?? 0,
            horizontalLaunchAngle: radar.horizontalLaunchAngle,
            launchSpin: radar.launchSpin ?? 0,
            spinAxis: radar.spinAxis ?? 0,
            actualFlightTime: radar.actualFlightTime ?? 0,
            carry: traj.carry,
            carrySide: traj.carrySide ?? 0,
            curve: traj.curve ?? 0,
            maxHeight: traj.maxHeight ?? 0,
            timeInterval: [
              traj.timeInterval?.[0] ?? 0,
              traj.timeInterval?.[1] ?? radar.actualFlightTime ?? 0,
            ],
            xFit: Array.isArray(traj.xFit) ? traj.xFit : [],
            yFit: Array.isArray(traj.yFit) ? traj.yFit : [],
            zFit: Array.isArray(traj.zFit) ? traj.zFit : [],
          });
        }
      }
    }
    // Light pacing — the orchestrator tolerates the shot chunks, but
    // hundreds in a row at the max rate start returning empty payloads.
    await new Promise((r) => setTimeout(r, 40));
    if ((i + 1) % 20 === 0) {
      process.stdout.write(
        `\r  chunk ${i + 1}/${chunks.length} (${out.length} records so far)`,
      );
    }
  }
  process.stdout.write("\n");
  return out;
}

// ── Redis write ────────────────────────────────────────────────────
async function persistPlayerShots(playerId, playerName, records) {
  if (records.length === 0) return;
  const existing = (await redis.get(teePlayerKey(playerId))) ?? [];
  // De-dup by (tournamentId, round, hole) so re-running an event
  // doesn't double-count.
  const seen = new Set(
    existing.map((r) => `${r.tournamentId}:${r.round}:${r.hole}`),
  );
  const additions = records.filter(
    (r) => !seen.has(`${r.tournamentId}:${r.round}:${r.hole}`),
  );
  if (additions.length === 0) return;
  const merged = [...existing, ...additions];
  await redis.set(teePlayerKey(playerId), merged, { ex: PLAYER_TTL_SECONDS });
  await redis.set(teeNameKey(playerId), playerName, { ex: PLAYER_TTL_SECONDS });
  await redis.zadd(TEE_INDEX_KEY, {
    score: merged.length,
    member: playerId,
  });
}

// ── Main loop ──────────────────────────────────────────────────────
async function main() {
  console.log(
    `[backfill-tee-shots] seasons=${SEASONS.join(",")} force=${FORCE} limit=${LIMIT} event=${EVENT_FILTER ?? "all"}`,
  );
  const done = FORCE
    ? new Set()
    : new Set((await redis.smembers(BACKFILL_MARK_KEY)) ?? []);
  console.log(`[backfill-tee-shots] ${done.size} events already backfilled`);
  const nowMs = Date.now();

  let allTournaments = [];
  for (const year of SEASONS) {
    const sched = await getSchedule(String(year));
    console.log(`[backfill-tee-shots] ${year}: ${sched.length} tournaments`);
    allTournaments.push(...sched);
  }
  // We only backfill events whose start is at least 5 days in the past
  // (i.e. definitely complete). And skip anything without an id.
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
  allTournaments = allTournaments
    .filter((t) => t.id && t.startDate < nowMs - FIVE_DAYS)
    .filter((t) => (EVENT_FILTER ? t.id === EVENT_FILTER : true))
    .filter((t) => (FORCE ? true : !done.has(t.id)))
    .sort((a, b) => b.startDate - a.startDate); // newest first
  if (allTournaments.length > LIMIT) {
    allTournaments = allTournaments.slice(0, LIMIT);
  }
  console.log(
    `[backfill-tee-shots] ${allTournaments.length} events to process`,
  );

  let totalRecords = 0;
  for (const t of allTournaments) {
    console.log(
      `[backfill-tee-shots] → ${t.name} (${t.id}, ${new Date(t.startDate).toISOString().slice(0, 10)})`,
    );
    const field = await getField(t.id);
    if (field.length === 0) {
      console.warn(`  no field returned — skipping`);
      continue;
    }
    console.log(`  field size: ${field.length}`);
    // Every player × rounds 1–4. Cut/WD players are still requested
    // — the orchestrator just returns whatever rounds they completed
    // and their tee shots there are still valid data.
    const requests = [];
    for (const p of field) {
      for (const round of [1, 2, 3, 4]) {
        requests.push({
          playerId: p.playerId,
          playerName: p.playerName,
          round,
        });
      }
    }
    console.log(`  fetching ${requests.length} (player, round) pairs…`);
    const records = await fetchTeeShots(t.id, requests);
    console.log(`  captured ${records.length} tee-shot records`);

    // Group by playerId + persist.
    const byPlayer = new Map();
    for (const rec of records) {
      let entry = byPlayer.get(rec.playerId);
      if (!entry) {
        entry = { playerName: rec.playerName, records: [] };
        byPlayer.set(rec.playerId, entry);
      }
      entry.records.push(rec);
    }
    let persisted = 0;
    for (const [pid, { playerName, records: r }] of byPlayer) {
      await persistPlayerShots(pid, playerName, r);
      persisted += r.length;
    }
    console.log(
      `  persisted ${persisted} records across ${byPlayer.size} players`,
    );
    totalRecords += persisted;
    await redis.sadd(BACKFILL_MARK_KEY, t.id);
  }

  console.log(
    `[backfill-tee-shots] DONE. total new records: ${totalRecords}`,
  );
}

main().catch((err) => {
  console.error("[backfill-tee-shots] fatal", err);
  process.exit(1);
});
