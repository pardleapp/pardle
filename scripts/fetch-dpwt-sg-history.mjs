/**
 * Per-player per-round SG: OTT and SG: APP for every DP World Tour event
 * the Tour's shot tracker (IMG Arena) covered, for DP World Tour course
 * history. DataGolf has SG: Total only for these events.
 *
 *   node scripts/fetch-dpwt-sg-history.mjs
 *
 * Needs data/dpwt/img-event-index.json (scripts/index-img-events.mjs).
 * Writes data/dpwt/sg-history.json:
 *   events:  [{ id, name, date, course, img }]
 *   players: { [key]: { name, dgId } }
 *   rounds:  [[playerKey, eventIndex, round, sgOtt, sgApp]]
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of (await readFile(resolve(ROOT, ".env.local"), "utf-8").catch(() => "")).split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
}
const DG_KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATS = JSON.parse(await readFile(resolve(ROOT, "data", "dpwt", "img-stats-query.json"), "utf-8"));
const INDEX = JSON.parse(await readFile(resolve(ROOT, "data", "dpwt", "img-event-index.json"), "utf-8"));

const norm = (s) => String(s ?? "").replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

async function imgSg(img) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch("https://btec-http.services.srarena.io/", {
      method: "POST",
      headers: {
        "content-type": "application/json", operator: "europeantour", sport: "GOLF", "event-id": String(img),
        "gql-op-name": STATS.operationName, "ec-version": "6.0.129", "x-request-from": "6.0.129", "query-hash": STATS.queryHash,
        "normalise-response": "true", origin: "https://europeantour.apps.srarena.io", referer: "https://europeantour.apps.srarena.io/",
      },
      // Keys in alphabetical order: the server rejects any other order.
      body: JSON.stringify({ operationName: STATS.operationName, query: STATS.query, variables: { input: {
        categories: ["Driving", "Approach"], first: 250, subCats: ["offTheTeeStrokesGained", "approachStrokesGained"], tournamentId: img,
      } } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.status === 429) { await sleep(15_000 * (attempt + 1)); continue; }
    if (!r.ok) return null;
    const t = await r.text();
    if (!t) return null;
    const j = JSON.parse(t);
    return (j.data ?? j)?.getGolfTournamentStats ?? null;
  }
  return null;
}

const evList = await (await fetch(`https://feeds.datagolf.com/historical-raw-data/event-list?tour=euro&file_format=json&key=${DG_KEY}`)).json();
const evById = new Map(evList.map((e) => [String(e.event_id), e]));

const outFile = resolve(ROOT, "data", "dpwt", "sg-history.json");
const prev = existsSync(outFile) ? JSON.parse(await readFile(outFile, "utf-8")) : { events: [], players: {}, rounds: [] };
const done = new Set(prev.events.map((e) => String(e.id)));
const events = [...prev.events];
const players = { ...prev.players };
const rounds = [...prev.rounds];

for (const [id, img] of Object.entries(INDEX).sort()) {
  if (done.has(id)) continue;
  const ev = evById.get(id);
  if (!ev) continue;
  // DG rounds give the course per round and the DG id per name.
  const dgr = await (await fetch(`https://feeds.datagolf.com/historical-raw-data/rounds?tour=euro&event_id=${id}&year=${ev.calendar_year}&file_format=json&key=${DG_KEY}`)).json().catch(() => null);
  await sleep(1500);
  const dgByName = new Map();
  let course = null;
  for (const s of dgr?.scores ?? []) {
    dgByName.set(norm(s.player_name.split(",").reverse().join(" ")), s.dg_id);
    course ??= s.round_1?.course_name ?? null;
  }
  const blocks = await imgSg(img);
  await sleep(800);
  if (!blocks) { console.log(`[skip] ${id} ${ev.event_name}: no IMG stats`); continue; }
  const per = new Map();
  for (const blk of blocks) for (const sc of blk.subCats ?? []) for (const rk of sc.rankings ?? []) {
    const p = rk.players?.[0];
    if (!p) continue;
    const key = norm(`${p.firstName} ${p.lastName}`);
    players[key] ??= { name: `${p.firstName} ${p.lastName}`, dgId: dgByName.get(key) ?? null };
    if (players[key].dgId == null && dgByName.has(key)) players[key].dgId = dgByName.get(key);
    const e = per.get(key) ?? {};
    for (const rr of rk.rounds ?? []) (e[rr.round] ??= {})[sc.subCat] = rr.total;
    per.set(key, e);
  }
  const idx = events.length;
  let n = 0;
  for (const [key, byRound] of per) for (const [r, v] of Object.entries(byRound)) {
    if (typeof v.offTheTeeStrokesGained !== "number" || typeof v.approachStrokesGained !== "number") continue;
    rounds.push([key, idx, Number(r), +v.offTheTeeStrokesGained.toFixed(3), +v.approachStrokesGained.toFixed(3)]);
    n++;
  }
  if (!n) { console.log(`[skip] ${id} ${ev.event_name}: IMG has no per-player SG`); continue; }
  events.push({ id: Number(id), name: ev.event_name, date: ev.date, course, img });
  console.log(`[event] ${ev.date} ${ev.event_name} @ ${course}: ${n} player-rounds`);
  await writeFile(outFile, JSON.stringify({ events, players, rounds }));
}
await writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), events, players, rounds }));
console.log(`[done] ${events.length} events, ${Object.keys(players).length} players, ${rounds.length} player-rounds`);
