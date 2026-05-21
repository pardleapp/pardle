/**
 * Refresh lib/data/recent-form.json with the most recent PGA Tour
 * results from the orchestrator. Catches up tournaments completed
 * since the last CSV-driven build.
 *
 * Strategy:
 *   1. Pull the PGA Tour 2026 schedule from orchestrator.
 *   2. Filter to "completed" tournaments whose startDate is in the
 *      last DAYS_BACK days.
 *   3. For each, fetch the leaderboard (final positions per player).
 *   4. Merge into lib/data/recent-form.json keyed by normalised name:
 *        - skip events already present per player
 *        - prepend new events to .recent, sort newest-first, trim to 8
 *   5. Write the file back.
 *
 *   node scripts/refresh-recent-form.mjs
 *
 * Safe to re-run — idempotent.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "lib", "data", "recent-form.json");

const GQL_URL = "https://orchestrator.pgatour.com/graphql";
const API_KEY =
  process.env.PGATOUR_API_KEY || "da2-gsrx5bibzbb4njvhl7t37wqyl4";

const DAYS_BACK = 90;
const KEEP_PER_PLAYER = 8;
const YEAR = "2026";

async function gql(query) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "x-pgat-platform": "web",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`gql ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    console.error("[refresh-recent-form] gql errors", JSON.stringify(json.errors));
  }
  return json.data;
}

async function getSchedule() {
  const data = await gql(
    `{ schedule(tourCode: "R", year: "${YEAR}") {
        completed { tournaments { id tournamentName startDate } }
    } }`,
  );
  const flat = (data?.schedule?.completed ?? []).flatMap((g) =>
    g.tournaments.map((t) => ({
      id: t.id,
      name: t.tournamentName,
      startDate: t.startDate,
    })),
  );
  return flat;
}

async function getLeaderboard(tournamentId) {
  // leaderboardV2 has the final positions for completed tournaments.
  // Same query shape the live app uses (lib/golf-api/pgatour.ts).
  const data = await gql(
    `{ leaderboardV2(id: "${tournamentId}") {
        players { ... on PlayerRowV2 {
          position playerState
          player { id displayName }
        } }
    } }`,
  );
  const rows = data?.leaderboardV2?.players ?? [];
  return rows
    .map((r) => {
      if (!r || !r.player) return null;
      return {
        displayName: r.player.displayName,
        position: r.position ?? "",
        playerState: r.playerState ?? "",
      };
    })
    .filter(Boolean);
}

function normaliseName(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Convert orchestrator position string + state to (finishText, finishPos, madeCut). */
function parsePosition(position, state) {
  if (state === "CUT" || state === "MC") {
    return { finishText: "CUT", finishPos: null, madeCut: false };
  }
  if (state === "WD" || state === "DQ" || state === "DNS") {
    return null;
  }
  if (!position || position === "—") {
    return null;
  }
  const m = /^T?(\d+)$/.exec(position.trim());
  if (!m) return null;
  return {
    finishText: position,
    finishPos: Number(m[1]),
    madeCut: true,
  };
}

async function main() {
  const raw = await readFile(OUT_PATH, "utf8");
  const data = JSON.parse(raw);
  const cutoff = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;

  const schedule = await getSchedule();
  const recentEvents = schedule
    .filter((t) => t.startDate >= cutoff && t.startDate <= Date.now())
    .sort((a, b) => b.startDate - a.startDate);

  console.log(
    `Found ${recentEvents.length} completed PGA Tour events in last ${DAYS_BACK} days:`,
  );
  for (const e of recentEvents) {
    console.log("  -", e.name);
  }

  // Track which players we touched so we know which to re-sort at the end.
  const touchedKeys = new Set();
  let touched = 0;
  for (const e of recentEvents) {
    let lb;
    try {
      lb = await getLeaderboard(e.id);
    } catch (err) {
      console.error(`  ! failed: ${e.name}`, err.message);
      continue;
    }
    if (lb.length === 0) {
      console.log(`  · ${e.name}: empty leaderboard, skipping`);
      continue;
    }
    let added = 0;
    for (const row of lb) {
      const parsed = parsePosition(row.position, row.playerState);
      if (!parsed) continue;
      const key = normaliseName(row.displayName);
      if (!key) continue;
      const player = data[key] ?? { name: row.displayName, recent: [] };
      // Dedupe by (season, tournament) — a 2024 "PGA Championship" row
      // doesn't block adding the 2026 one.
      const dup = player.recent.find(
        (r) => r.tournament === e.name && r.season === Number(YEAR),
      );
      if (dup) continue;
      player.recent.push({
        season: Number(YEAR),
        tournament: e.name,
        finishText: parsed.finishText,
        finishPos: parsed.finishPos,
        madeCut: parsed.madeCut,
        // Stash startDate so the post-merge sort can place this entry
        // chronologically vs CSV-sourced entries (which only have season).
        startDate: e.startDate,
      });
      data[key] = player;
      touchedKeys.add(key);
      added++;
    }
    console.log(`  + ${e.name}: ${added} player rows added`);
    touched += added;
  }

  // Re-sort + trim every player we touched. Entries with a startDate
  // (orchestrator-added) sort by that; CSV entries (no startDate) fall
  // back to season. Result: 2026-with-startDate land at the top in
  // chronological order, then 2026 CSV entries (no startDate), then
  // 2025, 2024.
  for (const key of touchedKeys) {
    const player = data[key];
    player.recent.sort((a, b) => {
      const aHas = typeof a.startDate === "number";
      const bHas = typeof b.startDate === "number";
      if (aHas && bHas) return b.startDate - a.startDate;
      if (aHas) return -1;
      if (bHas) return 1;
      return b.season - a.season;
    });
    if (player.recent.length > KEEP_PER_PLAYER) {
      player.recent = player.recent.slice(0, KEEP_PER_PLAYER);
    }
  }

  await writeFile(OUT_PATH, JSON.stringify(data), "utf8");
  console.log(`\nDone. ${touched} rows merged into recent-form.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
