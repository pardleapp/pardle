/**
 * Map IMG Arena tournament ids to DP World Tour / DataGolf event ids.
 *
 *   node scripts/index-img-events.mjs [--from 300] [--to 1500]
 *
 * IMG ids are sequential across every event its europeantour operator
 * covers. For each id, IMG's leaderboard query (keyless, full query
 * text, works for any id) gives the R1 date and the winner; those are
 * matched to DataGolf's euro event list (DG euro ids == DP World Tour
 * EventIds) by finishing date and winner name.
 *
 * Writes data/dpwt/img-event-index.json: { [dpwtEventId]: imgId }.
 * Resumable: ids already scanned are cached in data/dpwt/img-scan-cache.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const FROM = Number(args.from ?? 300);
const TO = Number(args.to ?? 1500);
for (const line of (await readFile(resolve(ROOT, ".env.local"), "utf-8").catch(() => "")).split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
}
const DG_KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;

// IMG only accepts query texts it knows: this is the widget's own
// leaderboard query, captured verbatim, with its hash.
const LB = JSON.parse(await readFile(resolve(ROOT, "data", "dpwt", "img-leaderboard-query.json"), "utf-8"));

async function lb(id) {
  const r = await fetch("https://btec-http.services.srarena.io/", {
    method: "POST",
    headers: {
      "content-type": "application/json", operator: "europeantour", sport: "GOLF", "event-id": String(id),
      "gql-op-name": LB.operationName, "ec-version": "6.0.129", "x-request-from": "6.0.129", "query-hash": LB.queryHash,
      "normalise-response": "true", origin: "https://europeantour.apps.srarena.io", referer: "https://europeantour.apps.srarena.io/",
    },
    // Variable keys in alphabetical order, as captured.
    body: JSON.stringify({ operationName: LB.operationName, query: LB.query, variables: { input: { first: 3, tournamentId: id } } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 204) return null;
  if (!r.ok) return { error: r.status };
  const t = await r.text();
  if (!t) return null;
  const j = JSON.parse(t);
  const d = (j.data ?? j)?.getGolfTournamentLeaderboard;
  const top = d?.standingsFeed?.standings?.[0];
  if (!top) return null;
  const r1 = (top.roundInfo ?? []).find((x) => x.roundNo === 1)?.teeTime ?? null;
  return { status: d.tournamentStatus, r1: r1 ? r1.slice(0, 10) : null, winner: top.players?.map((p) => `${p.firstName} ${p.lastName}`).join(" / ") };
}

const cacheFile = resolve(ROOT, "data", "dpwt", "img-scan-cache.json");
const cache = existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, "utf-8")) : {};
const todo = [];
// Rescan ids never scanned or that hit a transient error. A 400 means
// IMG has no tournament with that id (the sequence has gaps).
for (let id = FROM; id <= TO; id++) {
  const c = cache[id];
  if (!(String(id) in cache) || (c?.error && c.error !== 400)) todo.push(id);
}
console.log(`[scan] ${todo.length} ids to scan (${FROM}-${TO})`);
let done = 0;
async function worker() {
  while (todo.length) {
    const id = todo.shift();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        cache[id] = await lb(id);
      } catch (e) {
        cache[id] = { error: String(e.message ?? e).slice(0, 80) };
      }
      if (cache[id]?.error !== 429) break;
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
    }
    await new Promise((r) => setTimeout(r, 400));
    if (++done % 50 === 0) {
      console.log(`[scan] ${done} scanned`);
      await writeFile(cacheFile, JSON.stringify(cache));
    }
  }
}
await Promise.all(Array.from({ length: 2 }, worker));
await writeFile(cacheFile, JSON.stringify(cache));

// Match to DataGolf's euro event list.
const events = await (await fetch(`https://feeds.datagolf.com/historical-raw-data/event-list?tour=euro&file_format=json&key=${DG_KEY}`)).json();
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const shift = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const byEnd = new Map();
for (const e of events) (byEnd.get(e.date) ?? byEnd.set(e.date, []).get(e.date)).push(e);
const index = {};
const unmatched = [];
// IMG also covers PGA Tour, LPGA, LET and Challenge Tour events, so a
// date match alone is not enough: the IMG leader must be DG's winner.
const winnerCache = new Map();
async function dgWinner(c) {
  const k = `${c.event_id}:${c.calendar_year}`;
  if (!winnerCache.has(k)) {
    // DataGolf suspends the key for ~5 min past 45 requests/min; a
    // throttled response must not be cached as "no winner".
    let rounds = null;
    for (let attempt = 0; attempt < 4 && !rounds; attempt++) {
      const res = await fetch(`https://feeds.datagolf.com/historical-raw-data/rounds?tour=euro&event_id=${c.event_id}&year=${c.calendar_year}&file_format=json&key=${DG_KEY}`);
      if (res.status === 429) { console.log("[dg] rate-limited, waiting 65s"); await new Promise((r) => setTimeout(r, 65_000)); continue; }
      rounds = res.ok ? await res.json().catch(() => ({})) : {};
    }
    const win = rounds?.scores?.find((s) => s.fin_text === "1");
    winnerCache.set(k, win ? norm(win.player_name.split(",").reverse().join(" ")) : null);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return winnerCache.get(k);
}
for (const [id, v] of Object.entries(cache)) {
  if (!v || !v.r1) continue;
  // DG's `date` is the final round; 4-round events end 3 days after R1.
  const cands = [3, 2, 4].flatMap((n) => byEnd.get(shift(v.r1, n)) ?? []);
  if (!cands.length) continue;
  const leaders = (v.winner ?? "").split(" / ").map(norm);
  let hit = null;
  for (const c of cands) {
    const w = await dgWinner(c);
    if (w && leaders.includes(w)) { hit = c; break; }
  }
  if (hit) index[hit.event_id] = Number(id);
  else unmatched.push(`${id} ${v.r1} ${v.winner}`);
}
await writeFile(resolve(ROOT, "data", "dpwt", "img-event-index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(`[index] ${Object.keys(index).length} DP World events mapped; ${unmatched.length} IMG events unmatched (other tours)`);
