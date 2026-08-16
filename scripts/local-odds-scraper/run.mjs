/**
 * Home Playwright runner for FanDuel / Caesars / BetMGM round-score
 * O/U markets. Runs on Tom's personal machine (residential IP) so
 * the sportsbooks see a real home browser, not a datacentre IP.
 * Every book's real Chrome session polls its own tab; parsed
 * quotes POST to pardle.app/api/odds-compare/ingest which merges
 * them with the direct DK/Kalshi/DFS fetchers.
 *
 * Design goals:
 *   1. Real Chrome (via Playwright) — Datadome/anti-bot sees a
 *      real browser fingerprint, not a scraper.
 *   2. Long-lived sessions per book — every 30 s we navigate the
 *      same page rather than opening a fresh browser. Books stop
 *      caring once the session is trusted.
 *   3. Isolated failures — one book scraper crashing doesn't kill
 *      the others. The main loop restarts each book independently.
 *
 * Run:
 *   cp .env.example .env    # then edit .env
 *   npm install
 *   npm run install-browsers
 *   npm start
 *
 * Stop: Ctrl+C
 *
 * Environment (read from .env / the shell):
 *   INGEST_URL       full URL to https://pardle.app/api/odds-compare/ingest
 *   INGEST_SECRET    shared secret matching ODDS_INGEST_SECRET on Vercel
 *   BOOKS            comma-separated subset of "fanduel,caesars,betmgm"
 *                    (default: all three)
 *   POLL_INTERVAL_MS default 30000
 *   HEADLESS         "true" (default) or "false" if you want to
 *                    watch what the scraper is doing
 */

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeFanduel } from "./books/fanduel.mjs";
import { scrapeCaesars } from "./books/caesars.mjs";
import { scrapeBetmgm } from "./books/betmgm.mjs";

// ── Env loading (skip dotenv dep — parse .env by hand) ─────────────
function loadEnvFile() {
  const here = dirname(fileURLToPath(import.meta.url));
  const p = resolve(here, ".env");
  try {
    const text = readFileSync(p, "utf-8");
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
    /* .env absent — expect vars from the shell */
  }
}
loadEnvFile();

const INGEST_URL = process.env.INGEST_URL;
const INGEST_SECRET = process.env.INGEST_SECRET;
if (!INGEST_URL || !INGEST_SECRET) {
  console.error(
    "[fatal] INGEST_URL and INGEST_SECRET must be set (see .env.example).",
  );
  process.exit(1);
}
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30000);
const HEADLESS = (process.env.HEADLESS ?? "true") !== "false";
const ENABLED = new Set(
  (process.env.BOOKS ?? "fanduel,caesars,betmgm")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const SCRAPERS = {
  fanduel: scrapeFanduel,
  caesars: scrapeCaesars,
  betmgm: scrapeBetmgm,
};

/** POST a scraped payload to Pardle. Retry once on network error.
 *  Log the outcome so a broken pipe is visible in the terminal. */
async function postToPardle(book, quotes) {
  const body = JSON.stringify({ book, quotes });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ingest-Secret": INGEST_SECRET,
        },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        console.warn(
          `  [ingest] ${book} → ${res.status} ${text.slice(0, 120)}`,
        );
        return false;
      }
      const j = JSON.parse(text);
      console.log(
        `  [ingest] ${book} → accepted=${j.accepted} rejected=${j.rejected}`,
      );
      return true;
    } catch (err) {
      if (attempt === 1) {
        console.warn(
          `  [ingest] ${book} → network err: ${err.message.slice(0, 120)}`,
        );
      }
    }
  }
  return false;
}

/** One book's scrape loop: run the scraper, POST, wait, repeat.
 *  Runs forever; catches its own errors so a book-specific crash
 *  doesn't take down the other book loops. */
async function runBookLoop(book) {
  const scraper = SCRAPERS[book];
  if (!scraper) {
    console.warn(`[skip] no scraper registered for ${book}`);
    return;
  }
  // Per-book persistent Chrome profile. Datadome (FanDuel) and
  // other anti-bot systems flag fresh browser sessions instantly;
  // a persistent profile that lives on disk between runs
  // accumulates cookies, localStorage, and site permissions that
  // look like a normal user. Kept in ./chrome-profiles/{book} so
  // each book has its own account state (avoids cross-book
  // contamination and lets one book's Datadome block not poison
  // the others).
  //
  // Using channel:'chrome' launches the user's installed Google
  // Chrome (not Playwright's Chromium build). Chrome ships with
  // signed binaries that don't trip navigator.webdriver =
  // undefined and other cheap detection tricks.
  const here = dirname(fileURLToPath(import.meta.url));
  const profileDir = resolve(here, "chrome-profiles", book);
  mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: HEADLESS,
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    // Match a real Chrome install's default args by omitting the
    // automation-related switches Playwright adds by default.
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  console.log(`[${book}] session ready`);
  while (true) {
    const t0 = Date.now();
    try {
      const quotes = await scraper(page);
      console.log(
        `[${book}] scrape ok — ${quotes.length} quotes (${Date.now() - t0}ms)`,
      );
      await postToPardle(book, quotes);
    } catch (err) {
      console.warn(
        `[${book}] scrape err: ${err.message.slice(0, 200)}`,
      );
    }
    // Wait until POLL_INTERVAL_MS has elapsed from the START of
    // this iteration — steady cadence regardless of scrape time.
    const elapsed = Date.now() - t0;
    const sleep = Math.max(0, POLL_INTERVAL_MS - elapsed);
    await new Promise((r) => setTimeout(r, sleep));
  }
}

async function main() {
  const books = [...ENABLED].filter((b) => SCRAPERS[b]);
  console.log(
    `[main] launching ${HEADLESS ? "headless" : "headed"} Chrome per book`,
  );
  console.log(`[main] enabled books: ${books.join(", ")}`);
  console.log(`[main] posting to ${INGEST_URL} every ${POLL_INTERVAL_MS}ms`);
  // One persistent Chrome per book — profile lives in
  // chrome-profiles/{book}/ so cookies + session state survive
  // between runs.
  await Promise.all(books.map((book) => runBookLoop(book)));
}

process.on("SIGINT", () => {
  console.log("\n[main] SIGINT — exiting");
  process.exit(0);
});
main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
