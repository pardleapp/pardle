/**
 * Shot-by-shot ShotLink data for a whole tournament, from the PGA Tour
 * orchestrator's shotDetailsV3. Cached per tournament under
 * data/shot-cache/ (gitignored) so the SG pipeline can be re-run
 * without refetching ~600 player-rounds per event.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const PGA_URL = "https://orchestrator.pgatour.com/graphql";
const PGA_KEY = process.env.PGATOUR_API_KEY || "da2-gsrx5bibzbb4njvhl7t37wqyl4";
const CACHE_DIR = path.join(process.cwd(), "data", "shot-cache");
const CHUNK = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pga(query, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(PGA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": PGA_KEY, "x-pgat-platform": "web" },
        body: JSON.stringify({ query }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.errors && !j.data) throw new Error(JSON.stringify(j.errors).slice(0, 300));
      return j.data;
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
}

async function fieldPlayers(tournamentId) {
  const d = await pga(`{ leaderboardV2(id: "${tournamentId}") { players { ... on PlayerRowV2 { player { id displayName } } } } }`);
  return (d?.leaderboardV2?.players ?? []).filter((p) => p?.player).map((p) => p.player);
}

const SHOT_FIELDS = `holes { holeNumber par score yardage
  strokes { strokeNumber strokeType fromLocationCode toLocationCode distance distanceRemaining playByPlay } }`;

/** Returns { tournamentId, players: [{ id, name, rounds: { [round]: holes[] } }] }. */
export async function getTournamentShots(tournamentId, { log = console.log } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${tournamentId}.json`);
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    /* not cached */
  }
  const players = await fieldPlayers(tournamentId);
  const reqs = players.flatMap((p) => [1, 2, 3, 4].map((round) => ({ p, round })));
  const byId = new Map(players.map((p) => [p.id, { id: p.id, name: p.displayName, rounds: {} }]));
  for (let i = 0; i < reqs.length; i += CHUNK) {
    const chunk = reqs.slice(i, i + CHUNK);
    const q = `{ ${chunk
      .map(({ p, round }) => `s${p.id}_${round}: shotDetailsV3(tournamentId: "${tournamentId}", playerId: "${p.id}", round: ${round}) { ${SHOT_FIELDS} }`)
      .join("\n")} }`;
    const d = await pga(q);
    for (const { p, round } of chunk) {
      const holes = d?.[`s${p.id}_${round}`]?.holes ?? [];
      if (holes.some((h) => (h.strokes ?? []).length > 0)) byId.get(p.id).rounds[round] = holes;
    }
    if ((i / CHUNK) % 10 === 0) log(`[shots] ${tournamentId} ${Math.min(i + CHUNK, reqs.length)}/${reqs.length}`);
    await sleep(250);
  }
  const out = { tournamentId, fetchedAt: new Date().toISOString(), players: [...byId.values()] };
  await writeFile(file, JSON.stringify(out));
  return out;
}
