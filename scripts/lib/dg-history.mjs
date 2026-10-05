/**
 * DataGolf historical rounds with SG categories, cached per event under
 * data/dg-rounds-full-cache/ (gitignored). Used by the course-fit
 * backtest; unlike data/dg-rounds-cache it keeps dates, course and all
 * SG categories.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = resolve(ROOT, "data", "dg-rounds-full-cache");
for (const line of (await readFile(resolve(ROOT, ".env.local"), "utf-8").catch(() => "")).split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
}
const KEY = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
let last = 0;
async function dg(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = 1500 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const r = await fetch(`https://feeds.datagolf.com${path}${path.includes("?") ? "&" : "?"}file_format=json&key=${KEY}`);
    if (r.status === 429) { await new Promise((x) => setTimeout(x, 65_000)); continue; }
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}

export async function eventList(tour) {
  return dg(`/historical-raw-data/event-list?tour=${tour}`);
}

/** Flat rounds: { dgId, name, round, date, course, sgTotal, sgOtt, sgApp, sgArg, sgPutt } */
export async function eventRounds(tour, ev) {
  await mkdir(CACHE, { recursive: true });
  const f = resolve(CACHE, `${tour}-${ev.event_id}-${ev.calendar_year}.json`);
  if (existsSync(f)) return JSON.parse(await readFile(f, "utf-8"));
  const d = await dg(`/historical-raw-data/rounds?tour=${tour}&event_id=${ev.event_id}&year=${ev.calendar_year}`);
  const out = [];
  for (const s of d?.scores ?? []) for (let r = 1; r <= 4; r++) {
    const x = s[`round_${r}`];
    if (!x || typeof x.sg_total !== "number") continue;
    out.push({ dgId: s.dg_id, name: s.player_name, round: r, date: ev.date, course: x.course_name ?? null,
      sgTotal: x.sg_total, sgOtt: x.sg_ott ?? null, sgApp: x.sg_app ?? null, sgArg: x.sg_arg ?? null, sgPutt: x.sg_putt ?? null });
  }
  if (d) await writeFile(f, JSON.stringify(out));
  return out;
}
