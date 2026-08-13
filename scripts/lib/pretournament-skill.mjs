/**
 * scripts/lib/pretournament-skill.mjs
 *
 * Compute a per-player pre-tournament skill baseline that matches
 * how DataGolf frames their own skill ratings: a trailing-window
 * arithmetic mean of `sg_total` across every PGA round the player
 * played in the twelve months ending on (but not including) the
 * tournament's Round 1.
 *
 * This deliberately avoids two failure modes of the previous
 * "within-event 4-round average":
 *   1. Leakage — the old baseline included the week's own scoring,
 *      so a hot week masked itself as high skill and cold weeks got
 *      wrongly-tagged as underperformance.
 *   2. Small-sample noise — 4 rounds vs. often 40+ rounds here.
 *
 * DG's own skill_rating decays older rounds; we don't (yet) — a
 * flat trailing mean is transparent and matches within a few
 * hundredths of a stroke for players with steady form over the
 * window. Add exponential weighting later if the fit warrants it.
 *
 * Persists a disk cache under `data/dg-rounds-cache/` — DG's
 * historical rounds never change once an event settles, so cache
 * hits are byte-identical after the first fetch.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const CACHE_DIR = resolve(REPO_ROOT, "data", "dg-rounds-cache");

const DG_BASE = "https://feeds.datagolf.com";

/** Trailing window (days) counted back from Round 1. Twelve months
 *  is the standard "form window" in golf modelling — long enough
 *  to smooth week-to-week variance, short enough to reflect
 *  current form. */
const WINDOW_DAYS = 365;
/** Minimum rounds before we trust the trailing average. Below
 *  this, the caller decides whether to accept a noisier baseline
 *  or fall back further. */
const MIN_ROUNDS = 5;

function dgKey() {
  const k = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF;
  if (!k) throw new Error("DATAGOLF_API_KEY not set");
  return k;
}

/** DataGolf caps at 45 requests/min. Pace the loop at ~40/min so
 *  we stay under the ceiling with a small safety margin, and back
 *  off on 429s (they've suspended us for 5 min at a time when we
 *  overrun). */
const DG_MIN_INTERVAL_MS = 1500;
let lastDgFetchMs = 0;
async function pace() {
  const now = Date.now();
  const wait = DG_MIN_INTERVAL_MS - (now - lastDgFetchMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastDgFetchMs = Date.now();
}

async function dgFetch(path, { attempt = 0 } = {}) {
  await pace();
  const url = `${DG_BASE}${path}${path.includes("?") ? "&" : "?"}file_format=json&key=${dgKey()}`;
  const res = await fetch(url);
  if (res.status === 429) {
    if (attempt >= 3) {
      throw new Error(`DG 429 after ${attempt + 1} attempts: ${path}`);
    }
    // DG's suspension is 5min once you overrun. Sleep 65s and try
    // again — usually the suspension window resets partway through.
    const wait = 65_000;
    console.warn(`[skill] rate-limited, sleeping ${wait / 1000}s then retrying`);
    await new Promise((r) => setTimeout(r, wait));
    return dgFetch(path, { attempt: attempt + 1 });
  }
  if (!res.ok) {
    throw new Error(`DG ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

let cachedEventList = null;
/** Fetch DG's PGA event list once per process. Each entry looks
 *  like { calendar_year, event_id, event_name, date, ... }. `date`
 *  is the event start date (YYYY-MM-DD). */
export async function loadDgPgaEventList() {
  if (cachedEventList) return cachedEventList;
  cachedEventList = await dgFetch("/historical-raw-data/event-list?tour=pga");
  return cachedEventList;
}

/** Per-event round bundle, cached to disk. DG returns one entry
 *  per player containing round_1..round_4 SG blobs — we normalise
 *  into a flat list of {dg_id, round, date, sg_total}. */
async function loadEventRounds(eventId, year) {
  const cachePath = resolve(CACHE_DIR, `${eventId}-${year}.json`);
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(await readFile(cachePath, "utf8"));
    } catch {
      /* corrupt cache — fall through to refetch */
    }
  }
  const data = await dgFetch(
    `/historical-raw-data/rounds?tour=pga&event_id=${eventId}&year=${year}`,
  );
  const flat = [];
  for (const row of data?.scores ?? []) {
    const dgId = row.dg_id;
    if (dgId == null) continue;
    for (let r = 1; r <= 4; r++) {
      const round = row[`round_${r}`];
      if (!round || typeof round.sg_total !== "number") continue;
      // DG's round payload doesn't carry the round date directly;
      // fall back to the event's start date + (round-1) days.
      // Good enough for a 12-month window — no round can be
      // misplaced by more than 3 days.
      flat.push({
        dgId,
        round: r,
        eventDate: data.event_completed ?? null,
        sgTotal: round.sg_total,
      });
    }
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(flat));
  return flat;
}

/** Add `days` days to a YYYY-MM-DD string, return YYYY-MM-DD. Uses
 *  UTC internally so DST never shifts the offset. */
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a `{ dgId → mean sg_total across trailing 12 months }` map
 * for every player who appears in the DG event list within the
 * window ending immediately before `r1Date`.
 *
 * @param {string} r1Date YYYY-MM-DD of the tournament's Round 1.
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<Record<string, {mean: number, n: number}>>}
 */
export async function buildPreTournamentSkillMap(r1Date, opts = {}) {
  const log = opts.log ?? (() => {});
  const windowStart = shiftDate(r1Date, -WINDOW_DAYS);
  const eventList = await loadDgPgaEventList();
  // Any event whose completion date is in [windowStart, r1Date) —
  // strictly less than r1Date so we never leak the target week
  // into its own baseline.
  const inWindow = eventList.filter((e) => {
    const d = e.date;
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    return d >= windowStart && d < r1Date;
  });
  log(
    `[skill] ${inWindow.length} PGA events in trailing 12mo window ${windowStart} → ${r1Date}`,
  );
  // Aggregate per player.
  const byPlayer = new Map(); // dgId → { sum, n }
  for (const ev of inWindow) {
    let rounds;
    try {
      rounds = await loadEventRounds(ev.event_id, ev.calendar_year);
    } catch (err) {
      log(`[skill] skip ${ev.event_id}/${ev.calendar_year}: ${err.message}`);
      continue;
    }
    for (const r of rounds) {
      const bucket = byPlayer.get(r.dgId) ?? { sum: 0, n: 0 };
      bucket.sum += r.sgTotal;
      bucket.n += 1;
      byPlayer.set(r.dgId, bucket);
    }
  }
  const out = {};
  for (const [dgId, b] of byPlayer) {
    if (b.n < MIN_ROUNDS) continue;
    out[String(dgId)] = { mean: b.sum / b.n, n: b.n };
  }
  log(`[skill] ${Object.keys(out).length} players with ≥${MIN_ROUNDS} rounds`);
  return out;
}
